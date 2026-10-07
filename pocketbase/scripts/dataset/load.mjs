// Loads the test-dataset pack (CSV folder or .zip + workbook) and turns it
// into PocketBase field values. Pure: no server access, so the plan can be
// shown before anything is written.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseCsv } from "../lib/csv.mjs";
import { openWorkbook } from "../lib/xlsx.mjs";
import { readZip } from "../lib/zip.mjs";
import { core, nationalIdError } from "../rules.mjs";

const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000; // Iran has no daylight saving since 2022
const SHIFT = {
  Morning: ["morning", "07:00", "15:00"],
  Evening: ["evening", "15:00", "23:00"],
  Night: ["night", "23:00", "07:00"],
  Office: ["morning", "08:00", "16:00"],
  Split: ["evening", "11:00", "21:00"],
};
const SHIFT_STATUS = { Present: "completed", Scheduled: "scheduled", "Annual leave": "absent", "Sick leave": "absent", "Absent (unexcused)": "absent" };
/** Who reports a recent ticket through the app, by the CSV's reporting department. */
export const REPORTER_ROLE = {
  Housekeeping: "housekeepingStaff",
  "Front Office (guest call)": "receptionStaff",
  "Engineering round": "maintenanceStaff",
  Security: "operationsManager",
  "F&B": "restaurantStaff",
};

/** Tehran local "YYYY-MM-DD HH:MM:SS[.ffffff]" → PocketBase UTC "YYYY-MM-DD HH:MM:SS.sssZ". */
export function utc(local) {
  if (!local) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(String(local).trim());
  if (!m) throw new Error(`unexpected date-time "${local}"`);
  const ms = Number((m[7] || "0").padEnd(3, "0").slice(0, 3));
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), ms) - TEHRAN_OFFSET_MS;
  return new Date(t).toISOString().replace("T", " ");
}

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const num = (v) => (v === "" || v === undefined || v === null ? 0 : Number(v));
const cut = (s, n) => String(s ?? "").slice(0, n);

function source(path) {
  if (!existsSync(path)) throw new Error(`not found: ${path}`);
  if (statSync(path).isDirectory()) return (name) => (existsSync(join(path, name)) ? readFileSync(join(path, name)) : null);
  const zip = readZip(readFileSync(path));
  return (name) => zip.read(zip.names.find((n) => n === name || n.endsWith(`/${name}`)) ?? name);
}

/** Reads every file; throws with a clear message when one is missing. */
export function readDataset({ csv, xlsx }) {
  const file = source(csv);
  const table = (name) => {
    const buf = file(`${name}.csv`);
    if (!buf) throw new Error(`${name}.csv missing from ${csv}`);
    return parseCsv(buf.toString("utf8"));
  };
  const hotelJson = file("hotel.json");
  if (!hotelJson) throw new Error(`hotel.json missing from ${csv}`);
  const wb = openWorkbook(readFileSync(xlsx));
  return {
    hotel: JSON.parse(hotelJson.toString("utf8")),
    rooms: table("rooms"), staff: table("staff"), tasks: table("tasks"), tickets: table("maintenanceTickets"),
    events: table("ticketEvents"), energy: table("energyReadings"), operations: table("dailyOperations"),
    items: table("inventoryItems"), movements: table("inventoryMovements"), shifts: table("shifts"),
    users: wb.records("App_Users"), scenarios: wb.records("Test_Scenarios"),
  };
}

