/// <reference path="../pb_data/types.d.ts" />
/**
 * Zarin Hooshmand schema for PocketBase.
 *
 * Security model (mirrors firebase/firestore.rules):
 * - Tenant isolation: every operational record has a `hotel` relation and is
 *   readable only by users whose `hotels` relation contains it.
 * - RBAC: `users.permissions` is a relation to the `permissions` catalog,
 *   computed server-side from the role template (pb_hooks), so rules can test
 *   `@request.auth.permissions.code ?= 'x'` and clients can never edit it.
 * - Workflow changes (task/room status, ticket status, stock movements, user
 *   provisioning) go through transactional custom routes in pb_hooks; the
 *   rules below only allow the plain CRUD each role is entitled to.
 */
migrate((app) => {
  const core = require(`${__hooks}/lib/core.js`);

  // ------------------------------------------------------------- rule kit
  const SA = "@request.auth.role = 'superAdmin'";
  const member = (f) => `(@request.auth.hotels.id ?= ${f || "hotel"} || ${SA})`;
  const perm = (p) => `@request.auth.permissions.code ?= '${p}'`;
  const can = (p, f) => `${member(f)} && ${perm(p)}`;
  const canAny = (ps, f) => `${member(f)} && (${ps.map(perm).join(" || ")})`;
  const authed = "@request.auth.id != ''";

  // ---------------------------------------------------------- field kit
  const text = (name, o) => Object.assign({ name, type: "text", max: 500 }, o || {});
  const longText = (name, o) => Object.assign({ name, type: "text", max: 5000 }, o || {});
  const num = (name, o) => Object.assign({ name, type: "number" }, o || {});
  const int = (name, o) => Object.assign({ name, type: "number", onlyInt: true }, o || {});
  const bool = (name) => ({ name, type: "bool" });
  const date = (name) => ({ name, type: "date" });
  const json = (name) => ({ name, type: "json", maxSize: 200000 });
  const select = (name, values, o) => Object.assign({ name, type: "select", maxSelect: 1, values }, o || {});
  const multi = (name, values) => ({ name, type: "select", maxSelect: values.length, values });
  const rel = (name, collectionId, o) => Object.assign({ name, type: "relation", collectionId, maxSelect: 1 }, o || {});
  const day = (name) => ({ name, type: "text", required: true, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" });
  const stamps = () => [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  const save = (spec) => {
    const c = new Collection(Object.assign({ type: "base" }, spec, { fields: spec.fields.concat(stamps()) }));
    app.save(c);
    return c;
  };

  // ------------------------------------------------------------- enums
  const ROLES = core.ROLES;
  const ROOM_STATUS = ["vacantClean", "vacantDirty", "cleaningInProgress", "occupied", "outOfOrder"];
  const TASK_TYPES = ["checkoutClean", "stayoverClean", "deepClean", "inspection", "turndown"];
  const TASK_STATUS = ["pending", "inProgress", "done", "cancelled"];
  const TASK_PRIORITY = ["low", "normal", "high", "urgent"];
  const TICKET_CATEGORY = ["hvac", "electrical", "plumbing", "furniture", "appliance", "itNetwork", "structural", "other"];
  const TICKET_PRIORITY = ["low", "medium", "high", "critical"];
  const TICKET_STATUS = ["open", "assigned", "inProgress", "onHold", "resolved", "closed", "cancelled"];
  const ENERGY_TYPES = ["electricity", "water", "gas"];
  const SOURCES = ["manual", "smartMeter", "iot", "import"];
  const INV_CATEGORY = ["guestAmenities", "linen", "cleaningSupplies", "foodAndBeverage", "maintenanceParts", "office", "other"];
  const MOVEMENT = ["receive", "issue", "adjust", "waste"];
  const DEPARTMENTS = ["management", "frontOffice", "housekeeping", "maintenance", "energy", "foodAndBeverage", "inventory", "humanResources", "analytics"];
  const SEVERITY = ["info", "warning", "critical"];
  const CATEGORY = ["alert", "task", "maintenance", "inventory", "report", "ai", "system"];

  // ------------------------------------------------------ catalogs
  const hotels = save({
    name: "hotels",
    fields: [
      text("name", { required: true, max: 120 }),
      text("city", { max: 80 }),
      int("stars", { min: 0, max: 7 }),
      int("roomCount", { min: 0 }),
      text("timezone", { max: 60 }),
      text("currency", { max: 8 }),
      select("status", ["active", "suspended", "trial"]),
      json("settings"),
      json("subscription"),
    ],
    listRule: `@request.auth.hotels.id ?= id || ${SA}`,
    viewRule: `@request.auth.hotels.id ?= id || ${SA}`,
    updateRule: `(@request.auth.hotels.id ?= id && ${perm("hotel.settings")}) || ${SA}`,
    createRule: SA,
    deleteRule: SA,
  });

  const permissions = save({
    name: "permissions",
    fields: [text("code", { required: true, max: 60 }), text("module", { max: 40 })],
    indexes: ["CREATE UNIQUE INDEX idx_permissions_code ON permissions (code)"],
    listRule: authed,
    viewRule: authed,
  });
  const permId = {};
  for (const code of core.PERMISSIONS) {
    const r = new Record(permissions, { code, module: code.split(".")[0] });
    app.save(r);
    permId[code] = r.id;
  }

  const templates = save({
    name: "roleTemplates",
    fields: [
      select("role", ROLES, { required: true }),
      select("tier", ["platform", "executive", "manager", "staff"]),
      rel("permissions", permissions.id, { maxSelect: core.PERMISSIONS.length }),
      multi("assignableRoles", ROLES),
      int("version"),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_role_templates_role ON roleTemplates (role)"],
    listRule: authed,
    viewRule: authed,
  });
  for (const role of ROLES) {
    app.save(new Record(templates, {
      role,
      tier: core.ROLE_TIER[role],
      permissions: core.ROLE_PERMISSIONS[role].map((p) => permId[p]),
      assignableRoles: core.ASSIGNABLE_ROLES[role] || [],
      version: 1,
    }));
  }

  // ------------------------------------------------------------- users
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "nationalId", required: true, pattern: "^[0-9]{10}$", hidden: true }));
  users.fields.add(new TextField({ name: "nationalIdMasked", max: 20 }));
  users.fields.add(new TextField({ name: "fullName", required: true, max: 80 }));
  users.fields.add(new SelectField({ name: "role", required: true, maxSelect: 1, values: ROLES }));
  users.fields.add(new RelationField({ name: "permissions", collectionId: permissions.id, maxSelect: core.PERMISSIONS.length }));
  users.fields.add(new RelationField({ name: "hotels", collectionId: hotels.id, maxSelect: 100 }));
  users.fields.add(new RelationField({ name: "primaryHotel", collectionId: hotels.id, maxSelect: 1 }));
  users.fields.add(new TextField({ name: "staffId", max: 40 }));
  users.fields.add(new SelectField({ name: "status", maxSelect: 1, values: ["active", "suspended", "disabled"] }));
  users.fields.add(new BoolField({ name: "mustChangePassword" }));
  users.fields.add(new DateField({ name: "passwordChangedAt" }));
  users.fields.add(new TextField({ name: "phone", max: 20 }));
  users.fields.add(new SelectField({ name: "locale", maxSelect: 1, values: ["fa", "en"] }));
  users.fields.getByName("email").required = false;
  users.addIndex("idx_users_national_id", true, "nationalId", "");
  users.passwordAuth.identityFields = ["nationalId"];
  users.authRule = "status = 'active'";
  users.manageRule = null;
  users.authAlert.enabled = false;
  users.oauth2.enabled = false;
  users.otp.enabled = false;
  users.authToken.duration = 3 * 24 * 3600;
  // Self, or managers of a shared hotel (user directory). National IDs are a
  // hidden field and never leave the server.
  users.listRule = `id = @request.auth.id || ${SA} || (hotels.id ?= @request.auth.hotels.id && ${perm("users.manage")})`;
  users.viewRule = users.listRule;
  users.createRule = null; // provisioning via POST /api/zarin/users
  users.updateRule = "id = @request.auth.id"; // field whitelist in pb_hooks
  users.deleteRule = null;
  app.save(users);

  save({
    name: "roleOverrides",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      select("role", ROLES, { required: true }),
      rel("permissions", permissions.id, { maxSelect: core.PERMISSIONS.length }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_role_overrides ON roleOverrides (hotel, role)"],
    listRule: member(),
    viewRule: member(),
    createRule: SA,
    updateRule: SA,
    deleteRule: SA,
  });

  save({
    name: "sessions",
    fields: [
      rel("user", users.id, { required: true, cascadeDelete: true }),
      text("deviceId", { required: true, max: 64 }),
      select("platform", ["android", "ios", "other"]),
      text("model", { max: 80 }),
      text("osVersion", { max: 40 }),
      text("appVersion", { max: 20 }),
      text("pushToken", { max: 4096 }),
      date("lastSeenAt"),
      date("revokedAt"),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_sessions_device ON sessions (user, deviceId)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id",
  });

  save({
    name: "inbox",
    fields: [
      rel("user", users.id, { required: true, cascadeDelete: true }),
      rel("hotel", hotels.id),
      text("title", { required: true, max: 160 }),
      longText("body"),
      select("category", CATEGORY),
      select("severity", SEVERITY),
      text("route", { max: 200 }),
      date("readAt"),
    ],
    indexes: ["CREATE INDEX idx_inbox_user ON inbox (user, created)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
  });

  // ------------------------------------------------------------- rooms
  const rooms = save({
    name: "rooms",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      text("number", { required: true, max: 10 }),
      int("floor"),
      select("type", ["single", "double", "twin", "suite", "deluxe"]),
      select("status", ROOM_STATUS, { required: true }),
      select("previousStatus", ROOM_STATUS),
      text("note", { max: 500 }),
      rel("updatedBy", users.id),
      text("updatedByName", { max: 80 }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_rooms_number ON rooms (hotel, number)"],
    listRule: can("rooms.view"),
    viewRule: can("rooms.view"),
    createRule: can("rooms.manage"),
    updateRule: can("rooms.manage"), // others change status via /api/zarin/rooms/{id}/status
    deleteRule: can("rooms.manage"),
  });

  // ------------------------------------------------- housekeeping tasks
  save({
    name: "tasks",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      select("kind", ["housekeeping"]),
      day("day"),
      rel("room", rooms.id),
      text("roomNumber", { max: 10 }),
      select("type", TASK_TYPES, { required: true }),
      select("status", TASK_STATUS, { required: true }),
      select("priority", TASK_PRIORITY),
      rel("assignee", users.id),
      text("assigneeName", { max: 80 }),
      date("dueAt"),
      longText("notes"),
      date("startedAt"),
      date("completedAt"),
      num("durationMinutes"),
      rel("createdBy", users.id),
      text("createdByName", { max: 80 }),
      rel("updatedBy", users.id),
    ],
    indexes: ["CREATE INDEX idx_tasks_day ON tasks (hotel, day, assignee)"],
    listRule: `${member()} && (${perm("housekeeping.viewAll")} || (${perm("housekeeping.viewOwn")} && assignee = @request.auth.id))`,
    viewRule: `${member()} && (${perm("housekeeping.viewAll")} || (${perm("housekeeping.viewOwn")} && assignee = @request.auth.id))`,
    createRule: can("housekeeping.assign"),
    updateRule: can("housekeeping.assign"), // assignees advance via /api/zarin/tasks/{id}/transition
    deleteRule: can("housekeeping.assign"),
  });

  // ------------------------------------------------------- maintenance
  const tickets = save({
    name: "maintenanceTickets",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      text("title", { required: true, min: 3, max: 200 }),
      longText("description"),
      select("category", TICKET_CATEGORY, { required: true }),
      select("priority", TICKET_PRIORITY, { required: true }),
      select("status", TICKET_STATUS),
      rel("reportedBy", users.id),
      text("reportedByName", { max: 80 }),
      text("reportedByRole", { max: 40 }),
      rel("room", rooms.id),
      text("roomNumber", { max: 10 }),
      text("area", { max: 120 }),
      { name: "photos", type: "file", maxSelect: 6, maxSize: 8 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"], protected: true, thumbs: ["320x0"] },
      rel("assignee", users.id),
      text("assigneeName", { max: 80 }),
      date("slaDueAt"),
      date("resolvedAt"),
      longText("resolutionNote"),
      rel("updatedBy", users.id),
    ],
    indexes: [
      "CREATE INDEX idx_tickets_status ON maintenanceTickets (hotel, status)",
      "CREATE INDEX idx_tickets_reporter ON maintenanceTickets (hotel, reportedBy)",
      "CREATE INDEX idx_tickets_assignee ON maintenanceTickets (hotel, assignee)",
    ],
    listRule: `${member()} && (${perm("maintenance.viewAll")} || reportedBy = @request.auth.id || assignee = @request.auth.id)`,
    viewRule: `${member()} && (${perm("maintenance.viewAll")} || reportedBy = @request.auth.id || assignee = @request.auth.id)`,
    createRule: can("maintenance.report"),
    updateRule: can("maintenance.manage"), // status & assignment via routes (timeline kept consistent)
    deleteRule: SA,
  });

  save({
    name: "ticketEvents",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      rel("ticket", tickets.id, { required: true, cascadeDelete: true }),
      select("type", ["created", "statusChanged", "assigned", "comment"]),
      select("fromStatus", TICKET_STATUS),
      select("toStatus", TICKET_STATUS),
      longText("note"),
      rel("actor", users.id),
      text("actorName", { max: 80 }),
    ],
    indexes: ["CREATE INDEX idx_ticket_events ON ticketEvents (ticket, created)"],
    listRule: `${member()} && (${perm("maintenance.viewAll")} || ticket.reportedBy = @request.auth.id || ticket.assignee = @request.auth.id)`,
    viewRule: `${member()} && (${perm("maintenance.viewAll")} || ticket.reportedBy = @request.auth.id || ticket.assignee = @request.auth.id)`,
  });

  // ------------------------------------------------------------ energy
  save({
    name: "energyReadings",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      select("type", ENERGY_TYPES, { required: true }),
      text("unit", { max: 10 }),
      day("day"),
      num("consumption", { min: 0, max: 10000000 }),
      num("meterValue"),
      text("meterId", { max: 60 }),
      num("cost", { min: 0 }),
      text("note", { max: 500 }),
      select("source", SOURCES),
      rel("recordedBy", users.id),
      text("recordedByName", { max: 80 }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_energy_day_type ON energyReadings (hotel, day, type)"],
    listRule: can("energy.view"),
    viewRule: can("energy.view"),
    createRule: can("energy.record"),
    updateRule: can("energy.record"),
    deleteRule: SA,
  });

  save({
    name: "dailyOperations",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      day("day"),
      int("roomsAvailable", { min: 0 }),
      int("roomsOccupied", { min: 0 }),
      int("guests", { min: 0 }),
      num("roomRevenue", { min: 0 }),
      num("fnbRevenue", { min: 0 }),
      num("otherRevenue", { min: 0 }),
      select("source", ["manual", "pms", "import", "seed"]),
      rel("updatedBy", users.id),
      text("updatedByName", { max: 80 }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_operations_day ON dailyOperations (hotel, day)"],
    listRule: canAny(["finance.view", "operations.recordDaily", "energy.view", "dashboard.operations"]),
    viewRule: canAny(["finance.view", "operations.recordDaily", "energy.view", "dashboard.operations"]),
    createRule: can("operations.recordDaily"),
    updateRule: can("operations.recordDaily"),
    deleteRule: SA,
  });

  // --------------------------------------------------------- inventory
  const items = save({
    name: "inventoryItems",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      text("name", { required: true, max: 120 }),
      text("sku", { max: 40 }),
      select("category", INV_CATEGORY),
      text("unit", { max: 20 }),
      num("quantity", { min: 0 }),
      num("reorderLevel", { min: 0 }),
      num("reorderQuantity", { min: 0 }),
      num("unitCost", { min: 0 }),
      text("location", { max: 80 }),
      text("supplier", { max: 120 }),
      text("lastMovement", { max: 20 }),
      rel("updatedBy", users.id),
    ],
    indexes: ["CREATE INDEX idx_items_hotel ON inventoryItems (hotel, name)"],
    listRule: can("inventory.view"),
    viewRule: can("inventory.view"),
    createRule: can("inventory.manage"),
    updateRule: can("inventory.manage"), // quantity only via /api/zarin/inventory/{id}/movements
    deleteRule: can("inventory.manage"),
  });

  save({
    name: "inventoryMovements",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      rel("item", items.id, { required: true, cascadeDelete: true }),
      text("itemName", { max: 120 }),
      select("type", MOVEMENT, { required: true }),
      num("delta"),
      num("quantityBefore"),
      num("quantityAfter"),
      text("reason", { max: 300 }),
      rel("actor", users.id),
      text("actorName", { max: 80 }),
    ],
    indexes: ["CREATE INDEX idx_movements_item ON inventoryMovements (item, created)"],
    listRule: can("inventory.view"),
    viewRule: can("inventory.view"),
  });

  // ---------------------------------------------------- staff & shifts
  const staff = save({
    name: "staff",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      text("fullName", { required: true, max: 80 }),
      select("department", DEPARTMENTS),
      text("position", { max: 60 }),
      select("role", ROLES),
      rel("user", users.id),
      text("phone", { max: 20 }),
      bool("active"),
    ],
    listRule: canAny(["staff.view", "housekeeping.assign", "maintenance.manage"]),
    viewRule: canAny(["staff.view", "housekeeping.assign", "maintenance.manage"]),
    createRule: can("staff.manage"),
    updateRule: can("staff.manage"),
    deleteRule: can("staff.manage"),
  });

  save({
    name: "shifts",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      rel("staff", staff.id, { cascadeDelete: true }),
      text("staffName", { max: 80 }),
      rel("user", users.id),
      select("department", DEPARTMENTS),
      day("day"),
      select("type", ["morning", "evening", "night"]),
      text("startTime", { pattern: "^[0-9]{2}:[0-9]{2}$" }),
      text("endTime", { pattern: "^[0-9]{2}:[0-9]{2}$" }),
      select("status", ["scheduled", "checkedIn", "completed", "absent"]),
      rel("createdBy", users.id),
      rel("updatedBy", users.id),
    ],
    indexes: ["CREATE INDEX idx_shifts_day ON shifts (hotel, day)"],
    listRule: `${member()} && (${perm("staff.view")} || (${perm("staff.viewOwnShifts")} && user = @request.auth.id))`,
    viewRule: `${member()} && (${perm("staff.view")} || (${perm("staff.viewOwnShifts")} && user = @request.auth.id))`,
    createRule: can("staff.manage"),
    updateRule: can("staff.manage"),
    deleteRule: can("staff.manage"),
  });

  // ------------------------------------------- alerts & notifications
  save({
    name: "alerts",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      text("dedupeKey", { required: true, max: 120 }),
      select("type", ["energySpike", "lowStock", "maintenanceSla", "criticalTicket", "system", "ai"]),
      select("severity", SEVERITY),
      text("title", { required: true, max: 200 }),
      longText("message"),
      text("route", { max: 200 }),
      multi("audienceRoles", ROLES),
      select("status", ["open", "acknowledged", "resolved"]),
      text("source", { max: 40 }),
      json("data"),
      rel("acknowledgedBy", users.id),
      text("acknowledgedByName", { max: 80 }),
      date("acknowledgedAt"),
      date("resolvedAt"),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_alerts_key ON alerts (hotel, dedupeKey)"],
    listRule: `${member()} && (audienceRoles:each ?= @request.auth.role || ${SA})`,
    viewRule: `${member()} && (audienceRoles:each ?= @request.auth.role || ${SA})`,
    updateRule: `${member()} && audienceRoles:each ?= @request.auth.role && @request.body.status = 'acknowledged'`,
  });

  save({
    name: "notifications",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      text("title", { required: true, max: 160 }),
      longText("body"),
      select("category", CATEGORY),
      select("severity", SEVERITY),
      text("route", { max: 200 }),
      json("audienceRoles"),
      json("audienceUsers"),
      int("recipientCount"),
      text("createdBy", { max: 40 }),
    ],
    listRule: can("audit.view"),
    viewRule: can("audit.view"),
  });

  // ---------------------------------------------------------------- AI
  save({
    name: "aiInsights",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      text("key", { required: true, max: 120 }),
      text("rule", { max: 60 }),
      select("category", ["energy", "maintenance", "housekeeping", "inventory", "revenue", "staffing"]),
      text("title", { required: true, max: 200 }),
      longText("summary"),
      longText("recommendation"),
      json("evidence"),
      num("confidence", { min: 0, max: 1 }),
      select("priority", ["low", "medium", "high"]),
      num("estimatedMonthlySaving", { min: 0 }),
      text("route", { max: 200 }),
      json("audienceRoles"),
      select("status", ["active", "accepted", "dismissed", "implemented"]),
      select("source", ["rules", "llm", "external"]),
      text("model", { max: 80 }),
      rel("updatedBy", users.id),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_insights_key ON aiInsights (hotel, key)"],
    listRule: can("ai.insights.view"),
    viewRule: can("ai.insights.view"),
    updateRule: `${canAny(["dashboard.executive", "dashboard.operations"])} && (@request.body.status = 'accepted' || @request.body.status = 'dismissed' || @request.body.status = 'implemented')`,
  });

  save({
    name: "aiConversations",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      rel("user", users.id),
      text("role", { max: 40 }),
      longText("question"),
      { name: "answer", type: "text", max: 20000 },
      text("model", { max: 80 }),
      text("status", { max: 20 }),
      json("usage"),
    ],
    listRule: can("audit.view"),
    viewRule: can("audit.view"),
  });

  save({
    name: "aiUsage",
    fields: [rel("user", users.id, { required: true, cascadeDelete: true }), text("window", { max: 20 }), int("count")],
    indexes: ["CREATE UNIQUE INDEX idx_ai_usage ON aiUsage (user, window)"],
  });

  // ------------------------------------------------------------ reports
  save({
    name: "reports",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      select("type", ["executiveSummary", "energy", "maintenance", "housekeeping", "inventory"]),
      date("from"),
      date("to"),
      text("format", { max: 10 }),
      { name: "file", type: "file", maxSelect: 1, maxSize: 20 * 1024 * 1024, mimeTypes: ["application/pdf"], protected: true },
      int("sizeBytes"),
      rel("createdBy", users.id),
      text("createdByName", { max: 80 }),
    ],
    listRule: can("reports.view"),
    viewRule: can("reports.view"),
    createRule: can("reports.generate"),
  });

  // ---------------------------------------------------- analytics & audit
  save({
    name: "dailyMetrics",
    fields: [
      rel("hotel", hotels.id, { required: true, cascadeDelete: true }),
      day("day"),
      num("occupancyRate"),
      num("adr"),
      num("revpar"),
      num("totalRevenue"),
      json("data"),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_metrics_day ON dailyMetrics (hotel, day)"],
    listRule: canAny(["dashboard.executive", "dashboard.operations", "reports.view"]),
    viewRule: canAny(["dashboard.executive", "dashboard.operations", "reports.view"]),
  });

  save({
    name: "auditLogs",
    fields: [
      rel("hotel", hotels.id, { cascadeDelete: true }),
      text("action", { required: true, max: 80 }),
      text("resourceCollection", { max: 60 }),
      text("resourceId", { max: 40 }),
      json("actor"),
      json("changes"),
      select("source", ["client", "server", "n8n", "iot"]),
    ],
    indexes: ["CREATE INDEX idx_audit_hotel ON auditLogs (hotel, created)"],
    listRule: can("audit.view"),
    viewRule: can("audit.view"),
  });

  // Integration events waiting for delivery to n8n (cron flushes).
  save({
    name: "outbox",
    fields: [
      text("type", { required: true, max: 60 }),
      rel("hotel", hotels.id, { cascadeDelete: true }),
      json("payload"),
      int("attempts"),
      date("deliveredAt"),
      text("lastError", { max: 500 }),
    ],
    indexes: ["CREATE INDEX idx_outbox_pending ON outbox (deliveredAt, created)"],
  });

  // ----------------------------------------------------------- settings
  const settings = app.settings();
  settings.meta.appName = "Zarin Hooshmand";
  settings.rateLimits.enabled = true;
  settings.batch.enabled = false;
  app.save(settings);
}, (app) => {
  const names = [
    "outbox", "auditLogs", "dailyMetrics", "reports", "aiUsage", "aiConversations", "aiInsights",
    "notifications", "alerts", "shifts", "staff", "inventoryMovements", "inventoryItems",
    "dailyOperations", "energyReadings", "ticketEvents", "maintenanceTickets", "tasks", "rooms",
    "inbox", "sessions", "roleOverrides",
  ];
  for (const n of names) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["nationalId", "nationalIdMasked", "fullName", "role", "permissions", "hotels", "primaryHotel",
    "staffId", "status", "mustChangePassword", "passwordChangedAt", "phone", "locale"]) {
    users.fields.removeByName(f);
  }
  users.removeIndex("idx_users_national_id");
  users.passwordAuth.identityFields = ["email"];
  app.save(users);
  for (const n of ["roleTemplates", "permissions", "hotels"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
