/// <reference path="../../pb_data/types.d.ts" />
/**
 * Shared server helpers for the Zarin hooks (PocketBase JSVM, CommonJS).
 *
 * PocketBase runs every hook/route handler in an isolated VM, so handlers
 * `require()` this module instead of closing over top-level variables.
 */
const core = require(`${__hooks}/lib/core.js`);

// ------------------------------------------------------------------ time
// Asia/Tehran is UTC+03:30 all year (Iran abolished DST in 2022). The JSVM
// has no Intl, so the offset is applied by hand.
const TEHRAN_OFFSET_MS = 210 * 60 * 1000;

function dayKey(date) {
  return new Date(date.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(key, delta) {
  const p = key.split("-").map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta)).toISOString().slice(0, 10);
}

/** PocketBase datetime string ("2026-10-05 10:00:00.000Z"). */
function pbDate(date) {
  return date ? date.toISOString().replace("T", " ") : "";
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

// -------------------------------------------------------------- values
/** Go slices → plain JS arrays. */
function arr(value) {
  const out = [];
  if (!value) return out;
  for (let i = 0; i < value.length; i++) out.push(value[i]);
  return out;
}

function jsonOf(record, field) {
  const raw = record.get(field);
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return JSON.parse(toString(raw));
  } catch (_) {
    return null;
  }
}

function unique(list) {
  const seen = {};
  return list.filter((v) => (seen[v] ? false : (seen[v] = true)));
}

// ---------------------------------------------------------------- errors
// PocketBase only passes validation errors through `data`, so the stable
// machine-readable code travels as data.code = {code, message}.
function details(code, data) {
  const out = { code: new ValidationError(code, code) };
  for (const k of Object.keys(data || {})) out[k] = new ValidationError(String(data[k]), String(data[k]));
  return out;
}
function bad(code, data) {
  return new BadRequestError(code, details(code, data));
}
function forbidden(code, data) {
  return new ForbiddenError(code, details(code, data));
}
function notFound(code) {
  return new NotFoundError(code || "not_found", details(code || "not_found"));
}

function find(app, collection, id) {
  if (!id) throw notFound();
  try {
    return app.findRecordById(collection, id);
  } catch (_) {
    throw notFound();
  }
}

function findFirst(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params || {});
  } catch (_) {
    return null;
  }
}

function findMany(app, collection, filter, params, sort, limit) {
  return arr(app.findRecordsByFilter(collection, filter, sort || "", limit || 10000, 0, params || {}));
}

function col(app, name) {
  return app.findCollectionByNameOrId(name);
}

// ---------------------------------------------------------------- caller
function permissionCodes(app, ids) {
  const codes = {};
  if (ids.length === 0) return codes;
  for (const r of arr(app.findRecordsByIds("permissions", ids))) {
    if (r) codes[r.getString("code")] = true;
  }
  return codes;
}

/**
 * The authenticated app user behind a request, with resolved permissions.
 * Throws for guests, superusers-as-users and inactive accounts.
 */
function caller(e) {
  const user = e.auth;
  if (!user || user.collection().name !== "users") {
    throw new UnauthorizedError("unauthenticated", details("unauthenticated"));
  }
  if (user.getString("status") !== "active") throw forbidden("account_disabled");
  const role = user.getString("role");
  return {
    app: e.app,
    user,
    id: user.id,
    role,
    name: user.getString("fullName"),
    hotels: arr(user.getStringSlice("hotels")),
    perms: permissionCodes(e.app, arr(user.getStringSlice("permissions"))),
    isSuperAdmin: role === "superAdmin",
  };
}

function has(c, permission) {
  return c.perms[permission] === true;
}

function requirePerm(c, permission) {
  if (!has(c, permission)) throw forbidden("missing_permission", { permission });
}

function requireHotel(c, hotelId) {
  if (!hotelId) throw bad("hotel_required");
  if (!c.isSuperAdmin && c.hotels.indexOf(hotelId) < 0) throw forbidden("not_hotel_member");
  return hotelId;
}

/** Ensures a related record belongs to the same hotel (prevents cross-tenant links). */
function sameHotel(app, collection, id, hotelId) {
  if (!id) return null;
  const r = find(app, collection, id);
  if (r.getString("hotel") !== hotelId) throw bad("cross_hotel_reference", { field: collection });
  return r;
}

