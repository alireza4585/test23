/// <reference path="../../pb_data/types.d.ts" />
/** Analytics engine on PocketBase (ports analytics/loader.ts + scheduled.ts). */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

/** Everything the metrics/rule engine needs for one hotel (bounded windows). */
function loadHotelData(app, hotelId, fromDay, now) {
  const hotel = z.find(app, "hotels", hotelId);
  const since = z.pbDate(new Date(now.getTime() - 45 * 864e5));
  const p = { h: hotelId, d: fromDay, s: since };
  const date = (r, f) => z.parseDate(r.getString(f));
  return {
    hotelId,
    name: hotel.getString("name") || hotelId,
    settings: z.hotelSettings(app, hotelId),
    operations: z.findMany(app, "dailyOperations", "hotel = {:h} && day >= {:d}", p, "day").map((r) => ({
      day: r.getString("day"),
      roomsAvailable: r.getInt("roomsAvailable"),
      roomsOccupied: r.getInt("roomsOccupied"),
      roomRevenue: r.getFloat("roomRevenue"),
      fnbRevenue: r.getFloat("fnbRevenue"),
      otherRevenue: r.getFloat("otherRevenue"),
    })),
    energy: z.findMany(app, "energyReadings", "hotel = {:h} && day >= {:d}", p, "day").map((r) => ({
      day: r.getString("day"), type: r.getString("type"), consumption: r.getFloat("consumption"),
    })),
    tickets: z.findMany(app, "maintenanceTickets", "hotel = {:h} && (created >= {:s} || status = 'open' || status = 'assigned' || status = 'inProgress' || status = 'onHold')", p).map((r) => ({
      id: r.id,
      title: r.getString("title"),
      category: r.getString("category"),
      priority: r.getString("priority"),
      status: r.getString("status"),
      roomId: r.getString("room") || null,
      roomNumber: r.getString("roomNumber") || null,
      area: r.getString("area") || null,
      createdAt: date(r, "created"),
      slaDueAt: date(r, "slaDueAt"),
      resolvedAt: date(r, "resolvedAt"),
    })),
    tasks: z.findMany(app, "tasks", "hotel = {:h} && day >= {:d}", p).map((r) => ({
      type: r.getString("type"), status: r.getString("status"), day: r.getString("day"),
      startedAt: date(r, "startedAt"), completedAt: date(r, "completedAt"),
    })),
    items: z.findMany(app, "inventoryItems", "hotel = {:h}", p).map((r) => ({
      id: r.id, name: r.getString("name"), unit: r.getString("unit"), quantity: r.getFloat("quantity"),
      reorderLevel: r.getFloat("reorderLevel"), reorderQuantity: r.getFloat("reorderQuantity"), unitCost: r.getFloat("unitCost"),
    })),
    movements: z.findMany(app, "inventoryMovements", "hotel = {:h} && created >= {:s}", p).map((r) => ({
      itemId: r.getString("item"), type: r.getString("type"), delta: r.getFloat("delta"), createdAt: date(r, "created"),
    })),
    rooms: z.findMany(app, "rooms", "hotel = {:h}", p).map((r) => ({
      id: r.id, number: r.getString("number"), status: r.getString("status"), updatedAt: date(r, "updated"),
    })),
  };
}

function metricsFor(data, day, now) {
  return core.computeDailyMetrics({
    day, now, dayKeyOf: z.dayKey, settings: data.settings,
    operations: data.operations.find((o) => o.day === day),
    energy: data.energy, tickets: data.tickets, tasks: data.tasks, items: data.items, rooms: data.rooms,
  });
}

/** Writes `dailyMetrics` for [day] (idempotent upsert). */
function rollup(app, hotelId, day, now) {
  const data = loadHotelData(app, hotelId, z.addDays(day, -2), now);
  const m = metricsFor(data, day, now);
  let rec = z.findFirst(app, "dailyMetrics", "hotel = {:h} && day = {:d}", { h: hotelId, d: day });
  if (!rec) rec = new Record(z.col(app, "dailyMetrics"), { hotel: hotelId, day });
  rec.set("occupancyRate", m.occupancyRate);
  rec.set("adr", m.adr);
  rec.set("revpar", m.revpar);
  rec.set("totalRevenue", m.totalRevenue);
  rec.set("data", m);
  app.save(rec);
  return m;
}

