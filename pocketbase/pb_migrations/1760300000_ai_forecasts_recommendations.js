/// <reference path="../pb_data/types.d.ts" />
/**
 * AI batch 1: hotel calendar events, KPI forecasts with their backtest
 * accuracy, and the recommendation ledger fields on aiInsights (expected
 * impact, decision, linked work, evaluation, auto-close).
 */
migrate((app) => {
  const SA = "@request.auth.role = 'superAdmin'";
  const member = (f) => `(@request.auth.hotels.id ?= ${f || "hotel"} || ${SA})`;
  const perm = (p) => `@request.auth.permissions.code ?= '${p}'`;
  const can = (p) => `${member()} && ${perm(p)}`;
  const canAny = (ps) => `${member()} && (${ps.map(perm).join(" || ")})`;
  const dayPattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
  const stamps = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const hotels = app.findCollectionByNameOrId("hotels");
  const users = app.findCollectionByNameOrId("users");
  const hotel = { name: "hotel", type: "relation", collectionId: hotels.id, maxSelect: 1, required: true, cascadeDelete: true };
  const SERIES = ["occupancy", "roomRevenue", "totalRevenue", "electricity", "water", "gas"];

  app.save(new Collection({
    type: "base",
    name: "calendarEvents",
    fields: [
      hotel,
      { name: "day", type: "text", required: true, pattern: dayPattern },
      { name: "endDay", type: "text", pattern: `^$|${dayPattern}` },
      { name: "kind", type: "select", maxSelect: 1, required: true, values: ["publicHoliday", "religious", "school", "localEvent", "closure", "other"] },
      { name: "title", type: "text", required: true, max: 120 },
      { name: "note", type: "text", max: 500 },
      { name: "createdBy", type: "relation", collectionId: users.id, maxSelect: 1 },
      ...stamps,
    ],
    indexes: ["CREATE INDEX idx_calendar_day ON calendarEvents (hotel, day)"],
    listRule: member(),
    viewRule: member(),
    createRule: can("hotel.settings"),
    updateRule: can("hotel.settings"),
    deleteRule: can("hotel.settings"),
  }));

  const forecastReaders = canAny(["dashboard.executive", "dashboard.operations"]);
  app.save(new Collection({
    type: "base",
    name: "forecasts",
    fields: [
      hotel,
      { name: "series", type: "select", maxSelect: 1, required: true, values: SERIES },
      { name: "day", type: "text", required: true, pattern: dayPattern },
      { name: "value", type: "number" },
      { name: "lower", type: "number" },
      { name: "upper", type: "number" },
      { name: "model", type: "text", max: 40 },
      { name: "runId", type: "text", max: 40 },
      ...stamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_forecasts ON forecasts (hotel, series, day)"],
    listRule: forecastReaders,
    viewRule: forecastReaders,
  }));

  app.save(new Collection({
    type: "base",
    name: "forecastRuns",
    fields: [
      hotel,
      { name: "series", type: "select", maxSelect: 1, required: true, values: SERIES },
      { name: "ok", type: "bool" },
      { name: "reason", type: "text", max: 60 },
      { name: "model", type: "text", max: 40 },
      { name: "scores", type: "json", maxSize: 20000 },
      { name: "live", type: "json", maxSize: 20000 },
      { name: "trainedFrom", type: "text", max: 10 },
      { name: "trainedTo", type: "text", max: 10 },
      { name: "history", type: "number", onlyInt: true },
      { name: "missing", type: "number", onlyInt: true },
      { name: "horizon", type: "number", onlyInt: true },
      { name: "backtestHorizon", type: "number", onlyInt: true },
      { name: "interval", type: "number" },
      { name: "runId", type: "text", max: 40 },
      { name: "generatedAt", type: "date" },
      ...stamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_forecast_runs ON forecastRuns (hotel, series)"],
    listRule: forecastReaders,
    viewRule: forecastReaders,
  }));

  const insights = app.findCollectionByNameOrId("aiInsights");
  const status = insights.fields.getByName("status");
  status.values = ["active", "accepted", "dismissed", "implemented", "resolved"];
  insights.fields.add(new JSONField({ name: "expectedImpact", maxSize: 20000 }));
  insights.fields.add(new JSONField({ name: "evaluation", maxSize: 20000 }));
  insights.fields.add(new TextField({ name: "decisionNote", max: 1000 }));
  insights.fields.add(new RelationField({ name: "decidedBy", collectionId: users.id, maxSelect: 1 }));
  insights.fields.add(new TextField({ name: "decidedByName", max: 120 }));
  insights.fields.add(new DateField({ name: "decidedAt" }));
  insights.fields.add(new RelationField({ name: "linkedTicket", collectionId: app.findCollectionByNameOrId("maintenanceTickets").id, maxSelect: 1 }));
  insights.fields.add(new RelationField({ name: "linkedTask", collectionId: app.findCollectionByNameOrId("tasks").id, maxSelect: 1 }));
  insights.fields.add(new TextField({ name: "closedReason", max: 300 }));
  app.save(insights);
}, (app) => {
  for (const name of ["calendarEvents", "forecasts", "forecastRuns"]) {
    app.delete(app.findCollectionByNameOrId(name));
  }
  const insights = app.findCollectionByNameOrId("aiInsights");
  for (const f of ["expectedImpact", "evaluation", "decisionNote", "decidedBy", "decidedByName", "decidedAt", "linkedTicket", "linkedTask", "closedReason"]) {
    insights.fields.removeByName(f);
  }
  insights.fields.getByName("status").values = ["active", "accepted", "dismissed", "implemented"];
  app.save(insights);
});