function memberOf(app, userId, hotelId) {
  if (!userId) return null;
  const u = find(app, "users", userId);
  if (arr(u.getStringSlice("hotels")).indexOf(hotelId) < 0) throw bad("cross_hotel_reference", { field: "users" });
  return u;
}

/** Rejects request bodies that touch fields outside [allowed]. */
function onlyFields(e, allowed) {
  const body = e.requestInfo().body || {};
  for (const key of Object.keys(body)) {
    if (allowed.indexOf(key) < 0) throw bad("field_not_allowed", { field: key });
  }
}

// ------------------------------------------------------- roles & users
/** Permission record ids for [role], narrowed by the hotel's role override. */
function permissionIdsFor(app, role, hotelId) {
  let codes = (core.ROLE_PERMISSIONS[role] || []).slice();
  if (hotelId) {
    const override = findFirst(app, "roleOverrides", "hotel = {:h} && role = {:r}", { h: hotelId, r: role });
    if (override) {
      const allowed = permissionCodes(app, arr(override.getStringSlice("permissions")));
      codes = codes.filter((c) => allowed[c]);
    }
  }
  const byCode = {};
  for (const r of arr(app.findAllRecords("permissions"))) byCode[r.getString("code")] = r.id;
  return codes.map((c) => byCode[c]).filter(Boolean);
}

function departmentOf(role) {
  const map = {
    superAdmin: "management", hotelOwner: "management", generalManager: "management",
    operationsManager: "management", analyst: "analytics", energyManager: "energy",
    maintenanceManager: "maintenance", maintenanceStaff: "maintenance",
    housekeepingManager: "housekeeping", housekeepingStaff: "housekeeping",
    restaurantManager: "foodAndBeverage", restaurantStaff: "foodAndBeverage",
    inventoryManager: "inventory", hrManager: "humanResources", receptionStaff: "frontOffice",
  };
  return map[role] || "management";
}

function validPassword(p) {
  return typeof p === "string" && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

// --------------------------------------------------------------- hotels
function hotelSettings(app, hotelId) {
  const s = jsonOf(find(app, "hotels", hotelId), "settings") || {};
  const d = core.DEFAULT_SETTINGS;
  return {
    energyDailyBaseline: Object.assign({}, d.energyDailyBaseline, s.energyDailyBaseline),
    energyTariff: Object.assign({}, d.energyTariff, s.energyTariff),
    energyAlertThresholdPct: s.energyAlertThresholdPct != null ? s.energyAlertThresholdPct : d.energyAlertThresholdPct,
    maintenanceSlaHours: Object.assign({}, d.maintenanceSlaHours, s.maintenanceSlaHours),
    targetCleanMinutes: Object.assign({}, d.targetCleanMinutes, s.targetCleanMinutes),
  };
}

function activeHotelIds(app) {
  return findMany(app, "hotels", "status = 'active' || status = 'trial' || status = ''").map((h) => h.id);
}

// ------------------------------------------------------- integration
/** Queues an event for n8n (delivered by the outbox cron, never blocks). */
function emit(app, type, hotelId, data) {
  if (!$os.getenv("ZH_N8N_WEBHOOK_URL")) return;
  const now = new Date();
  app.save(new Record(col(app, "outbox"), {
    type,
    hotel: hotelId,
    payload: { id: `${type}:${hotelId}:${now.getTime()}`, type, hotelId, occurredAt: now.toISOString(), data: data || {} },
    attempts: 0,
  }));
}

function audit(app, hotelId, entry) {
  app.save(new Record(col(app, "auditLogs"), {
    hotel: hotelId || "",
    action: entry.action,
    resourceCollection: entry.collection || "",
    resourceId: entry.id || "",
    actor: entry.actor || null,
    changes: entry.changes || null,
    source: entry.source || "server",
  }));
}

function actorOf(c) {
  return { uid: c.id, name: c.name, role: c.role, type: "user" };
}

/** Shallow diff of two exported records, ignoring bookkeeping fields. */
function diff(before, after) {
  const ignored = { updated: 1, created: 1, updatedBy: 1, collectionId: 1, collectionName: 1 };
  const keys = unique(Object.keys(before || {}).concat(Object.keys(after || {})));
  const out = {};
  for (const k of keys) {
    if (ignored[k]) continue;
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a === undefined ? null : a, to: b === undefined ? null : b };
  }
  return out;
}

