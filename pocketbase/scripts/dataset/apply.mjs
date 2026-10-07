// Writes a plan from load.mjs to a PocketBase server (signed in as superuser).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPORTER_ROLE, addDays } from "./load.mjs";

const BATCH = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries rate-limited (429) and dropped requests with backoff. */
export async function withRetry(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retriable = err?.status === 429 || err?.status === 0 || err?.status === 502 || err?.status === 503;
      if (!retriable || i >= tries - 1) throw err;
      await sleep(Math.min(1000 * 2 ** i, 15000));
    }
  }
}

/** Collections the importer writes, watched on every other hotel. */
export const WATCHED = ["rooms", "staff", "shifts", "tasks", "maintenanceTickets", "ticketEvents", "energyReadings", "dailyOperations", "inventoryItems", "inventoryMovements"];

/** Record counts of every hotel except `skip` (to prove they are untouched). */
export async function snapshotHotels(pb, skip) {
  const out = {};
  for (const h of await pb.collection("hotels").getFullList({ fields: "id,name,status" })) {
    if (h.id === skip) continue;
    const counts = { name: h.name, status: h.status };
    for (const c of WATCHED) {
      counts[c] = (await withRetry(() => pb.collection(c).getList(1, 1, { filter: pb.filter("hotel = {:h}", { h: h.id }), fields: "id" }))).totalItems;
    }
    counts.users = (await withRetry(() => pb.collection("users").getList(1, 1, { filter: pb.filter("hotels.id ?= {:h}", { h: h.id }), fields: "id" }))).totalItems;
    out[h.id] = counts;
  }
  return out;
}

