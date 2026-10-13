/// <reference path="../pb_data/types.d.ts" />
/**
 * AI phase 1 (F1 Action Center, F2 weather-normalised energy, F4 morning
 * briefing), additive only:
 *
 * - weatherDaily: daily temperature per hotel (adapter cron, signed push or
 *   the dataset importer; `source` says which).
 * - energyModels: fitted energy models with their quality statistics; one
 *   `active` model per hotel and meter type, older ones `superseded`.
 * - energyExpected: expected consumption and band per day, with the residual
 *   and CUSUM once the reading is known.
 * - energyExclusions: days kept out of the model fit (adjustBaseline actions).
 * - aiActions: typed, approvable actions attached to insights, with the
 *   decision, execution and measured outcome.
 * - briefings: the morning briefing per hotel, day and role.
 * - permission `ai.actions.approve` (34 permissions), role templates and users
 *   recomputed. An existing override gets it when it already allows
 *   ai.insights.view for a role whose template has it.
 *
 * All new collections are written by the server only (no create/update/delete
 * rules). Revenue-derived actions and finance briefing items follow the
 * users.financeView rule of phase 0.5.
 */
const CODE = "ai.actions.approve";
const ENERGY_TYPES = ["electricity", "water", "gas"];
const ACTION_TYPES = ["createTicket", "createTask", "notifyRole", "adjustBaseline"];
const ACTION_STATUS = ["proposed", "executed", "failed", "rejected", "expired"];
const DEPARTMENTS = ["energy", "maintenance", "housekeeping", "inventory", "restaurant", "operations"];
const CATEGORIES = ["energy", "maintenance", "housekeeping", "inventory", "revenue", "staffing"];

function permissionIds(app) {
  const permId = {};
  for (const p of app.findAllRecords("permissions")) permId[p.getString("code")] = p.id;
  return permId;
}

function setMaxSelect(app, n) {
  for (const [name, field] of [["users", "permissions"], ["roleTemplates", "permissions"], ["roleOverrides", "permissions"]]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.getByName(field).maxSelect = n;
    app.save(c);
  }
}

function idsFor(app, core, permId, role, hotelId) {
  let codes = (core.ROLE_PERMISSIONS[role] || []).slice();
  if (hotelId) {
    let override = null;
    try {
      override = app.findFirstRecordByFilter("roleOverrides", "hotel = {:h} && role = {:r}", { h: hotelId, r: role });
    } catch (_) {}
    if (override) {
      const allowed = {};
      for (const p of app.findRecordsByIds("permissions", override.getStringSlice("permissions"))) allowed[p.getString("code")] = true;
      codes = codes.filter((c) => allowed[c]);
    }
  }
  return codes.map((c) => permId[c]).filter(Boolean);
}

function resyncUsers(app, core, permId) {
  for (const u of app.findAllRecords("users")) {
    const role = u.getString("role");
    if (!role) continue;
    const hotelId = u.getString("primaryHotel") || (u.getStringSlice("hotels")[0] || "");
    const ids = idsFor(app, core, permId, role, hotelId);
    u.set("permissions", ids);
    u.set("financeView", ids.indexOf(permId["finance.view"]) >= 0);
    app.saveNoValidate(u);
  }
}

