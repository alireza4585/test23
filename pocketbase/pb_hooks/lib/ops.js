/// <reference path="../../pb_data/types.d.ts" />
/**
 * Operational workflows. Status changes that span records (task + room,
 * ticket + timeline, item + ledger) run in one transaction behind custom
 * routes; plain CRUD is validated and stamped by request hooks.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const ENERGY_UNIT = { electricity: "kWh", water: "m³", gas: "m³" };
const ENERGY_LABEL = { electricity: "برق", water: "آب", gas: "گاز" };

const TICKET_FLOW = {
  open: ["assigned", "inProgress", "cancelled"],
  assigned: ["inProgress", "open", "cancelled"],
  inProgress: ["onHold", "resolved"],
  onHold: ["inProgress", "cancelled"],
  resolved: ["closed", "inProgress"],
  closed: [],
  cancelled: [],
};
const TECHNICIAN_TARGETS = ["inProgress", "onHold", "resolved"];
const ACTIVE_TICKET = ["open", "assigned", "inProgress", "onHold"];

function canMoveRoom(c, from, to) {
  if (z.has(c, "rooms.manage")) return from !== to;
  if (!z.has(c, "rooms.updateStatus")) return false;
  const byRole = core.ROOM_TRANSITIONS[c.role] || {};
  return (byRole[from] || []).indexOf(to) >= 0;
}

function applyRoomStatus(app, room, to, c, note) {
  room.set("previousStatus", room.getString("status"));
  room.set("status", to);
  room.set("updatedBy", c.id);
  room.set("updatedByName", c.name);
  if (note !== undefined) room.set("note", note || "");
  app.save(room);
}

// ------------------------------------------------------------------ rooms
/** POST /api/zarin/rooms/{id}/status  {to, from?, note?} */
function roomStatus(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  let result;
  e.app.runInTransaction((tx) => {
    const room = z.find(tx, "rooms", e.request.pathValue("id"));
    const hotelId = z.requireHotel(c, room.getString("hotel"));
    if (!z.has(c, "rooms.view")) throw z.notFound();
    const from = room.getString("status");
    if (b.from && b.from !== from) throw z.bad("stale_room_status", { current: from });
    if (!canMoveRoom(c, from, b.to)) throw z.forbidden("transition_not_allowed", { from, to: b.to });
    applyRoomStatus(tx, room, b.to, c, b.note);
    z.audit(tx, hotelId, {
      action: "rooms.status", collection: "rooms", id: room.id, actor: z.actorOf(c),
      changes: { status: { from, to: b.to } }, source: "client",
    });
    result = { id: room.id, status: b.to };
  });
  return e.json(200, result);
}

// ------------------------------------------------------------------ tasks
/** POST /api/zarin/tasks/{id}/transition  {status, notes?, roomChange?: {roomId, from, to}} */
function taskTransition(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  let result;
  e.app.runInTransaction((tx) => {
    const task = z.find(tx, "tasks", e.request.pathValue("id"));
    const hotelId = z.requireHotel(c, task.getString("hotel"));
    if (!z.has(c, "housekeeping.viewAll") && task.getString("assignee") !== c.id) throw z.notFound();
    const from = task.getString("status");
    const to = b.status;
    const assigner = z.has(c, "housekeeping.assign");
    const ownStep = z.has(c, "housekeeping.complete") && task.getString("assignee") === c.id &&
      ((from === "pending" && to === "inProgress") || (from === "inProgress" && to === "done"));
    if (from === to || (!assigner && !ownStep)) throw z.forbidden("transition_not_allowed", { from, to });
    if (["pending", "inProgress", "done", "cancelled"].indexOf(to) < 0) throw z.bad("invalid_status");

    const now = new Date();
    task.set("status", to);
    if (to === "inProgress") task.set("startedAt", z.pbDate(now));
    if (to === "done") {
      task.set("completedAt", z.pbDate(now));
      const started = z.parseDate(task.getString("startedAt"));
      if (started) task.set("durationMinutes", Math.round(((now.getTime() - started.getTime()) / 60000) * 10) / 10);
    }
    if (b.notes !== undefined && b.notes !== null) task.set("notes", String(b.notes).slice(0, 5000));
    task.set("updatedBy", c.id);
    tx.save(task);

    if (b.roomChange) {
      const room = z.sameHotel(tx, "rooms", b.roomChange.roomId, hotelId);
      if (room.id !== task.getString("room")) throw z.bad("room_mismatch");
      const current = room.getString("status");
      if (b.roomChange.from && b.roomChange.from !== current) throw z.bad("stale_room_status", { current });
      if (!canMoveRoom(c, current, b.roomChange.to)) throw z.forbidden("transition_not_allowed", { from: current, to: b.roomChange.to });
      applyRoomStatus(tx, room, b.roomChange.to, c);
    }
    z.audit(tx, hotelId, {
      action: "tasks.transition", collection: "tasks", id: task.id, actor: z.actorOf(c),
      changes: { status: { from, to } }, source: "client",
    });
    result = { id: task.id, status: to };
  });
  return e.json(200, result);
}

