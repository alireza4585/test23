/// <reference path="../pb_data/types.d.ts" />
/**
 * AI phase 0.5: revenue leaves the operational collections.
 *
 * Up:
 * - new `dailyFinance` (hotel, day): room/F&B/other revenue and ADR, RevPAR,
 *   total revenue; readable only with finance.view, written only by hooks;
 * - existing revenue is copied from dailyOperations, and ADR/RevPAR/total
 *   from dailyMetrics (columns and the `data` JSON), then cleared there; the
 *   revenue fields of both collections are also marked hidden;
 * - dailyOperations.financeRecorded tells recorders that revenue exists
 *   without showing it;
 * - forecasts/forecastRuns: revenue series need finance.view;
 * - aiInsights: category "revenue" needs finance.view;
 * - reports.containsFinance (executive summaries so far: true) needs finance.view;
 * - dailyOperations has no REST create/update for users any more: PocketBase
 *   silently drops hidden fields from a user's request body, so an older app
 *   sending revenue would lose it without an error. Writes go through
 *   POST /api/zarin/operations/daily; an older app gets a clear refusal.
 * Down restores every moved value from dailyFinance, the rules and the
 * field options, then drops dailyFinance. Take a backup first anyway.
 */
const OPS_REVENUE = ["roomRevenue", "fnbRevenue", "otherRevenue"];
const METRIC_FINANCE = ["adr", "revpar", "totalRevenue"];
const REVENUE_SERIES = "(series != 'roomRevenue' && series != 'totalRevenue')";

const SA = "@request.auth.role = 'superAdmin'";
const member = "(@request.auth.hotels.id ?= hotel || " + SA + ")";
const perm = (p) => `@request.auth.permissions.code ?= '${p}'`;
const can = (p) => `${member} && ${perm(p)}`;
const canAny = (ps) => `${member} && (${ps.map(perm).join(" || ")})`;

const OLD = {
  forecasts: canAny(["dashboard.executive", "dashboard.operations"]),
  aiInsights: can("ai.insights.view"),
  reports: can("reports.view"),
};
// users.financeView (see 1760500000): a second permissions.code test in the
// same rule would have to match the same permission row.
const FIN = "@request.auth.financeView = true";
const NEW = {
  forecasts: `${OLD.forecasts} && (${REVENUE_SERIES} || ${FIN})`,
  aiInsights: `${OLD.aiInsights} && (category != 'revenue' || ${FIN})`,
  reports: `${OLD.reports} && (containsFinance = false || ${FIN})`,
};

function setRules(app, name, rule) {
  const c = app.findCollectionByNameOrId(name);
  c.listRule = rule;
  c.viewRule = rule;
  app.save(c);
}

function hide(app, name, fields, hidden) {
  const c = app.findCollectionByNameOrId(name);
  for (const f of fields) c.fields.getByName(f).hidden = hidden;
  app.save(c);
}

/** A JSON field as a plain object (the raw value is bytes: go through toString). */
function jsonOf(rec, field) {
  const raw = rec.get(field);
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const v = JSON.parse(toString(raw));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch (_) {
    return null;
  }
}

