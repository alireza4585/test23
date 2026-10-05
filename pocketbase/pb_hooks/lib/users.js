/// <reference path="../../pb_data/types.d.ts" />
/** User provisioning, profile and session management (ports admin/users.ts + auth/sessions.ts). */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

/** Model hook: permissions always follow role template (+ hotel override). */
function syncPermissions(app, user) {
  const role = user.getString("role");
  if (!role) return;
  const hotelId = user.getString("primaryHotel") || z.arr(user.getStringSlice("hotels"))[0] || "";
  user.set("permissions", z.permissionIdsFor(app, role, hotelId));
  const nid = user.getString("nationalId");
  if (nid && !user.getString("nationalIdMasked")) user.set("nationalIdMasked", core.maskNationalId(nid));
  if (!user.getString("status")) user.set("status", "active");
}

/** Self-service profile updates: password change and locale only. */
function guardSelfUpdate(e) {
  if (e.hasSuperuserAuth()) return;
  z.onlyFields(e, ["oldPassword", "password", "passwordConfirm", "locale"]);
  const body = e.requestInfo().body || {};
  if (body.password) {
    if (!z.validPassword(body.password)) throw z.bad("weak_password");
    e.record.set("mustChangePassword", false);
    e.record.set("passwordChangedAt", z.pbDate(new Date()));
  }
}

function profile(app, user) {
  const codes = Object.keys(z.caller({ auth: user, app }).perms).sort();
  return {
    id: user.id,
    fullName: user.getString("fullName"),
    nationalIdMasked: user.getString("nationalIdMasked"),
    role: user.getString("role"),
    permissions: codes,
    hotels: z.arr(user.getStringSlice("hotels")),
    primaryHotel: user.getString("primaryHotel"),
    staffId: user.getString("staffId"),
    status: user.getString("status"),
    mustChangePassword: user.getBool("mustChangePassword"),
    locale: user.getString("locale") || "fa",
  };
}

function me(e) {
  const c = z.caller(e);
  return e.json(200, profile(e.app, c.user));
}

function managedTarget(c, hotelId, uid) {
  z.requireHotel(c, hotelId);
  z.requirePerm(c, "users.manage");
  const target = z.find(c.app, "users", uid);
  if (z.arr(target.getStringSlice("hotels")).indexOf(hotelId) < 0) throw z.notFound("user_not_found");
  if (target.id === c.id || !core.canAssign(c.role, target.getString("role"))) throw z.forbidden("cannot_manage_user");
  return target;
}

function createUser(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const hotelId = z.requireHotel(c, b.hotelId);
  z.requirePerm(c, "users.manage");
  if (!core.isRole(b.role)) throw z.bad("invalid_role");
  if (!core.canAssign(c.role, b.role)) throw z.forbidden("role_not_assignable");
  const nid = core.normalizeNationalId(String(b.nationalId || ""));
  if (!core.isValidNationalId(nid)) throw z.bad("invalid_national_id");
  const fullName = String(b.fullName || "").trim();
  if (fullName.length < 3 || fullName.length > 80) throw z.bad("invalid_name");
  if (!z.validPassword(b.temporaryPassword)) throw z.bad("weak_password");
  if (z.findFirst(e.app, "users", "nationalId = {:n}", { n: nid })) throw z.bad("national_id_exists");

  let created;
  e.app.runInTransaction((tx) => {
    const user = new Record(z.col(tx, "users"));
    user.load({
      nationalId: nid,
      nationalIdMasked: core.maskNationalId(nid),
      fullName,
      role: b.role,
      hotels: b.role === "superAdmin" ? [] : [hotelId],
      primaryHotel: hotelId,
      status: "active",
      mustChangePassword: true,
      phone: b.phone ? String(b.phone).slice(0, 20) : "",
      locale: "fa",
    });
    user.setPassword(b.temporaryPassword);
    tx.save(user);
    const staff = new Record(z.col(tx, "staff"), {
      hotel: hotelId,
      fullName,
      department: z.departmentOf(b.role),
      position: b.role,
      role: b.role,
      user: user.id,
      phone: user.getString("phone"),
      active: true,
    });
    tx.save(staff);
    user.set("staffId", staff.id);
    tx.save(user);
    z.audit(tx, hotelId, {
      action: "users.create", collection: "users", id: user.id, actor: z.actorOf(c),
      changes: { role: { from: null, to: b.role } }, source: "server",
    });
    created = user;
  });
  z.emit(e.app, "user.created", hotelId, { uid: created.id, role: b.role });
  return e.json(200, { uid: created.id });
}