/** Creates a server-side backup of pb_data and downloads a copy. */
export async function backup(pb, dir, log) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const name = `zarin-before-import-${stamp}.zip`;
  log(`Backup: creating ${name} on the server…`);
  await pb.backups.create(name);
  const entry = (await pb.backups.getFullList()).find((b) => b.key === name);
  if (!entry) throw new Error("the server did not list the new backup");
  const token = await pb.files.getToken();
  const res = await fetch(pb.backups.getDownloadURL(token, name));
  if (!res.ok) throw new Error(`backup download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== entry.size || buf.readUInt32LE(0) !== 0x04034b50) throw new Error("downloaded backup is incomplete");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, buf);
  log(`Backup: ${(buf.length / 1048576).toFixed(1)} MB on the server (Settings → Backups) and in ${path}`);
  return { name, path, size: buf.length };
}

export async function applyPlan(pb, plan, { password, log = console.log }) {
  const step = (s) => log(`\n▸ ${s}`);
  const importBatch = async (collection, records, mode = "create") => {
    const ids = [];
    for (let i = 0; i < records.length; i += BATCH) {
      const res = await withRetry(() => pb.send("/api/zarin/admin/import", {
        method: "POST", body: { hotel: H, collection, mode, records: records.slice(i, i + BATCH) },
      }));
      ids.push(...res.ids);
      if (records.length > BATCH) process.stdout.write(`\r  ${collection}: ${Math.min(i + BATCH, records.length)}/${records.length}`);
    }
    if (records.length > BATCH) process.stdout.write("\n");
    else log(`  ${collection}: ${records.length}`);
    return ids;
  };

  step(`Hotel «${plan.hotel.name}» (status trial)`);
  const hotel = await pb.collection("hotels").create(plan.hotel);
  const H = hotel.id;
  log(`  id ${H}`);

  step("Staff and users");
  const staffIds = await importBatch("staff", plan.staff.map((s) => ({ fields: s.fields })));
  const staffByEmp = new Map(plan.staff.map((s, i) => [s.emp, staffIds[i]]));
  const userByEmp = new Map();
  const usersByRole = new Map();
  let n = 0;
  for (const u of plan.users) {
    const rec = await withRetry(() => pb.collection("users").create({
      ...u.fields, hotels: [H], primaryHotel: H, password, passwordConfirm: password, staffId: u.emp ? staffByEmp.get(u.emp) : "",
    }));
    if (u.emp) userByEmp.set(u.emp, rec.id);
    if (!usersByRole.has(u.fields.role)) usersByRole.set(u.fields.role, []);
    usersByRole.get(u.fields.role).push(rec.id);
    process.stdout.write(`\r  users: ${++n}/${plan.users.length}`);
  }
  process.stdout.write("\n");
  await importBatch("staff", plan.staff.filter((s) => userByEmp.has(s.emp)).map((s) => ({ id: staffByEmp.get(s.emp), fields: { user: userByEmp.get(s.emp) } })), "update");

  const clients = new Map();
  const as = async (role) => {
    const id = (usersByRole.get(role) ?? usersByRole.get("generalManager"))[0];
    if (!clients.has(id)) {
      const c = await withRetry(() => pb.collection("users").impersonate(id, 4 * 3600));
      c.autoCancellation(false);
      clients.set(id, c);
    }
    return clients.get(id);
  };

  step("Rooms, inventory, daily operations, shifts");
  const roomIds = await importBatch("rooms", plan.rooms.map((r) => ({ fields: r.fields, updated: r.updated })));
  const roomByNumber = new Map(plan.rooms.map((r, i) => [r.number, roomIds[i]]));
  const itemIds = await importBatch("inventoryItems", plan.items.map((i) => ({ fields: i.fields })));
  const itemBySku = new Map(plan.items.map((i, k) => [i.sku, itemIds[k]]));
  await importBatch("dailyOperations", plan.operations);
  await importBatch("shifts", plan.shifts.map((s) => ({ fields: { ...s.fields, staff: staffByEmp.get(s.emp), user: userByEmp.get(s.emp) ?? "" } })));

  step(`History before ${plan.cutoff} (quiet: no alerts, notifications or room changes; real created dates)`);
  await importBatch("energyReadings", plan.energy.filter((r) => !r.recent).map((r) => ({ fields: r.fields })));
  const ticketByKey = new Map();
  const ticketFields = (t) => ({ ...t.create, ...t.state, room: roomByNumber.get(t.roomNumber) ?? "", roomNumber: t.roomNumber ?? "", assignee: userByEmp.get(t.assigneeEmp) ?? "" });
  const hist = plan.tickets.filter((t) => !t.recent);
  const histIds = await importBatch("maintenanceTickets", hist.map((t) => ({
    fields: { ...ticketFields(t), reportedByName: t.reportedByDept.slice(0, 80) }, created: t.created, updated: t.updated,
  })));
  hist.forEach((t, i) => ticketByKey.set(t.key, histIds[i]));
  await importBatch("tasks", plan.tasks.map((t) => ({
    fields: { ...t.fields, room: roomByNumber.get(t.roomNumber) ?? "", assignee: userByEmp.get(t.assigneeEmp) ?? "" }, created: t.created, updated: t.updated,
  })));
  await importBatch("inventoryMovements", plan.historyMovements.map((m) => ({ fields: { ...m.fields, item: itemBySku.get(m.sku) }, created: m.created, updated: m.created })));

  step(`Last ${plan.recentDays} days through the app API (hooks on: alerts are real)`);
  const energyPatch = [];
  const energyUser = await as("energyManager");
  for (const r of plan.energy.filter((x) => x.recent)) {
    const rec = await withRetry(() => energyUser.collection("energyReadings").create({ hotel: H, type: r.fields.type, day: r.fields.day, consumption: r.fields.consumption }));
    energyPatch.push({ id: rec.id, fields: { source: r.fields.source } });
  }
  log(`  energyReadings: ${energyPatch.length} as the energy manager`);
  if (energyPatch.length) await importBatch("energyReadings", energyPatch, "update");

  const recentTickets = plan.tickets.filter((t) => t.recent);
  const ticketPatch = [];
  for (const t of recentTickets) {
    const reporter = await as(REPORTER_ROLE[t.reportedByDept] ?? "generalManager");
    const rec = await withRetry(() => reporter.collection("maintenanceTickets").create({ hotel: H, ...t.create, room: roomByNumber.get(t.roomNumber) ?? "" }));
    ticketByKey.set(t.key, rec.id);
    const { status, assigneeName, slaDueAt, resolvedAt, resolutionNote } = t.state;
    ticketPatch.push({
      id: rec.id, created: t.created, updated: t.updated,
      fields: { status, assigneeName, slaDueAt, resolvedAt, resolutionNote, assignee: userByEmp.get(t.assigneeEmp) ?? "" },
    });
  }
  log(`  maintenanceTickets: ${ticketPatch.length} reported by staff of the reporting department`);
  if (ticketPatch.length) {
    await importBatch("maintenanceTickets", ticketPatch, "update");
    // The "created" timeline entry the app wrote, moved to the real time.
    const eventPatch = [];
    for (const t of recentTickets) {
      const id = ticketByKey.get(t.key);
      const evs = await withRetry(() => pb.collection("ticketEvents").getFullList({ filter: pb.filter("ticket = {:t} && type = 'created'", { t: id }), fields: "id" }));
      for (const ev of evs) eventPatch.push({ id: ev.id, fields: {}, created: t.created, updated: t.created });
    }
    if (eventPatch.length) await importBatch("ticketEvents", eventPatch, "update");
  }
  await importBatch("ticketEvents", plan.events.map((ev) => ({
    fields: { ...ev.fields, ticket: ticketByKey.get(ev.ticket), actor: userByEmp.get(ev.actorEmp) ?? "" }, created: ev.created, updated: ev.created,
  })));

  const storeUser = await as("inventoryManager");
  const movePatch = [];
  for (const m of plan.replay) {
    const res = await withRetry(() => storeUser.send(`/api/zarin/inventory/${itemBySku.get(m.sku)}/movements`, { method: "POST", body: m.body }));
    movePatch.push({ id: res.id, fields: {}, created: m.created, updated: m.created });
    process.stdout.write(`\r  inventory movements: ${movePatch.length}/${plan.replay.length} as the inventory manager`);
  }
  process.stdout.write("\n");
  if (movePatch.length) await importBatch("inventoryMovements", movePatch, "update");

  step("Room statuses from rooms.csv (updated = status_since)");
  await importBatch("rooms", plan.rooms.map((r) => ({ id: roomByNumber.get(r.number), fields: { status: r.fields.status, previousStatus: "", note: "" }, updated: r.updated })), "update");

  step(`Rollup (${addDays(plan.asOfDay, -30)} … ${addDays(plan.asOfDay, -1)}), insights and SLA check as of ${plan.asOf} Tehran`);
  const analytics = await withRetry(() => pb.send(`/api/zarin/admin/hotels/${H}/analytics`, {
    method: "POST",
    body: { rollup: { from: addDays(plan.asOfDay, -30), to: addDays(plan.asOfDay, -1) }, insights: true, sla: true, now: plan.asOfUtc.replace(" ", "T") },
  }));
  log(`  ${analytics.rolledUp.length} days rolled up, ${analytics.insightsCreated} insights created`);
  return { hotelId: H };
}