// --------------------------------------------------------- notifications
/**
 * In-app inbox for every active member with one of [roles] (plus explicit
 * [userIds]), a delivery log record, and an optional push request for n8n.
 */
function notify(app, n) {
  const ids = {};
  const roles = n.roles || [];
  if (roles.length) {
    const params = { h: n.hotelId };
    const roleFilter = roles.map((r, i) => { params[`r${i}`] = r; return `role = {:r${i}}`; }).join(" || ");
    for (const u of findMany(app, "users", `hotels.id ?= {:h} && status = 'active' && (${roleFilter})`, params)) ids[u.id] = true;
  }
  for (const id of n.userIds || []) if (id) ids[id] = true;
  const recipients = Object.keys(ids);
  const inbox = col(app, "inbox");
  for (const uid of recipients) {
    app.save(new Record(inbox, {
      user: uid,
      hotel: n.hotelId,
      title: n.title,
      body: n.body || "",
      category: n.category || "system",
      severity: n.severity || "info",
      route: n.route || "",
    }));
  }
  app.save(new Record(col(app, "notifications"), {
    hotel: n.hotelId,
    title: n.title,
    body: n.body || "",
    category: n.category || "system",
    severity: n.severity || "info",
    route: n.route || "",
    audienceRoles: roles,
    audienceUsers: n.userIds || [],
    recipientCount: recipients.length,
    createdBy: n.createdBy || "system",
  }));
  if (recipients.length && $os.getenv("ZH_PUSH_VIA_N8N") === "1") {
    emit(app, "push.requested", n.hotelId, { userIds: recipients, title: n.title, body: n.body || "", route: n.route || "", severity: n.severity || "info" });
  }
  return recipients.length;
}

/**
 * Raises (or re-opens) a deduplicated alert. Executives always see alerts.
 * Returns false when an open/acknowledged alert with the same key exists.
 */
function raiseAlert(app, a) {
  const audience = unique((a.audienceRoles || []).concat(["generalManager", "hotelOwner"]));
  let rec = findFirst(app, "alerts", "hotel = {:h} && dedupeKey = {:k}", { h: a.hotelId, k: a.dedupeKey });
  if (rec && rec.getString("status") !== "resolved") return false;
  if (!rec) rec = new Record(col(app, "alerts"));
  rec.load({
    hotel: a.hotelId,
    dedupeKey: a.dedupeKey,
    type: a.type,
    severity: a.severity,
    title: a.title,
    message: a.message || "",
    route: a.route || "",
    audienceRoles: audience,
    status: "open",
    source: a.source || "server",
    data: a.data || {},
    acknowledgedBy: "",
    acknowledgedByName: "",
    acknowledgedAt: "",
    resolvedAt: "",
  });
  app.save(rec);
  notify(app, {
    hotelId: a.hotelId, roles: audience, title: a.title, body: a.message, category: "alert",
    severity: a.severity, route: a.route, createdBy: "system",
  });
  emit(app, "alert.raised", a.hotelId, Object.assign({
    alertId: a.dedupeKey, type: a.type, severity: a.severity, title: a.title, message: a.message, audienceRoles: audience,
  }, a.data || {}));
  return true;
}

function resolveAlert(app, hotelId, dedupeKey) {
  const rec = findFirst(app, "alerts", "hotel = {:h} && dedupeKey = {:k}", { h: hotelId, k: dedupeKey });
  if (!rec || rec.getString("status") === "resolved") return;
  rec.set("status", "resolved");
  rec.set("resolvedAt", pbDate(new Date()));
  app.save(rec);
}

module.exports = {
  core, dayKey, addDays, pbDate, parseDate, arr, jsonOf, unique,
  details, bad, forbidden, notFound, find, findFirst, findMany, col,
  caller, has, requirePerm, requireHotel, sameHotel, memberOf, onlyFields,
  permissionIdsFor, departmentOf, validPassword, hotelSettings, activeHotelIds,
  emit, audit, actorOf, diff, notify, raiseAlert, resolveAlert,
};