migrate((app) => {
  const core = require(`${__hooks}/lib/core.js`);
  const hotels = app.findCollectionByNameOrId("hotels");
  const users = app.findCollectionByNameOrId("users");
  const insights = app.findCollectionByNameOrId("aiInsights");
  const SA = "@request.auth.role = 'superAdmin'";
  const member = "(@request.auth.hotels.id ?= hotel || " + SA + ")";
  const can = (p) => `${member} && @request.auth.permissions.code ?= '${p}'`;
  const FIN = "@request.auth.financeView = true";
  const hotel = { name: "hotel", type: "relation", collectionId: hotels.id, maxSelect: 1, required: true, cascadeDelete: true };
  const day = (name, required) => ({ name, type: "text", required: !!required, pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
  const sel = (name, values, required) => ({ name, type: "select", maxSelect: 1, values, required: !!required });
  const stamps = () => [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  // ------------------------------------------------------------ permission
  let perm = null;
  try {
    perm = app.findFirstRecordByFilter("permissions", "code = {:c}", { c: CODE });
  } catch (_) {}
  if (!perm) {
    perm = new Record(app.findCollectionByNameOrId("permissions"), { code: CODE, module: "ai" });
    app.save(perm);
  }
  setMaxSelect(app, core.PERMISSIONS.length);
  const permId = permissionIds(app);
  for (const t of app.findAllRecords("roleTemplates")) {
    t.set("permissions", (core.ROLE_PERMISSIONS[t.getString("role")] || []).map((c) => permId[c]).filter(Boolean));
    app.save(t);
  }
  for (const o of app.findAllRecords("roleOverrides")) {
    if ((core.ROLE_PERMISSIONS[o.getString("role")] || []).indexOf(CODE) < 0) continue;
    const ids = o.getStringSlice("permissions");
    if (ids.indexOf(permId["ai.insights.view"]) >= 0 && ids.indexOf(perm.id) < 0) {
      o.set("permissions", ids.concat([perm.id]));
      app.save(o);
    }
  }
  resyncUsers(app, core, permId);

  // ----------------------------------------------------------------- F2
  app.save(new Collection({
    type: "base",
    name: "weatherDaily",
    fields: [
      hotel, day("day", true),
      { name: "tMean", type: "number", required: true, min: -60, max: 60 },
      { name: "tMin", type: "number", min: -60, max: 60 },
      { name: "tMax", type: "number", min: -60, max: 60 },
      // open_meteo | nasa_power | push:<label> | import
      { name: "source", type: "text", required: true, max: 60 },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_weather_daily ON weatherDaily (hotel, day)"],
    listRule: can("energy.view"),
    viewRule: can("energy.view"),
  }));

  const models = new Collection({
    type: "base",
    name: "energyModels",
    fields: [
      hotel, sel("type", ENERGY_TYPES, true),
      // weather: temperature terms; seasonal: annual harmonics; occupancy: occupancy only.
      sel("kind", ["weather", "seasonal", "occupancy"], true),
      sel("status", ["active", "superseded", "rejected"], true),
      { name: "valid", type: "bool" },
      { name: "reason", type: "text", max: 300 },
      { name: "spec", type: "json", maxSize: 20000 },
      { name: "stats", type: "json", maxSize: 20000 },
      { name: "weatherSource", type: "text", max: 60 },
      day("trainFrom"), day("trainTo"),
      { name: "excludedDays", type: "number", onlyInt: true, min: 0 },
      { name: "fittedAt", type: "date" },
    ].concat(stamps()),
    indexes: ["CREATE INDEX idx_energy_models ON energyModels (hotel, type, status)"],
    listRule: can("energy.view"),
    viewRule: can("energy.view"),
  });
  app.save(models);

  app.save(new Collection({
    type: "base",
    name: "energyExpected",
    fields: [
      hotel, sel("type", ENERGY_TYPES, true), day("day", true),
      { name: "model", type: "relation", collectionId: models.id, maxSelect: 1, cascadeDelete: false },
      { name: "expected", type: "number", min: 0 },
      { name: "lower", type: "number", min: 0 },
      { name: "upper", type: "number", min: 0 },
      { name: "hasActual", type: "bool" },
      { name: "actual", type: "number", min: 0 },
      { name: "residual", type: "number" },
      { name: "z", type: "number" },
      { name: "cusum", type: "number", min: 0 },
      { name: "occupied", type: "number", onlyInt: true, min: 0 },
      { name: "tMean", type: "number" },
      { name: "hasWeather", type: "bool" },
      // {spike, drift, excluded}
      { name: "flags", type: "json", maxSize: 2000 },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_energy_expected ON energyExpected (hotel, type, day)"],
    listRule: can("energy.view"),
    viewRule: can("energy.view"),
  }));

  // ----------------------------------------------------------------- F1
  const actions = new Collection({
    type: "base",
    name: "aiActions",
    fields: [
      hotel,
      { name: "insight", type: "relation", collectionId: insights.id, maxSelect: 1, cascadeDelete: false },
      sel("category", CATEGORIES, true),
      sel("department", DEPARTMENTS, true),
      sel("type", ACTION_TYPES, true),
      sel("status", ACTION_STATUS, true),
      sel("priority", ["low", "medium", "high"]),
      { name: "title", type: "text", required: true, max: 200 },
      { name: "reason", type: "text", max: 1000 },
      { name: "params", type: "json", maxSize: 20000 },
      { name: "expectedImpact", type: "json", maxSize: 20000 },
      { name: "idempotencyKey", type: "text", required: true, max: 200 },
      { name: "decidedBy", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "decidedByName", type: "text", max: 120 },
      { name: "decidedByRole", type: "text", max: 40 },
      { name: "decidedAt", type: "date" },
      { name: "decisionNote", type: "text", max: 1000 },
      { name: "executedAt", type: "date" },
      // {collection, id}
      { name: "executedRef", type: "json", maxSize: 2000 },
      { name: "error", type: "text", max: 500 },
      // {status, method, window, measuredAt, value, unit, ci95, expected, actual, label, limitations}
      { name: "outcome", type: "json", maxSize: 20000 },
      { name: "source", type: "text", max: 40 },
    ].concat(stamps()),
    indexes: [
      "CREATE UNIQUE INDEX idx_ai_actions_key ON aiActions (hotel, idempotencyKey)",
      "CREATE INDEX idx_ai_actions_status ON aiActions (hotel, status)",
    ],
    listRule: `${can("ai.insights.view")} && (category != 'revenue' || ${FIN})`,
    viewRule: `${can("ai.insights.view")} && (category != 'revenue' || ${FIN})`,
  });
  app.save(actions);

  app.save(new Collection({
    type: "base",
    name: "energyExclusions",
    fields: [
      hotel, sel("type", ENERGY_TYPES, true), day("day", true),
      { name: "reason", type: "text", required: true, max: 500 },
      { name: "action", type: "relation", collectionId: actions.id, maxSelect: 1, cascadeDelete: false },
      { name: "createdBy", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "createdByName", type: "text", max: 120 },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_energy_exclusions ON energyExclusions (hotel, type, day)"],
    listRule: can("energy.view"),
    viewRule: can("energy.view"),
  }));

  // ----------------------------------------------------------------- F4
  app.save(new Collection({
    type: "base",
    name: "briefings",
    fields: [
      hotel, day("day", true),
      sel("role", core.ROLES, true),
      { name: "items", type: "json", maxSize: 100000 },
      { name: "facts", type: "json", maxSize: 100000 },
      { name: "text", type: "text", max: 10000 },
      sel("source", ["rules", "llm"], true),
      { name: "model", type: "text", max: 120 },
      { name: "fallbackReason", type: "text", max: 200 },
      { name: "containsFinance", type: "bool" },
      { name: "generatedAt", type: "date" },
      // {userId: {useful: bool, at}}
      { name: "ratings", type: "json", maxSize: 20000 },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_briefings ON briefings (hotel, day, role)"],
    listRule: `${member} && @request.auth.role = role && (containsFinance = false || ${FIN})`,
    viewRule: `${member} && @request.auth.role = role && (containsFinance = false || ${FIN})`,
  }));
}, (app) => {
  for (const name of ["briefings", "energyExclusions", "aiActions", "energyExpected", "energyModels", "weatherDaily"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (_) {}
  }
  let rec = null;
  try {
    rec = app.findFirstRecordByFilter("permissions", "code = {:c}", { c: CODE });
  } catch (_) {}
  if (!rec) return;
  for (const name of ["users", "roleTemplates", "roleOverrides"]) {
    for (const r of app.findAllRecords(name)) {
      const ids = r.getStringSlice("permissions");
      if (ids.indexOf(rec.id) < 0) continue;
      r.set("permissions", ids.filter((id) => id !== rec.id));
      if (name === "users") app.saveNoValidate(r);
      else app.save(r);
    }
  }
  app.delete(rec);
  setMaxSelect(app, app.findAllRecords("permissions").length);
});