function revokeAll(app, user) {
  user.refreshTokenKey();
  app.save(user);
  let n = 0;
  for (const s of z.findMany(app, "sessions", "user = {:u} && revokedAt = ''", { u: user.id })) {
    s.set("revokedAt", z.pbDate(new Date()));
    s.set("pushToken", "");
    app.save(s);
    n++;
  }
  return n;
}

function setStatus(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  if (["active", "suspended", "disabled"].indexOf(b.status) < 0) throw z.bad("invalid_status");
  const target = managedTarget(c, b.hotelId, e.request.pathValue("id"));
  const before = target.getString("status");
  target.set("status", b.status);
  e.app.save(target);
  if (b.status !== "active") revokeAll(e.app, target);
  z.audit(e.app, b.hotelId, {
    action: "users.setStatus", collection: "users", id: target.id, actor: z.actorOf(c),
    changes: { status: { from: before, to: b.status } },
  });
  return e.json(200, { ok: true });
}

function resetPassword(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  if (!z.validPassword(b.temporaryPassword)) throw z.bad("weak_password");
  const target = managedTarget(c, b.hotelId, e.request.pathValue("id"));
  target.setPassword(b.temporaryPassword);
  target.set("mustChangePassword", true);
  e.app.save(target);
  revokeAll(e.app, target);
  z.audit(e.app, b.hotelId, { action: "users.resetPassword", collection: "users", id: target.id, actor: z.actorOf(c) });
  return e.json(200, { ok: true });
}

function updateRole(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  if (!core.isRole(b.role)) throw z.bad("invalid_role");
  const target = managedTarget(c, b.hotelId, e.request.pathValue("id"));
  if (!core.canAssign(c.role, b.role)) throw z.forbidden("role_not_assignable");
  const before = target.getString("role");
  target.set("role", b.role);
  e.app.save(target); // permissions re-derived by the users model hook
  const staff = z.findFirst(e.app, "staff", "user = {:u} && hotel = {:h}", { u: target.id, h: b.hotelId });
  if (staff) {
    staff.set("role", b.role);
    staff.set("position", b.role);
    staff.set("department", z.departmentOf(b.role));
    e.app.save(staff);
  }
  revokeAll(e.app, target);
  z.audit(e.app, b.hotelId, {
    action: "users.updateRole", collection: "users", id: target.id, actor: z.actorOf(c),
    changes: { role: { from: before, to: b.role } },
  });
  return e.json(200, { ok: true });
}

function registerSession(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const deviceId = String(b.deviceId || "");
  if (deviceId.length < 8 || deviceId.length > 64) throw z.bad("invalid_device");
  let s = z.findFirst(e.app, "sessions", "user = {:u} && deviceId = {:d}", { u: c.id, d: deviceId });
  if (!s) s = new Record(z.col(e.app, "sessions"), { user: c.id, deviceId });
  s.set("platform", ["android", "ios"].indexOf(b.platform) >= 0 ? b.platform : "other");
  s.set("model", String(b.model || "").slice(0, 80));
  s.set("osVersion", String(b.osVersion || "").slice(0, 40));
  s.set("appVersion", String(b.appVersion || "").slice(0, 20));
  s.set("pushToken", b.pushToken ? String(b.pushToken).slice(0, 4096) : "");
  s.set("lastSeenAt", z.pbDate(new Date()));
  s.set("revokedAt", "");
  e.app.save(s);
  return e.json(200, { ok: true });
}

function revokeSessions(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const uid = b.uid || c.id;
  if (uid !== c.id && !c.isSuperAdmin) throw z.forbidden("use_admin_status");
  const target = uid === c.id ? c.user : z.find(e.app, "users", uid);
  const revoked = revokeAll(e.app, target);
  z.audit(e.app, target.getString("primaryHotel"), {
    action: "sessions.revokeAll", collection: "users", id: target.id, actor: z.actorOf(c),
  });
  return e.json(200, { revoked });
}

/** Role override changed → re-derive permissions of affected users. */
function resyncRole(app, override) {
  const hotelId = override.getString("hotel");
  const role = override.getString("role");
  for (const u of z.findMany(app, "users", "hotels.id ?= {:h} && role = {:r}", { h: hotelId, r: role })) app.save(u);
}

module.exports = {
  syncPermissions, guardSelfUpdate, profile, me, createUser, setStatus, resetPassword,
  updateRole, registerSession, revokeSessions, resyncRole,
};
