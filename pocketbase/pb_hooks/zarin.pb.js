/// <reference path="../pb_data/types.d.ts" />
/**
 * Zarin Hooshmand — PocketBase hooks entry point.
 *
 * Each handler runs in an isolated JS VM, so it loads its module with
 * require() (top-level variables of this file are not visible inside
 * handlers). Logic lives in pb_hooks/lib/*.js.
 *
 * Routes (app, auth required):
 *   GET  /api/zarin/me
 *   POST /api/zarin/users                     provision a user (RBAC: canAssign)
 *   POST /api/zarin/users/{id}/status|password|role
 *   POST /api/zarin/sessions                  register this device
 *   POST /api/zarin/sessions/revoke           sign out everywhere
 *   POST /api/zarin/rooms/{id}/status         role-based room transitions
 *   POST /api/zarin/tasks/{id}/transition     task + room, one transaction
 *   POST /api/zarin/tickets/{id}/status|assign
 *   POST /api/zarin/inventory/{id}/movements  item + ledger, one transaction
 *   POST /api/zarin/ai/ask                    assistant
 * Routes (superuser): POST /api/zarin/admin/import (trial hotels only),
 *                     POST /api/zarin/admin/hotels/{id}/analytics
 * Routes (n8n / IoT, HMAC-signed): /v1/...
 * Cron (UTC): rollup 20:50 (00:20 Tehran), insights 03:10 (06:40 Tehran),
 *             SLA every 15 min, outbox every minute.
 */

// ------------------------------------------------------------- app routes
routerAdd("GET", "/api/zarin/me", (e) => require(`${__hooks}/lib/users.js`).me(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/users", (e) => require(`${__hooks}/lib/users.js`).createUser(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/users/{id}/status", (e) => require(`${__hooks}/lib/users.js`).setStatus(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/users/{id}/password", (e) => require(`${__hooks}/lib/users.js`).resetPassword(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/users/{id}/role", (e) => require(`${__hooks}/lib/users.js`).updateRole(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/sessions", (e) => require(`${__hooks}/lib/users.js`).registerSession(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/sessions/revoke", (e) => require(`${__hooks}/lib/users.js`).revokeSessions(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/rooms/{id}/status", (e) => require(`${__hooks}/lib/ops.js`).roomStatus(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/tasks/{id}/transition", (e) => require(`${__hooks}/lib/ops.js`).taskTransition(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/tickets/{id}/status", (e) => require(`${__hooks}/lib/ops.js`).ticketStatus(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/tickets/{id}/assign", (e) => require(`${__hooks}/lib/ops.js`).ticketAssign(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/inventory/{id}/movements", (e) => require(`${__hooks}/lib/ops.js`).recordMovement(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zarin/ai/ask", (e) => require(`${__hooks}/lib/ai.js`).ask(e), $apis.requireAuth("users"));

// ------------------------------------------------ superuser tools (admin.js)
routerAdd("POST", "/api/zarin/admin/import", (e) => require(`${__hooks}/lib/admin.js`).importRecords(e), $apis.requireSuperuserAuth());
routerAdd("POST", "/api/zarin/admin/hotels/{id}/analytics", (e) => require(`${__hooks}/lib/admin.js`).runAnalytics(e), $apis.requireSuperuserAuth());

// ------------------------------------------------- integration API (HMAC)
routerAdd("GET", "/v1/health", (e) => require(`${__hooks}/lib/integration.js`).health(e));
routerAdd("POST", "/v1/outbox/flush", (e) => require(`${__hooks}/lib/integration.js`).flushNow(e));
routerAdd("GET", "/v1/hotels/{hotelId}/summary", (e) => require(`${__hooks}/lib/integration.js`).summary(e));
routerAdd("GET", "/v1/hotels/{hotelId}/maintenance/overdue", (e) => require(`${__hooks}/lib/integration.js`).overdue(e));
routerAdd("POST", "/v1/hotels/{hotelId}/notifications", (e) => require(`${__hooks}/lib/integration.js`).postNotification(e));
routerAdd("POST", "/v1/hotels/{hotelId}/insights", (e) => require(`${__hooks}/lib/integration.js`).postInsight(e));
routerAdd("POST", "/v1/hotels/{hotelId}/energy/readings", (e) => require(`${__hooks}/lib/integration.js`).postReading(e));
routerAdd("POST", "/v1/hotels/{hotelId}/metrics/rollup", (e) => require(`${__hooks}/lib/integration.js`).rollup(e));
routerAdd("POST", "/v1/hotels/{hotelId}/insights/run", (e) => require(`${__hooks}/lib/integration.js`).runInsights(e));

// ------------------------------------------------------------- users
// Permissions always follow the role template (+ hotel override).
onRecordCreate((e) => { require(`${__hooks}/lib/users.js`).syncPermissions(e.app, e.record); e.next(); }, "users");
onRecordUpdate((e) => { require(`${__hooks}/lib/users.js`).syncPermissions(e.app, e.record); e.next(); }, "users");
onRecordUpdateRequest((e) => { require(`${__hooks}/lib/users.js`).guardSelfUpdate(e); e.next(); }, "users");
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib/users.js`).resyncRole(e.app, e.record); e.next(); }, "roleOverrides");
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib/users.js`).resyncRole(e.app, e.record); e.next(); }, "roleOverrides");
onRecordAfterDeleteSuccess((e) => { require(`${__hooks}/lib/users.js`).resyncRole(e.app, e.record); e.next(); }, "roleOverrides");

// ------------------------------------------------- validation & stamping
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onTaskCreate(e), "tasks");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onTaskUpdate(e), "tasks");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onRoomWrite(e), "rooms");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onRoomWrite(e), "rooms");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onTicketCreate(e), "maintenanceTickets");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onTicketUpdate(e), "maintenanceTickets");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onItemCreate(e), "inventoryItems");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onItemUpdate(e), "inventoryItems");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onEnergyWrite(e), "energyReadings");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onEnergyWrite(e), "energyReadings");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onOperationsWrite(e), "dailyOperations");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onOperationsWrite(e), "dailyOperations");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onStaffWrite(e), "staff");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onStaffWrite(e), "staff");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onShiftWrite(e), "shifts");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onShiftWrite(e), "shifts");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onAlertUpdate(e), "alerts");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onInsightUpdate(e), "aiInsights");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onInboxUpdate(e), "inbox");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onSessionUpdate(e), "sessions");
onRecordUpdateRequest((e) => require(`${__hooks}/lib/ops.js`).onHotelUpdate(e), "hotels");
onRecordCreateRequest((e) => require(`${__hooks}/lib/ops.js`).onReportCreate(e), "reports");