/** Insight ids are stable per rule & subject; dismissed ones stay quiet 14 days. */
function upsertInsight(app, hotelId, draft, now) {
  let rec = z.findFirst(app, "aiInsights", "hotel = {:h} && key = {:k}", { h: hotelId, k: draft.id });
  const fields = {
    rule: draft.rule, category: draft.category, title: draft.title, summary: draft.summary,
    recommendation: draft.recommendation, evidence: draft.evidence, confidence: draft.confidence,
    priority: draft.priority, estimatedMonthlySaving: draft.estimatedMonthlySaving || 0,
    route: draft.route || "", audienceRoles: draft.audienceRoles,
  };
  if (rec) {
    const status = rec.getString("status");
    const updated = z.parseDate(rec.getString("updated"));
    if (status !== "active" && updated && now.getTime() - updated.getTime() < 14 * 864e5) return false;
    if (status === "active") {
      rec.load(fields);
      app.save(rec);
      return false;
    }
  } else {
    rec = new Record(z.col(app, "aiInsights"), { hotel: hotelId, key: draft.id });
  }
  rec.load(Object.assign(fields, { status: "active", source: "rules", model: "" }));
  app.save(rec);
  if (draft.priority === "high") {
    z.notify(app, {
      hotelId, roles: draft.audienceRoles, title: draft.title, body: draft.recommendation,
      category: "ai", severity: "warning", route: "/insights",
    });
  }
  z.emit(app, "insight.created", hotelId, { insightId: draft.id, title: draft.title, priority: draft.priority });
  return true;
}

function slaAlerts(app, hotelId, tickets, now) {
  for (const t of tickets) {
    if (!core.isActiveTicket(t) || !t.slaDueAt || t.slaDueAt >= now) continue;
    z.raiseAlert(app, {
      hotelId, type: "maintenanceSla",
      severity: t.priority === "critical" || t.priority === "high" ? "critical" : "warning",
      title: `عبور از SLA: ${t.title}`, message: `محل: ${t.roomNumber || t.area || "—"}`,
      route: `/maintenance/${t.id}`, audienceRoles: ["maintenanceManager", "operationsManager"],
      dedupeKey: `sla_${t.id}`, source: "ruleEngine",
    });
  }
}

function runInsights(app, hotelId, now) {
  const today = z.dayKey(now);
  const data = loadHotelData(app, hotelId, z.addDays(today, -35), now);
  const drafts = core.generateInsights(Object.assign({}, data, { today, now, addDays: z.addDays }));
  let created = 0;
  for (const d of drafts) if (upsertInsight(app, hotelId, d, now)) created++;
  slaAlerts(app, hotelId, data.tickets, now);
  return created;
}

function checkSla(app, hotelId, now) {
  const data = loadHotelData(app, hotelId, z.dayKey(now), now);
  slaAlerts(app, hotelId, data.tickets, now);
}

/** KPIs + open alerts + active insights for one day (default: yesterday). */
function summary(app, hotelId, day, now) {
  const target = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : z.addDays(z.dayKey(now), -1);
  const data = loadHotelData(app, hotelId, z.addDays(target, -7), now);
  const p = { h: hotelId };
  return {
    hotelId,
    hotel: data.name,
    day: target,
    metrics: metricsFor(data, target, now),
    alerts: z.findMany(app, "alerts", "hotel = {:h} && (status = 'open' || status = 'acknowledged')", p, "-created", 20).map((a) => ({
      id: a.id, severity: a.getString("severity"), title: a.getString("title"), message: a.getString("message"),
    })),
    insights: z.findMany(app, "aiInsights", "hotel = {:h} && status = 'active'", p, "-created", 10).map((i) => ({
      id: i.id, title: i.getString("title"), recommendation: i.getString("recommendation"),
      estimatedMonthlySaving: i.getFloat("estimatedMonthlySaving") || null,
    })),
  };
}

function overdue(app, hotelId, now) {
  const data = loadHotelData(app, hotelId, z.addDays(z.dayKey(now), -1), now);
  return {
    tickets: data.tickets
      .filter((t) => core.isActiveTicket(t) && t.slaDueAt && t.slaDueAt < now)
      .map((t) => ({
        id: t.id, title: t.title, priority: t.priority, status: t.status,
        location: t.roomNumber || t.area || null,
        overdueMinutes: Math.round((now.getTime() - t.slaDueAt.getTime()) / 60000),
      })),
  };
}

module.exports = { loadHotelData, metricsFor, rollup, runInsights, checkSla, summary, overdue };