function onTaskCreate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  const r = e.record;
  const hotelId = r.getString("hotel");
  const room = z.sameHotel(e.app, "rooms", r.getString("room"), hotelId);
  const assignee = z.memberOf(e.app, r.getString("assignee"), hotelId);
  r.set("kind", "housekeeping");
  r.set("status", "pending");
  r.set("startedAt", "");
  r.set("completedAt", "");
  r.set("durationMinutes", 0);
  if (!r.getString("day")) r.set("day", z.dayKey(new Date()));
  if (room) r.set("roomNumber", room.getString("number"));
  r.set("assigneeName", assignee ? assignee.getString("fullName") : "");
  r.set("createdBy", c.id);
  r.set("createdByName", c.name);
  r.set("updatedBy", c.id);
  e.next();
  if (assignee) notifyAssignee(e.app, r);
}

function onTaskUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  z.onlyFields(e, ["assignee", "priority", "dueAt", "notes", "type", "status"]);
  const r = e.record;
  const before = r.original();
  const hotelId = r.getString("hotel");
  if (r.getString("status") !== before.getString("status") && ["cancelled", "pending"].indexOf(r.getString("status")) < 0) {
    throw z.bad("use_task_transition");
  }
  const reassigned = r.getString("assignee") !== before.getString("assignee");
  if (reassigned) {
    const assignee = z.memberOf(e.app, r.getString("assignee"), hotelId);
    r.set("assigneeName", assignee ? assignee.getString("fullName") : "");
  }
  r.set("updatedBy", c.id);
  e.next();
  if (reassigned && r.getString("assignee")) notifyAssignee(e.app, r);
}

function notifyAssignee(app, task) {
  z.notify(app, {
    hotelId: task.getString("hotel"),
    userIds: [task.getString("assignee")],
    title: "وظیفه جدید نظافت",
    body: `اتاق ${task.getString("roomNumber")}`,
    category: "task",
    severity: task.getString("priority") === "urgent" ? "warning" : "info",
    route: `/housekeeping/tasks/${task.id}`,
  });
}

// ---------------------------------------------------------------- rooms
function onRoomWrite(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  const r = e.record;
  if (!r.isNew() && r.getString("status") !== r.original().getString("status")) {
    r.set("previousStatus", r.original().getString("status"));
  }
  r.set("updatedBy", c.id);
  r.set("updatedByName", c.name);
  e.next();
}

// --------------------------------------------------------------- tickets
function slaDueAt(app, hotelId, priority, from) {
  const hours = z.hotelSettings(app, hotelId).maintenanceSlaHours[priority] || 24;
  return new Date(from.getTime() + hours * 3600 * 1000);
}

function locationOf(t) {
  return t.getString("roomNumber") ? `اتاق ${t.getString("roomNumber")}` : t.getString("area") || "—";
}

function onTicketCreate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  const r = e.record;
  const hotelId = r.getString("hotel");
  const room = z.sameHotel(e.app, "rooms", r.getString("room"), hotelId);
  r.set("status", "open");
  r.set("reportedBy", c.id);
  r.set("reportedByName", c.name);
  r.set("reportedByRole", c.role);
  r.set("roomNumber", room ? room.getString("number") : "");
  r.set("assignee", "");
  r.set("assigneeName", "");
  r.set("resolvedAt", "");
  r.set("resolutionNote", "");
  r.set("slaDueAt", z.pbDate(slaDueAt(e.app, hotelId, r.getString("priority"), new Date())));
  r.set("updatedBy", c.id);
  e.next();
}

function onTicketUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  z.onlyFields(e, ["title", "description", "category", "priority", "area"]);
  e.record.set("updatedBy", c.id);
  e.next();
}