migrate((app) => {
  const hotels = app.findCollectionByNameOrId("hotels");
  const users = app.findCollectionByNameOrId("users");
  const fin = new Collection({
    type: "base",
    name: "dailyFinance",
    fields: [
      { name: "hotel", type: "relation", collectionId: hotels.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "day", type: "text", required: true, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
      { name: "roomRevenue", type: "number", min: 0 },
      { name: "fnbRevenue", type: "number", min: 0 },
      { name: "otherRevenue", type: "number", min: 0 },
      { name: "adr", type: "number" },
      { name: "revpar", type: "number" },
      { name: "totalRevenue", type: "number" },
      { name: "source", type: "select", maxSelect: 1, values: ["manual", "pms", "import", "seed", "migration"] },
      { name: "updatedBy", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "updatedByName", type: "text", max: 80 },
      // The dailyMetrics finance values as they were before this migration
      // (null included), so the down migration restores them exactly.
      { name: "migratedFrom", type: "json", maxSize: 2000, hidden: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_daily_finance ON dailyFinance (hotel, day)"],
    listRule: can("finance.view"),
    viewRule: can("finance.view"),
  });
  app.save(fin);

  const ops = app.findCollectionByNameOrId("dailyOperations");
  ops.fields.add(new BoolField({ name: "financeRecorded" }));
  app.save(ops);

  const reports = app.findCollectionByNameOrId("reports");
  reports.fields.add(new BoolField({ name: "containsFinance" }));
  app.save(reports);

  const rows = {};
  const rowFor = (hotel, day) => {
    const k = `${hotel}|${day}`;
    if (!rows[k]) rows[k] = { hotel, day };
    return rows[k];
  };
  // Raw SQL: no hooks, no field visibility, and nothing is lost if a value is 0.
  for (const r of app.findAllRecords("dailyOperations")) {
    const row = rowFor(r.getString("hotel"), r.getString("day"));
    for (const f of OPS_REVENUE) row[f] = r.getFloat(f);
    row.source = r.getString("source") || "migration";
  }
  for (const r of app.findAllRecords("dailyMetrics")) {
    const row = rowFor(r.getString("hotel"), r.getString("day"));
    const data = jsonOf(r, "data");
    const snapshot = { columns: {}, data: data ? {} : null };
    for (const f of METRIC_FINANCE) {
      snapshot.columns[f] = r.getFloat(f);
      if (data) snapshot.data[f] = f in data ? data[f] : "__absent__";
      row[f] = data && data[f] !== undefined && data[f] !== null ? data[f] : r.getFloat(f);
    }
    row.migratedFrom = snapshot;
  }
  for (const k of Object.keys(rows)) {
    const row = rows[k];
    const rec = new Record(fin, { hotel: row.hotel, day: row.day, source: row.source || "migration" });
    for (const f of OPS_REVENUE.concat(METRIC_FINANCE)) if (row[f] !== undefined && row[f] !== null) rec.set(f, row[f]);
    if (row.migratedFrom) rec.set("migratedFrom", row.migratedFrom);
    app.save(rec);
  }

  const db = app.db();
  db.newQuery("UPDATE dailyOperations SET financeRecorded = (roomRevenue > 0 OR fnbRevenue > 0 OR otherRevenue > 0)").execute();
  db.newQuery("UPDATE dailyOperations SET roomRevenue = 0, fnbRevenue = 0, otherRevenue = 0").execute();
  for (const r of app.findAllRecords("dailyMetrics")) {
    const data = jsonOf(r, "data");
    if (data) {
      for (const f of METRIC_FINANCE) delete data[f];
      db.newQuery("UPDATE dailyMetrics SET data = {:d} WHERE id = {:id}").bind({ d: JSON.stringify(data), id: r.id }).execute();
    }
  }
  db.newQuery("UPDATE dailyMetrics SET adr = 0, revpar = 0, totalRevenue = 0").execute();
  db.newQuery("UPDATE reports SET containsFinance = (type = 'executiveSummary')").execute();

  hide(app, "dailyOperations", OPS_REVENUE, true);
  const opsRules = app.findCollectionByNameOrId("dailyOperations");
  opsRules.createRule = null;
  opsRules.updateRule = null;
  app.save(opsRules);
  hide(app, "dailyMetrics", METRIC_FINANCE, true);
  setRules(app, "forecasts", NEW.forecasts);
  setRules(app, "forecastRuns", NEW.forecasts);
  setRules(app, "aiInsights", NEW.aiInsights);
  setRules(app, "reports", NEW.reports);
}, (app) => {
  const db = app.db();
  for (const f of app.findAllRecords("dailyFinance")) {
    const p = { h: f.getString("hotel"), d: f.getString("day") };
    db.newQuery("UPDATE dailyOperations SET roomRevenue = {:r}, fnbRevenue = {:f}, otherRevenue = {:o} WHERE hotel = {:h} AND day = {:d}")
      .bind(Object.assign({ r: f.getFloat("roomRevenue"), f: f.getFloat("fnbRevenue"), o: f.getFloat("otherRevenue") }, p)).execute();
    let m = null;
    try {
      m = app.findFirstRecordByFilter("dailyMetrics", "hotel = {:h} && day = {:d}", p);
    } catch (_) {}
    if (m) {
      const data = jsonOf(m, "data");
      const snap = jsonOf(f, "migratedFrom");
      const columns = {};
      for (const k of METRIC_FINANCE) {
        // Rows from before the migration come back exactly; newer rows from dailyFinance.
        columns[k] = snap ? snap.columns[k] : f.getFloat(k);
        if (!data) continue;
        if (snap && snap.data) {
          if (snap.data[k] === "__absent__") delete data[k];
          else data[k] = snap.data[k];
        } else {
          data[k] = f.getFloat(k);
        }
      }
      db.newQuery("UPDATE dailyMetrics SET adr = {:a}, revpar = {:r}, totalRevenue = {:t}" + (data ? ", data = {:d}" : "") + " WHERE id = {:id}")
        .bind({ a: columns.adr, r: columns.revpar, t: columns.totalRevenue, d: data ? JSON.stringify(data) : "", id: m.id }).execute();
    }
  }
  hide(app, "dailyOperations", OPS_REVENUE, false);
  const opsRules = app.findCollectionByNameOrId("dailyOperations");
  opsRules.createRule = can("operations.recordDaily");
  opsRules.updateRule = can("operations.recordDaily");
  app.save(opsRules);
  hide(app, "dailyMetrics", METRIC_FINANCE, false);
  setRules(app, "forecasts", OLD.forecasts);
  setRules(app, "forecastRuns", OLD.forecasts);
  setRules(app, "aiInsights", OLD.aiInsights);
  setRules(app, "reports", OLD.reports);
  const reports = app.findCollectionByNameOrId("reports");
  reports.fields.removeByName("containsFinance");
  app.save(reports);
  const ops = app.findCollectionByNameOrId("dailyOperations");
  ops.fields.removeByName("financeRecorded");
  app.save(ops);
  app.delete(app.findCollectionByNameOrId("dailyFinance"));
});