/** The dataset's "now" (Test_Scenarios: "now = 2026-10-07 09:30"), Tehran time. */
export function datasetNow(data) {
  for (const s of data.scenarios) {
    const m = /now = (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(String(s.how_verified_note ?? ""));
    if (m) return m[1];
  }
  const last = data.tickets.map((t) => t.created_at).sort().pop();
  return last.slice(0, 16);
}

/**
 * Everything the importer will write, split into history (written quietly
 * through /api/zarin/admin/import) and the recent window (through the app API).
 */
export function buildPlan(data, { name, asOf, recentDays = 7, energyDays = recentDays }) {
  const issues = [];
  const asOfDay = asOf.slice(0, 10);
  const cutoff = addDays(asOfDay, -recentDays);
  const energyCutoff = addDays(asOfDay, -energyDays);
  const recent = (localDay) => localDay >= cutoff;

  // ---------------------------------------------------------------- hotel
  const h = data.hotel;
  const hotel = {
    name, city: h.city ?? "", stars: num(h.stars), roomCount: num(h.roomCount), timezone: h.timezone || "Asia/Tehran",
    currency: h.currency || "IRR", status: "trial", settings: h.settings ?? {},
  };

  // ---------------------------------------------------------- users, staff
  const staffByEmp = new Map(data.staff.map((s) => [s.employee_id, s]));
  const users = [];
  const skippedUsers = [];
  for (const u of data.users) {
    const nid = core.normalizeNationalId(String(u.national_id_synthetic ?? ""));
    const why = u.role === "superAdmin" ? "superAdmin: a platform-wide account would reach every hotel, including the real one"
      : !core.ROLES.includes(u.role) ? `unknown role ${u.role}`
      : nationalIdError(nid) ? "invalid national ID"
      : u.employee_id && !staffByEmp.has(u.employee_id) ? `employee ${u.employee_id} not in staff.csv` : null;
    if (why) { skippedUsers.push({ id: u.user_id, role: u.role, why }); continue; }
    users.push({
      key: u.user_id, emp: u.employee_id || null,
      fields: {
        nationalId: nid, nationalIdMasked: core.maskNationalId(nid), fullName: cut(u.full_name, 80), role: u.role,
        status: ["active", "suspended", "disabled"].includes(u.status) ? u.status : "active",
        mustChangePassword: true, locale: u.locale === "en" ? "en" : "fa", phone: cut(u.phone, 20),
      },
    });
  }
  const userByEmp = new Map(users.filter((u) => u.emp).map((u) => [u.emp, u]));
  const staffName = (emp) => (userByEmp.get(emp)?.fields.fullName) ?? (staffByEmp.has(emp) ? cut(`${emp} — ${staffByEmp.get(emp).position}`, 80) : cut(emp, 80));
  const staff = data.staff.map((s) => ({
    emp: s.employee_id,
    fields: {
      fullName: staffName(s.employee_id), department: s.department_app || "", position: cut(s.position, 60),
      role: s.role || "", phone: "", active: String(s.status_asof).startsWith("Active"),
    },
  }));

  // ------------------------------------------------------------------ rooms
  const roomNumbers = new Set(data.rooms.map((r) => r.number));
  const rooms = data.rooms.map((r) => ({
    number: r.number,
    fields: { number: r.number, floor: num(r.floor), type: r.type, status: r.status, previousStatus: "", note: "" },
    updated: utc(r.status_since),
  }));

  // -------------------------------------------------------------- inventory
  const itemBySku = new Map(data.items.map((i) => [i.sku, i]));
  const movementsBySku = new Map();
  for (const m of data.movements) {
    if (!itemBySku.has(m.item_id)) { issues.push(`movement ${m.movement_id}: unknown item ${m.item_id}`); continue; }
    if (!movementsBySku.has(m.item_id)) movementsBySku.set(m.item_id, []);
    movementsBySku.get(m.item_id).push(m);
  }
  const items = [];
  const historyMovements = [];
  const replay = [];
  const replayStats = { deferred: 0, clamped: 0, zeroAsHistory: 0, reconciled: 0 };
  for (const it of data.items) {
    const all = (movementsBySku.get(it.sku) ?? []).sort((a, b) => (a.created + a.movement_id).localeCompare(b.created + b.movement_id));
    const recentMoves = all.filter((m) => recent(m.created.slice(0, 10)));
    const finalQty = num(it.quantity);
    const start = Math.round((finalQty - recentMoves.reduce((s, m) => s + num(m.delta), 0)) * 1000) / 1000;
    if (start < 0) issues.push(`${it.sku}: computed opening stock ${start} < 0`);
    items.push({
      sku: it.sku,
      fields: {
        name: cut(it.name, 120), sku: it.sku, category: it.category, unit: cut(it.unit, 20), quantity: Math.max(start, 0),
        reorderLevel: num(it.reorderLevel), reorderQuantity: num(it.reorderQuantity), unitCost: num(it.unitCost),
        location: cut(it.location, 80), supplier: cut(it.supplier, 120), lastMovement: "",
      },
    });
    // History: a ledger chain that ends exactly at the opening stock.
    let after = start;
    const hist = all.filter((m) => !recent(m.created.slice(0, 10)));
    for (let i = hist.length - 1; i >= 0; i--) {
      const m = hist[i];
      const before = Math.round((after - num(m.delta)) * 1000) / 1000;
      hist[i] = { m, before, after };
      after = before;
    }
    for (const { m, before, after: a } of hist) {
      historyMovements.push({
        sku: it.sku, created: utc(m.created),
        fields: {
          itemName: cut(it.name, 120), type: m.type, delta: num(m.delta), quantityBefore: before, quantityAfter: a,
          reason: cut(`${m.reason} · ${m.movement_id}`, 300), actorName: "Dataset import",
        },
      });
    }
    // Recent window through POST /api/zarin/inventory/{id}/movements: the app
    // refuses negative stock, so a same-day issue that comes before the day's
    // delivery waits for it, and a shortfall from rounding is clamped.
    let qty = Math.max(start, 0);
    const queue = recentMoves.slice();
    const deferred = [];
    const push = (m, delta) => {
      qty = Math.round((qty + delta) * 1000) / 1000;
      replay.push({ sku: it.sku, created: utc(m.created), body: { type: m.type, delta, reason: cut(`${m.reason} · ${m.movement_id}`, 300) }, id: m.movement_id });
    };
    while (queue.length || deferred.length) {
      const m = queue.shift();
      const day = m ? m.created.slice(0, 10) : null;
      // Flush deferred movements whose day is over or that now fit.
      for (let i = 0; i < deferred.length;) {
        const d = deferred[i];
        const dayOver = !m || d.created.slice(0, 10) !== day;
        if (qty + num(d.delta) >= 0) { push(d, num(d.delta)); deferred.splice(i, 1); }
        else if (dayOver) {
          replayStats.clamped++;
          if (qty > 0) push(d, -qty);
          deferred.splice(i, 1);
        } else i++;
      }
      if (!m) break;
      const delta = num(m.delta);
      if (delta === 0) { replayStats.zeroAsHistory++; historyMovements.push({ sku: it.sku, created: utc(m.created), fields: { itemName: cut(it.name, 120), type: m.type, delta: 0, quantityBefore: qty, quantityAfter: qty, reason: cut(`${m.reason} · ${m.movement_id}`, 300), actorName: "Dataset import" } }); continue; }
      if (qty + delta >= 0) { push(m, delta); continue; }
      const laterReceive = queue.some((n) => n.created.slice(0, 10) === day && num(n.delta) > 0);
      if (laterReceive) { replayStats.deferred++; deferred.push(m); }
      else { replayStats.clamped++; if (qty > 0) push(m, -qty); }
    }
    const diff = Math.round((finalQty - qty) * 1000) / 1000;
    if (diff !== 0) {
      replayStats.reconciled++;
      replay.push({ sku: it.sku, created: utc(`${addDays(asOfDay, -1)} 23:59:00`), body: { type: "adjust", delta: diff, reason: "Import reconciliation (rounding in the daily aggregates)" }, id: null });
    }
  }

  // ---------------------------------------------------------------- energy
  const energy = data.energy.map((r) => ({
    recent: r.day >= energyCutoff,
    fields: { type: r.type, unit: r.unit, day: r.day, consumption: num(r.consumption), source: r.source || "import", meterId: "", note: "" },
  }));
  const operations = data.operations.map((o) => ({
    fields: {
      day: o.day, roomsAvailable: num(o.roomsAvailable), roomsOccupied: num(o.roomsOccupied), guests: num(o.guests),
      roomRevenue: num(o.roomRevenue), fnbRevenue: num(o.fnbRevenue), otherRevenue: num(o.otherRevenue), source: "import",
    },
  }));

  // --------------------------------------------------------------- tickets
  const ticketIds = new Set();
  const tickets = data.tickets.map((t) => {
    ticketIds.add(t.ticket_id);
    if (t.room_number && !roomNumbers.has(t.room_number)) issues.push(`ticket ${t.ticket_id}: unknown room ${t.room_number}`);
    if (t.assignee && !staffByEmp.has(t.assignee)) issues.push(`ticket ${t.ticket_id}: unknown assignee ${t.assignee}`);
    const closed = ["resolved", "closed"].includes(t.status);
    const last = [t.closed_at, t.resolved_at, t.started_at, t.assigned_at, t.created_at].find(Boolean);
    return {
      key: t.ticket_id, recent: recent(t.created_at.slice(0, 10)), reportedByDept: t.reported_by_dept,
      roomNumber: t.room_number || null, assigneeEmp: t.assignee || null,
      create: {
        title: cut(t.title, 200), category: t.category, priority: t.priority, area: cut(t.area, 120),
        description: `${t.ticket_id} · Reported by: ${t.reported_by_dept}${t.equipment_id ? ` · Equipment: ${t.equipment_id}` : ""}`,
      },
      state: {
        status: t.status, assigneeName: t.assignee ? staffName(t.assignee) : "", slaDueAt: utc(t.sla_due_at),
        resolvedAt: utc(t.resolved_at),
        resolutionNote: closed ? `Labor ${t.labor_hours} h · Parts ${t.parts_cost_irr} · Labor ${t.labor_cost_irr} · Contractor ${t.contractor_cost_irr} · Total ${t.total_cost_irr} IRR · Downtime ${t.downtime_hours} h` : "",
      },
      created: utc(t.created_at), updated: utc(last),
    };
  });
  const recentTickets = new Set(tickets.filter((t) => t.recent).map((t) => t.key));
  const events = [];
  for (const ev of data.events) {
    if (!ticketIds.has(ev.ticket_id)) { issues.push(`event ${ev.event_id}: unknown ticket ${ev.ticket_id}`); continue; }
    // The app writes the "created" event itself for tickets reported through the API.
    if (ev.type === "created" && recentTickets.has(ev.ticket_id)) continue;
    const emp = /^EMP-\d+$/.test(ev.actor) ? ev.actor : null;
    events.push({
      ticket: ev.ticket_id, actorEmp: emp, created: utc(ev.timestamp),
      fields: { type: ev.type, fromStatus: ev.from_status || "", toStatus: ev.to_status || "", note: cut(ev.note, 5000), actorName: emp ? staffName(emp) : cut(ev.actor, 80) },
    });
  }

  // ----------------------------------------------------------------- tasks
  const tasks = data.tasks.map((t) => {
    if (!roomNumbers.has(t.room_number)) issues.push(`task ${t.task_id}: unknown room ${t.room_number}`);
    return {
      roomNumber: t.room_number, assigneeEmp: t.assignee || null,
      fields: {
        kind: "housekeeping", day: t.day, roomNumber: t.room_number, type: t.type, status: t.status, priority: t.priority,
        assigneeName: t.assignee ? staffName(t.assignee) : "", dueAt: utc(t.due_at), startedAt: utc(t.started_at),
        completedAt: utc(t.completed_at), durationMinutes: num(t.duration_minutes), notes: t.task_id,
      },
      // The record's own dates: created when work on it started (or its due time).
      created: utc(t.started_at || t.due_at), updated: utc(t.completed_at || t.started_at || t.due_at),
    };
  });

  // ---------------------------------------------------------------- shifts
  const shifts = [];
  for (const s of data.shifts) {
    const kind = SHIFT[s.shift];
    if (!staffByEmp.has(s.employee_id) || !kind) { issues.push(`shift ${s.employee_id} ${s.date}: unknown employee or shift ${s.shift}`); continue; }
    shifts.push({
      emp: s.employee_id,
      fields: {
        staffName: staffName(s.employee_id), department: staffByEmp.get(s.employee_id).department_app || "", day: s.date,
        type: kind[0], startTime: kind[1], endTime: kind[2], status: SHIFT_STATUS[s.status] ?? "scheduled",
      },
    });
  }

  // ----------------------------------------------- what the API part should raise
  const s = hotel.settings;
  const threshold = s.energyAlertThresholdPct ?? 15;
  const expectSpikes = energy.filter((r) => r.recent).map((r) => {
    const base = s.energyDailyBaseline?.[r.fields.type] ?? 0;
    const dev = base > 0 ? ((r.fields.consumption - base) / base) * 100 : 0;
    return dev > threshold ? { type: r.fields.type, day: r.fields.day, critical: dev > threshold * 2 } : null;
  }).filter(Boolean);
  const expectCriticalTickets = tickets.filter((t) => t.recent && ["high", "critical"].includes(t.create.priority)).length;

  return {
    name, asOf, asOfUtc: utc(asOf), asOfDay, cutoff, recentDays, energyCutoff, energyDays,
    hotel, users, skippedUsers, staff, rooms, items, operations, shifts, tasks, tickets, events,
    energy, historyMovements, replay, replayStats, issues,
    expect: { spikes: expectSpikes, criticalTickets: expectCriticalTickets },
    counts: {
      users: users.length, staff: staff.length, rooms: rooms.length, items: items.length, dailyOperations: operations.length,
      shifts: shifts.length, tasks: tasks.length,
      tickets: { history: tickets.filter((t) => !t.recent).length, api: tickets.filter((t) => t.recent).length },
      ticketEvents: events.length,
      energy: { history: energy.filter((r) => !r.recent).length, api: energy.filter((r) => r.recent).length },
      movements: { history: historyMovements.length, api: replay.length },
    },
  };
}
