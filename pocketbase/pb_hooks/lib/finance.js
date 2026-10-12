/// <reference path="../../pb_data/types.d.ts" />
/**
 * Daily revenue lives in `dailyFinance` (read: finance.view). It is entered
 * write-only: finance.record lets a role record revenue without ever reading
 * it back; a correction is a new entry.
 *
 *   POST /api/zarin/operations/daily
 *     {hotelId, day, roomsAvailable, roomsOccupied, guests?,
 *      revenue?: {roomRevenue, fnbRevenue, otherRevenue}}
 *     → {day, financeRecorded}      (never the revenue)
 *
 * Revenue written to dailyOperations by any other path (older app versions
 * through REST, superuser scripts, the importer) is moved here by the model
 * hook and cleared on the operations record.
 */
const z = require(`${__hooks}/lib/zarin.js`);

const REVENUE = ["roomRevenue", "fnbRevenue", "otherRevenue"];
const METRICS = ["adr", "revpar", "totalRevenue"];
const SOURCES = ["manual", "pms", "import", "seed", "migration"];

function financeRow(app, hotelId, day) {
  return z.findFirst(app, "dailyFinance", "hotel = {:h} && day = {:d}", { h: hotelId, d: day });
}

function upsert(app, hotelId, day, fields) {
  let rec = financeRow(app, hotelId, day);
  if (!rec) rec = new Record(z.col(app, "dailyFinance"), { hotel: hotelId, day });
  for (const k of Object.keys(fields)) rec.set(k, fields[k]);
  app.save(rec);
  return rec;
}

/** Model hook (create/update of dailyOperations, every path): revenue → dailyFinance. */
function moveRevenue(e) {
  const r = e.record;
  const values = {};
  let any = false;
  for (const f of REVENUE) {
    const v = r.getFloat(f);
    values[f] = v;
    if (v > 0) any = true;
  }
  if (any) {
    const source = r.getString("source");
    upsert(e.app, r.getString("hotel"), r.getString("day"), Object.assign(values, {
      source: SOURCES.indexOf(source) >= 0 ? source : "manual",
      updatedBy: r.getString("updatedBy"),
      updatedByName: r.getString("updatedByName"),
    }));
    r.set("financeRecorded", true);
  }
  for (const f of REVENUE) r.set(f, 0);
  e.next();
}

/** Revenue by day for [hotelId] from [fromDay] (server-side readers only). */
function revenueByDay(app, hotelId, fromDay) {
  const out = {};
  for (const r of z.findMany(app, "dailyFinance", "hotel = {:h} && day >= {:d}", { h: hotelId, d: fromDay }, "day")) {
    out[r.getString("day")] = {
      roomRevenue: r.getFloat("roomRevenue"),
      fnbRevenue: r.getFloat("fnbRevenue"),
      otherRevenue: r.getFloat("otherRevenue"),
    };
  }
  return out;
}

/** Rollup: ADR, RevPAR and total revenue of [day] go to dailyFinance only. */
function writeMetrics(app, hotelId, day, m) {
  const rec = financeRow(app, hotelId, day);
  if (!rec && m.totalRevenue === null) return;
  const fields = {};
  for (const k of METRICS) fields[k] = m[k] === null || m[k] === undefined ? null : m[k];
  if (!rec) fields.source = "manual";
  upsert(app, hotelId, day, fields);
}

/** Metrics without the finance keys (what dailyMetrics may hold). */
function withoutFinance(m) {
  const copy = JSON.parse(JSON.stringify(m));
  for (const k of METRICS) delete copy[k];
  return copy;
}

function amount(v) {
  const n = Number(v);
  return isFinite(n) && n >= 0 && n <= 1e15 ? n : null;
}

function recordDaily(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const hotelId = z.requireHotel(c, b.hotelId);
  z.requirePerm(c, "operations.recordDaily");
  const day = String(b.day || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > z.dayKey(new Date())) throw z.bad("invalid_day");
  const available = Number(b.roomsAvailable);
  const occupied = Number(b.roomsOccupied);
  const guests = b.guests === undefined || b.guests === null ? null : Number(b.guests);
  if (!Number.isInteger(available) || available < 0 || !Number.isInteger(occupied) || occupied < 0) throw z.bad("invalid_body");
  if (occupied > available) throw z.bad("occupied_exceeds_available");
  if (guests !== null && (!Number.isInteger(guests) || guests < 0)) throw z.bad("invalid_body");
  let revenue = null;
  if (b.revenue !== undefined && b.revenue !== null) {
    z.requirePerm(c, "finance.record");
    revenue = {};
    for (const f of REVENUE) {
      revenue[f] = amount(b.revenue[f]);
      if (revenue[f] === null) throw z.bad("invalid_revenue", { field: f });
    }
  }
  let recorded = false;
  e.app.runInTransaction((tx) => {
    let rec = z.findFirst(tx, "dailyOperations", "hotel = {:h} && day = {:d}", { h: hotelId, d: day });
    if (!rec) rec = new Record(z.col(tx, "dailyOperations"), { hotel: hotelId, day });
    rec.set("roomsAvailable", available);
    rec.set("roomsOccupied", occupied);
    if (guests !== null) rec.set("guests", guests);
    rec.set("source", "manual");
    rec.set("updatedBy", c.id);
    rec.set("updatedByName", c.name);
    tx.save(rec);
    if (revenue) {
      // Explicit entry: also a re-entry of zeros counts (it is a correction).
      upsert(tx, hotelId, day, Object.assign({}, revenue, { source: "manual", updatedBy: c.id, updatedByName: c.name }));
      rec.set("financeRecorded", true);
      tx.save(rec);
    }
    recorded = rec.getBool("financeRecorded");
    z.audit(tx, hotelId, {
      action: "operations.recordDaily", collection: "dailyOperations", id: rec.id, actor: z.actorOf(c),
      // Which fields changed, never the revenue amounts.
      changes: { day, roomsAvailable: available, roomsOccupied: occupied, revenueEntered: !!revenue },
    });
  });
  return e.json(200, { day, financeRecorded: recorded });
}

module.exports = { REVENUE, METRICS, moveRevenue, revenueByDay, writeMetrics, withoutFinance, recordDaily };