/** Model hook (any create path): timeline, alert/notify, critical → room out of order. */
function afterTicketCreated(e) {
  const app = e.app;
  const t = e.record;
  const hotelId = t.getString("hotel");
  const priority = t.getString("priority");
  const route = `/maintenance/${t.id}`;
  const location = locationOf(t);

  app.save(new Record(z.col(app, "ticketEvents"), {
    hotel: hotelId, ticket: t.id, type: "created", toStatus: "open",
    note: t.getString("description"), actor: t.getString("reportedBy"), actorName: t.getString("reportedByName"),
  }));

  if (priority === "critical" || priority === "high") {
    z.raiseAlert(app, {
      hotelId, type: "criticalTicket", severity: priority === "critical" ? "critical" : "warning",
      title: `خرابی ${priority === "critical" ? "بحرانی" : "مهم"}: ${t.getString("title")}`,
      message: `محل: ${location}`, route, audienceRoles: ["maintenanceManager", "operationsManager"],
      dedupeKey: `ticket_${t.id}`, data: { ticketId: t.id, priority, category: t.getString("category") },
    });
  } else {
    z.notify(app, {
      hotelId, roles: ["maintenanceManager"], title: "خرابی جدید ثبت شد",
      body: `${t.getString("title")} — ${location}`, category: "maintenance", severity: "info", route,
    });
  }

  if (priority === "critical" && t.getString("room")) {
    const room = z.findFirst(app, "rooms", "id = {:id}", { id: t.getString("room") });
    if (room && ["vacantClean", "vacantDirty"].indexOf(room.getString("status")) >= 0) {
      room.set("previousStatus", room.getString("status"));
      room.set("status", "outOfOrder");
      room.set("note", t.getString("title"));
      room.set("updatedByName", "Zarin Automation");
      app.save(room);
    }
  }

  z.emit(app, "maintenance.ticket.created", hotelId, {
    ticketId: t.id, title: t.getString("title"), category: t.getString("category"), priority, location,
    reportedByName: t.getString("reportedByName"), slaDueAt: t.getString("slaDueAt") || null,
  });
}

function canSeeTicket(c, t) {
  return z.has(c, "maintenance.viewAll") || t.getString("reportedBy") === c.id || t.getString("assignee") === c.id;
}

/** POST /api/zarin/tickets/{id}/status  {to, note?} */
function ticketStatus(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  let t;
  let from;
  e.app.runInTransaction((tx) => {
    t = z.find(tx, "maintenanceTickets", e.request.pathValue("id"));
    const hotelId = z.requireHotel(c, t.getString("hotel"));
    if (!canSeeTicket(c, t)) throw z.notFound();
    from = t.getString("status");
    let allowed = TICKET_FLOW[from] || [];
    if (!z.has(c, "maintenance.manage")) {
      allowed = z.has(c, "maintenance.work") && t.getString("assignee") === c.id
        ? allowed.filter((s) => TECHNICIAN_TARGETS.indexOf(s) >= 0) : [];
    }
    if (allowed.indexOf(b.to) < 0) throw z.forbidden("transition_not_allowed", { from, to: b.to });
    t.set("status", b.to);
    if (b.to === "resolved") {
      t.set("resolvedAt", z.pbDate(new Date()));
      if (b.note) t.set("resolutionNote", String(b.note).slice(0, 5000));
    }
    t.set("updatedBy", c.id);
    tx.save(t);
    tx.save(new Record(z.col(tx, "ticketEvents"), {
      hotel: hotelId, ticket: t.id, type: "statusChanged", fromStatus: from, toStatus: b.to,
      note: b.note ? String(b.note).slice(0, 5000) : "", actor: c.id, actorName: c.name,
    }));
    z.audit(tx, hotelId, {
      action: "maintenance.status", collection: "maintenanceTickets", id: t.id, actor: z.actorOf(c),
      changes: { status: { from, to: b.to } }, source: "client",
    });
  });

  const hotelId = t.getString("hotel");
  if (["resolved", "closed", "cancelled"].indexOf(b.to) >= 0) {
    z.resolveAlert(e.app, hotelId, `ticket_${t.id}`);
    z.resolveAlert(e.app, hotelId, `sla_${t.id}`);
  }
  if (b.to === "resolved" && t.getString("reportedBy")) {
    z.notify(e.app, {
      hotelId, userIds: [t.getString("reportedBy")], title: "خرابی گزارش‌شده رفع شد",
      body: t.getString("title"), category: "maintenance", severity: "info", route: `/maintenance/${t.id}`,
    });
  }
  z.emit(e.app, "maintenance.ticket.updated", hotelId, {
    ticketId: t.id, from, to: b.to, assigneeName: t.getString("assigneeName") || null,
  });
  return e.json(200, { id: t.id, status: b.to });
}

