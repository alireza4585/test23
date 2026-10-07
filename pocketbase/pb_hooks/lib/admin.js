/// <reference path="../../pb_data/types.d.ts" />
/**
 * Superuser-only tools for loading datasets into a *trial* hotel
 * (scripts/import-dataset.mjs) and for running analytics on demand.
 *
 * POST /api/zarin/admin/import
 *   {hotel, collection, mode: "create"|"update", records: [{id?, fields, created?, updated?}]}
 *   Records are saved normally (full validation) but marked as imported, so
 *   the model hooks that raise alerts, notify and move rooms to outOfOrder
 *   (afterTicketCreated, afterEnergyWritten) leave them alone. `created` /
 *   `updated` (UTC, "YYYY-MM-DD HH:MM:SS.sssZ") replace the server stamps so
 *   history keeps its real dates. Only hotels with status "trial" accept
 *   imports, which keeps production hotels out of reach.
 *
 * POST /api/zarin/admin/hotels/{id}/analytics
 *   {rollup?: {from, to}, insights?: bool, sla?: bool, now?: ISO date}
 */
const z = require(`${__hooks}/lib/zarin.js`);
const analytics = require(`${__hooks}/lib/analytics.js`);

const IMPORTABLE = [
  "rooms", "staff", "shifts", "tasks", "maintenanceTickets", "ticketEvents",
  "energyReadings", "dailyOperations", "inventoryItems", "inventoryMovements",
];
const MAX_BATCH = 500;
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CLOSED_TICKET = ["resolved", "closed", "cancelled"];

function trialHotel(app, id) {
  const hotel = z.find(app, "hotels", id);
  if (hotel.getString("status") !== "trial") throw z.forbidden("import_requires_trial_hotel");
  return hotel;
}

function stamps(r, mode) {
  const out = {};
  if (r.created) out.created = String(r.created);
  if (r.updated) out.updated = String(r.updated);
  else if (mode === "create" && r.created) out.updated = String(r.created);
  for (const v of Object.values(out)) if (!STAMP.test(v)) throw z.bad("invalid_timestamp", { value: v });
  return out;
}

function importRecords(e) {
  const b = e.requestInfo().body || {};
  const name = b.collection;
  const mode = b.mode === "update" ? "update" : "create";
  const records = Array.isArray(b.records) ? b.records : [];
  if (IMPORTABLE.indexOf(name) < 0) throw z.bad("collection_not_importable");
  if (!records.length || records.length > MAX_BATCH) throw z.bad("invalid_batch", { max: MAX_BATCH });
  const ids = [];
  e.app.runInTransaction((tx) => {
    trialHotel(tx, b.hotel);
    const collection = z.col(tx, name);
    for (const r of records) {
      let rec;
      if (mode === "update") {
        rec = z.find(tx, name, r.id);
        if (rec.getString("hotel") !== b.hotel) throw z.forbidden("other_hotel");
      } else {
        rec = new Record(collection);
      }
      const ts = stamps(r, mode);
      rec.load(r.fields || {});
      rec.set("hotel", b.hotel);
      z.markImported(rec);
      tx.save(rec);
      const keys = Object.keys(ts);
      if (keys.length) {
        tx.db().newQuery(`UPDATE ${name} SET ${keys.map((k) => `${k} = {:${k}}`).join(", ")} WHERE id = {:id}`)
          .bind(Object.assign({ id: rec.id }, ts)).execute();
      }
      // Closing a ticket closes its alerts, as POST /api/zarin/tickets/{id}/status does.
      if (name === "maintenanceTickets" && CLOSED_TICKET.indexOf(rec.getString("status")) >= 0) {
        z.resolveAlert(tx, b.hotel, `ticket_${rec.id}`);
        z.resolveAlert(tx, b.hotel, `sla_${rec.id}`);
      }
      ids.push(rec.id);
    }
    z.audit(tx, b.hotel, {
      action: `import.${name}`, collection: name, actor: { uid: e.auth.id, type: "superuser" },
      changes: { mode, count: records.length }, source: "server",
    });
  });
  return e.json(200, { ids });
}

function runAnalytics(e) {
  const b = e.requestInfo().body || {};
  const hotelId = e.request.pathValue("id");
  z.find(e.app, "hotels", hotelId);
  const now = b.now ? new Date(b.now) : new Date();
  if (isNaN(now.getTime())) throw z.bad("invalid_now");
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const out = { now: now.toISOString(), rolledUp: [], insightsCreated: null, sla: false };
  if (b.rollup) {
    const { from, to } = b.rollup;
    if (!day.test(from || "") || !day.test(to || "") || from > to) throw z.bad("invalid_range");
    for (let d = from, n = 0; d <= to; d = z.addDays(d, 1), n++) {
      if (n > 400) throw z.bad("range_too_long");
      analytics.rollup(e.app, hotelId, d, now);
      out.rolledUp.push(d);
    }
  }
  if (b.insights) out.insightsCreated = analytics.runInsights(e.app, hotelId, now);
  if (b.sla) {
    analytics.checkSla(e.app, hotelId, now);
    out.sla = true;
  }
  return e.json(200, out);
}

module.exports = { IMPORTABLE, importRecords, runAnalytics };