// ---------------------------------------------------- audit (client CRUD)
onRecordCreateRequest((e) => require(`${__hooks}/lib/audit.js`).create(e));
onRecordUpdateRequest((e) => require(`${__hooks}/lib/audit.js`).update(e));
onRecordDeleteRequest((e) => require(`${__hooks}/lib/audit.js`).remove(e));

// ------------------------------------------------------- side effects
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib/ops.js`).afterTicketCreated(e); e.next(); }, "maintenanceTickets");
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib/ops.js`).afterEnergyWritten(e); e.next(); }, "energyReadings");
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib/ops.js`).afterEnergyWritten(e); e.next(); }, "energyReadings");

// ------------------------------------------------------------------ cron
cronAdd("zarin_daily_rollup", "50 20 * * *", () => {
  const z = require(`${__hooks}/lib/zarin.js`);
  const analytics = require(`${__hooks}/lib/analytics.js`);
  const now = new Date();
  const yesterday = z.addDays(z.dayKey(now), -1);
  for (const id of z.activeHotelIds($app)) {
    try { analytics.rollup($app, id, yesterday, now); } catch (err) { console.log("rollup failed", id, String(err)); }
  }
});

cronAdd("zarin_insights", "10 3 * * *", () => {
  const z = require(`${__hooks}/lib/zarin.js`);
  const analytics = require(`${__hooks}/lib/analytics.js`);
  const now = new Date();
  for (const id of z.activeHotelIds($app)) {
    try { analytics.runInsights($app, id, now); } catch (err) { console.log("insights failed", id, String(err)); }
  }
});

cronAdd("zarin_sla", "*/15 * * * *", () => {
  const z = require(`${__hooks}/lib/zarin.js`);
  const analytics = require(`${__hooks}/lib/analytics.js`);
  for (const id of z.activeHotelIds($app)) {
    try { analytics.checkSla($app, id, new Date()); } catch (err) { console.log("sla check failed", id, String(err)); }
  }
});

cronAdd("zarin_outbox", "* * * * *", () => {
  require(`${__hooks}/lib/integration.js`).flushOutbox($app);
});