/** POST /api/zarin/tickets/{id}/assign  {assigneeId} */
function ticketAssign(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  let t;
  let assignee;
  e.app.runInTransaction((tx) => {
    t = z.find(tx, "maintenanceTickets", e.request.pathValue("id"));
    const hotelId = z.requireHotel(c, t.getString("hotel"));
    z.requirePerm(c, "maintenance.manage");
    if (ACTIVE_TICKET.indexOf(t.getString("status")) < 0) throw z.bad("ticket_closed");
    assignee = z.memberOf(tx, b.assigneeId, hotelId);
    if (!assignee) throw z.bad("assignee_required");
    t.set("assignee", assignee.id);
    t.set("assigneeName", assignee.getString("fullName"));
    if (t.getString("status") === "open") t.set("status", "assigned");
    t.set("updatedBy", c.id);
    tx.save(t);
    tx.save(new Record(z.col(tx, "ticketEvents"), {
      hotel: hotelId, ticket: t.id, type: "assigned", note: assignee.getString("fullName"), actor: c.id, actorName: c.name,
    }));
    z.audit(tx, hotelId, {
      action: "maintenance.assign", collection: "maintenanceTickets", id: t.id, actor: z.actorOf(c),
      changes: { assignee: { from: null, to: assignee.id } }, source: "client",
    });
  });
  z.notify(e.app, {
    hotelId: t.getString("hotel"), userIds: [assignee.id], title: "تیکت جدید به شما ارجاع شد",
    body: t.getString("title"), category: "maintenance",
    severity: t.getString("priority") === "critical" ? "critical" : "warning", route: `/maintenance/${t.id}`,
  });
  return e.json(200, { id: t.id, assignee: assignee.id });
}

// ------------------------------------------------------------- inventory
function lowStockCheck(app, item, beforeQty) {
  const hotelId = item.getString("hotel");
  const level = item.getFloat("reorderLevel");
  const qty = item.getFloat("quantity");
  const wasLow = beforeQty <= level;
  const isLow = qty <= level;
  if (!wasLow && isLow) {
    const raised = z.raiseAlert(app, {
      hotelId, type: "lowStock", severity: qty <= 0 ? "critical" : "warning",
      title: `کمبود موجودی: ${item.getString("name")}`,
      message: `موجودی ${qty} ${item.getString("unit")}، نقطه سفارش ${level}`,
      route: `/inventory/${item.id}`, audienceRoles: ["inventoryManager"], dedupeKey: `lowstock_${item.id}`,
      data: { itemId: item.id, sku: item.getString("sku"), quantity: qty, reorderQuantity: item.getFloat("reorderQuantity") },
    });
    if (raised) {
      z.emit(app, "inventory.lowStock", hotelId, {
        itemId: item.id, name: item.getString("name"), sku: item.getString("sku"), quantity: qty,
        reorderLevel: level, reorderQuantity: item.getFloat("reorderQuantity"), supplier: item.getString("supplier") || null,
      });
    }
  } else if (wasLow && !isLow) {
    z.resolveAlert(app, hotelId, `lowstock_${item.id}`);
  }
}

/** POST /api/zarin/inventory/{id}/movements  {type, delta, reason?} */
function recordMovement(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const delta = Number(b.delta);
  const valid = { receive: delta > 0, issue: delta < 0, waste: delta < 0, adjust: delta !== 0 };
  if (!valid[b.type] || !isFinite(delta)) throw z.bad("invalid_movement");
  let item;
  let before;
  let movementId;
  e.app.runInTransaction((tx) => {
    item = z.find(tx, "inventoryItems", e.request.pathValue("id"));
    const hotelId = z.requireHotel(c, item.getString("hotel"));
    z.requirePerm(c, "inventory.move");
    before = item.getFloat("quantity");
    const after = Math.round((before + delta) * 1000) / 1000;
    if (after < 0) throw z.bad("insufficient_stock", { available: before });
    const m = new Record(z.col(tx, "inventoryMovements"), {
      hotel: hotelId, item: item.id, itemName: item.getString("name"), type: b.type, delta,
      quantityBefore: before, quantityAfter: after, reason: b.reason ? String(b.reason).slice(0, 300) : "",
      actor: c.id, actorName: c.name,
    });
    tx.save(m);
    item.set("quantity", after);
    item.set("lastMovement", m.id);
    item.set("updatedBy", c.id);
    tx.save(item);
    movementId = m.id;
  });
  lowStockCheck(e.app, item, before);
  return e.json(200, { id: movementId, quantity: item.getFloat("quantity") });
}

function onItemCreate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  e.record.set("lastMovement", "");
  e.record.set("updatedBy", c.id);
  e.next();
}

function onItemUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  const body = e.requestInfo().body || {};
  if ("quantity" in body || "lastMovement" in body) throw z.bad("use_stock_movement");
  e.record.set("updatedBy", c.id);
  e.next();
}

// ---------------------------------------------------------------- energy
function onEnergyWrite(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  const r = e.record;
  r.set("unit", ENERGY_UNIT[r.getString("type")] || "");
  r.set("source", "manual");
  r.set("recordedBy", c.id);
  r.set("recordedByName", c.name);
  e.next();
}

/** Model hook: reading above baseline + threshold → energy anomaly alert. */
function afterEnergyWritten(e) {
  const app = e.app;
  const r = e.record;
  const hotelId = r.getString("hotel");
  const type = r.getString("type");
  const s = z.hotelSettings(app, hotelId);
  const baseline = s.energyDailyBaseline[type] || 0;
  if (baseline <= 0) return;
  const consumption = r.getFloat("consumption");
  const deviation = ((consumption - baseline) / baseline) * 100;
  if (deviation <= s.energyAlertThresholdPct) return;
  const day = r.getString("day");
  const raised = z.raiseAlert(app, {
    hotelId, type: "energySpike", severity: deviation > s.energyAlertThresholdPct * 2 ? "critical" : "warning",
    title: `مصرف ${ENERGY_LABEL[type] || type} بالاتر از خط مبنا`,
    message: `${Math.round(consumption)} ${r.getString("unit")} در ${day} (${Math.round(deviation)}٪ بیش از خط مبنا)`,
    route: "/energy", audienceRoles: ["energyManager", "operationsManager", "hotelOwner"],
    dedupeKey: `energy_${day}_${type}`, data: { day, type, consumption, baseline, deviation },
  });
  if (raised) z.emit(app, "energy.anomaly", hotelId, { day, type, consumption, baseline, deviation });
}

// -------------------------------------------------------- daily operations
function onOperationsWrite(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  const r = e.record;
  if (r.getInt("roomsOccupied") > r.getInt("roomsAvailable")) throw z.bad("occupied_exceeds_available");
  r.set("source", "manual");
  r.set("updatedBy", c.id);
  r.set("updatedByName", c.name);
  e.next();
}

// ------------------------------------------------------------ staff & shifts
function onStaffWrite(e) {
  if (e.hasSuperuserAuth()) return e.next();
  z.caller(e);
  z.memberOf(e.app, e.record.getString("user"), e.record.getString("hotel"));
  e.next();
}

function onShiftWrite(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  const r = e.record;
  const staff = z.sameHotel(e.app, "staff", r.getString("staff"), r.getString("hotel"));
  if (staff) {
    r.set("staffName", staff.getString("fullName"));
    r.set("user", staff.getString("user"));
    r.set("department", staff.getString("department"));
  }
  if (r.isNew()) r.set("createdBy", c.id);
  r.set("updatedBy", c.id);
  e.next();
}

// ------------------------------------------------- alerts, insights, inbox
function onAlertUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  z.onlyFields(e, ["status"]);
  e.record.set("acknowledgedBy", c.id);
  e.record.set("acknowledgedByName", c.name);
  e.record.set("acknowledgedAt", z.pbDate(new Date()));
  e.next();
}

function onInsightUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  z.onlyFields(e, ["status"]);
  e.record.set("updatedBy", c.id);
  e.next();
}

function onInboxUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  z.onlyFields(e, ["readAt"]);
  e.next();
}

function onSessionUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  z.onlyFields(e, ["revokedAt", "pushToken", "lastSeenAt"]);
  e.next();
}

function onHotelUpdate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  if (!c.isSuperAdmin) z.onlyFields(e, ["settings"]);
  e.next();
}

function onReportCreate(e) {
  if (e.hasSuperuserAuth()) return e.next();
  const c = z.caller(e);
  e.record.set("format", "pdf");
  e.record.set("createdBy", c.id);
  e.record.set("createdByName", c.name);
  e.next();
}

module.exports = {
  ACTIVE_TICKET, roomStatus, taskTransition, onTaskCreate, onTaskUpdate, onRoomWrite,
  onTicketCreate, onTicketUpdate, afterTicketCreated, ticketStatus, ticketAssign,
  recordMovement, onItemCreate, onItemUpdate, onEnergyWrite, afterEnergyWritten,
  onOperationsWrite, onStaffWrite, onShiftWrite, onAlertUpdate, onInsightUpdate,
  onInboxUpdate, onSessionUpdate, onHotelUpdate, onReportCreate, lowStockCheck,
};
