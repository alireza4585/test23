/// <reference path="../pb_data/types.d.ts" />
/**
 * AI phase 2, F5: purchase suggestions (flag replenishment). Additive only.
 *
 *   suppliers        name, contact (e-mail / Bale chat), default lead time
 *   purchaseOrders   draft → (awaitingApproval →) approved → sent → received,
 *                    or cancelled; written by the server only
 *   inventoryItems   + supplierRef, leadTimeDays, shelfLifeDays, parLevel,
 *                    deliveryPattern, replenishment (the nightly plan, server-written)
 *   aiActions.type   + createPurchaseOrder
 *
 * Purchase orders carry costs, like inventoryItems.unitCost: readable with
 * inventory.view in the active hotel.
 */
const PO_STATUS = ["draft", "awaitingApproval", "approved", "sent", "received", "cancelled"];

migrate((app) => {
  const hotels = app.findCollectionByNameOrId("hotels");
  const users = app.findCollectionByNameOrId("users");
  const SA = "@request.auth.role = 'superAdmin'";
  const member = "(@request.auth.activeHotel = hotel || " + SA + ")";
  const can = (p) => `${member} && @request.auth.permissions.code ?= '${p}'`;
  const hotel = { name: "hotel", type: "relation", collectionId: hotels.id, maxSelect: 1, required: true, cascadeDelete: true };
  const sel = (name, values, required) => ({ name, type: "select", maxSelect: 1, values, required: !!required });
  const stamps = () => [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  const suppliers = new Collection({
    type: "base",
    name: "suppliers",
    fields: [
      hotel,
      { name: "name", type: "text", required: true, max: 120 },
      { name: "contactName", type: "text", max: 120 },
      { name: "email", type: "email" },
      { name: "baleChatId", type: "text", max: 40 },
      { name: "phone", type: "text", max: 20 },
      { name: "leadTimeDays", type: "number", min: 0, max: 120 },
      { name: "active", type: "bool" },
      { name: "notes", type: "text", max: 500 },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_suppliers_name ON suppliers (hotel, name)"],
    listRule: can("inventory.view"),
    viewRule: can("inventory.view"),
    createRule: can("inventory.manage"),
    updateRule: can("inventory.manage"),
    deleteRule: null,
  });
  app.save(suppliers);

  const actions = app.findCollectionByNameOrId("aiActions");
  const type = actions.fields.getByName("type");
  const values = [];
  for (const v of type.values) values.push(String(v));
  if (values.indexOf("createPurchaseOrder") < 0) type.values = values.concat(["createPurchaseOrder"]);
  app.save(actions);

  const orders = new Collection({
    type: "base",
    name: "purchaseOrders",
    fields: [
      hotel,
      { name: "supplier", type: "relation", collectionId: suppliers.id, maxSelect: 1, cascadeDelete: false },
      { name: "supplierName", type: "text", max: 120 },
      sel("status", PO_STATUS, true),
      { name: "action", type: "relation", collectionId: actions.id, maxSelect: 1, cascadeDelete: false },
      // [{itemId, name, unit, quantity, suggested, kind, orderBy, unitCost, cost, received}]
      { name: "lines", type: "json", maxSize: 50000 },
      { name: "total", type: "number", min: 0 },
      { name: "leadTimeDays", type: "number", min: 0 },
      { name: "orderedAt", type: "date" },
      { name: "expectedAt", type: "date" },
      { name: "sentAt", type: "date" },
      { name: "sentVia", type: "text", max: 40 },
      { name: "receivedAt", type: "date" },
      // [{step: 1|2, by, byName, role, at, decision, note}]
      { name: "approvals", type: "json", maxSize: 10000 },
      { name: "needsSecondApproval", type: "bool" },
      { name: "editedByName", type: "text", max: 120 },
      { name: "editedBy", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "note", type: "text", max: 1000 },
      { name: "idempotencyKey", type: "text", max: 200 },
    ].concat(stamps()),
    indexes: [
      "CREATE INDEX idx_purchase_orders_status ON purchaseOrders (hotel, status)",
      "CREATE UNIQUE INDEX idx_purchase_orders_key ON purchaseOrders (hotel, idempotencyKey) WHERE idempotencyKey != ''",
    ],
    listRule: can("inventory.view"),
    viewRule: can("inventory.view"),
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(orders);

  const items = app.findCollectionByNameOrId("inventoryItems");
  items.fields.add(new RelationField({ name: "supplierRef", collectionId: suppliers.id, maxSelect: 1, cascadeDelete: false }));
  items.fields.add(new NumberField({ name: "leadTimeDays", min: 0, max: 120 }));
  items.fields.add(new NumberField({ name: "shelfLifeDays", min: 0, max: 3650 }));
  items.fields.add(new NumberField({ name: "parLevel", min: 0 }));
  items.fields.add(new SelectField({ name: "deliveryPattern", maxSelect: 1, values: ["auto", "daily", "scheduled", "onDemand"] }));
  // The nightly plan (rate, lead time, reorder point, cover), written by the server only.
  items.fields.add(new JSONField({ name: "replenishment", maxSize: 20000 }));
  app.save(items);
}, (app) => {
  const items = app.findCollectionByNameOrId("inventoryItems");
  for (const f of ["replenishment", "deliveryPattern", "parLevel", "shelfLifeDays", "leadTimeDays", "supplierRef"]) items.fields.removeByName(f);
  app.save(items);
  for (const name of ["purchaseOrders", "suppliers"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (_) {}
  }
  const actions = app.findCollectionByNameOrId("aiActions");
  for (const a of app.findRecordsByFilter("aiActions", "type = 'createPurchaseOrder'", "", 0, 0)) app.delete(a);
  const type = actions.fields.getByName("type");
  const values = [];
  for (const v of type.values) if (String(v) !== "createPurchaseOrder") values.push(String(v));
  type.values = values;
  app.save(actions);
});
