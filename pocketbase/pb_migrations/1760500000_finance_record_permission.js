/// <reference path="../pb_data/types.d.ts" />
/**
 * AI phase 0.5: new permission `finance.record` — enter daily revenue
 * without being able to read it (finance.view stays the read permission).
 * Default holders: generalManager, operationsManager, receptionStaff
 * (superAdmin has everything). A hotel can narrow it with roleOverrides.
 *
 * - adds the permission to the catalog and raises the relation limits;
 * - role templates follow core.ROLE_PERMISSIONS;
 * - an existing override that allows operations.recordDaily for a role whose
 *   template now has finance.record gets it too (recording revenue keeps working);
 * - every user's permissions are recomputed (template ∩ override);
 * - users.financeView (bool, set by the server from the permissions) lets API
 *   rules test finance.view next to another permission: two
 *   `@request.auth.permissions.code ?=` conditions in one rule would have to
 *   match the same permission row, so they can never both hold.
 */
const CODE = "finance.record";

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

migrate((app) => {
  const core = require(`${__hooks}/lib/core.js`);
  const perms = app.findCollectionByNameOrId("permissions");
  let rec = null;
  try {
    rec = app.findFirstRecordByFilter("permissions", "code = {:c}", { c: CODE });
  } catch (_) {}
  if (!rec) {
    rec = new Record(perms, { code: CODE, module: "finance" });
    app.save(rec);
  }
  setMaxSelect(app, core.PERMISSIONS.length);
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("financeView")) {
    users.fields.add(new BoolField({ name: "financeView" }));
    app.save(users);
  }
  const permId = permissionIds(app);

  for (const t of app.findAllRecords("roleTemplates")) {
    const role = t.getString("role");
    t.set("permissions", (core.ROLE_PERMISSIONS[role] || []).map((c) => permId[c]).filter(Boolean));
    app.save(t);
  }
  for (const o of app.findAllRecords("roleOverrides")) {
    const role = o.getString("role");
    if ((core.ROLE_PERMISSIONS[role] || []).indexOf(CODE) < 0) continue;
    const ids = o.getStringSlice("permissions");
    if (ids.indexOf(permId["operations.recordDaily"]) >= 0 && ids.indexOf(rec.id) < 0) {
      o.set("permissions", ids.concat([rec.id]));
      app.save(o);
    }
  }
  resyncUsers(app, core, permId);
}, (app) => {
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
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("financeView");
  app.save(users);
});
