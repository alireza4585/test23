/// <reference path="../../pb_data/types.d.ts" />
/**
 * Purchase suggestions (AI phase 2, F5; flag replenishment). The maths is in
 * core.js (replenishment.ts); this file loads data, keeps the draft purchase
 * orders and runs their life cycle. Nothing is ordered without a person:
 *
 *   nightly       plan every item (stored on inventoryItems.replenishment) and,
 *                 through the rules engine, one insight per supplier; F1 then
 *                 proposes a createPurchaseOrder action and a draft order is
 *                 attached to it (refreshed nightly until someone edits it)
 *   edit          POST /api/zarin/purchase-orders/{id}/lines     inventory.manage, draft only
 *   approve       the action's decide route (inventory.manage); a non-GM
 *                 approval above hotels.settings.purchaseApprovalLimit (rial)
 *                 — or any amount when no limit is set — waits for the GM:
 *                 POST /api/zarin/purchase-orders/{id}/approve  {decision, note}
 *   send          n8n (router 01) on purchaseOrder.approved, then
 *                 POST /v1/hotels/{id}/purchase-orders/{po}/sent (signed)
 *   receive       POST /api/zarin/purchase-orders/{id}/receive  inventory.move:
 *                 a receive movement per line; the order → receipt days are
 *                 the lead-time samples the next plans learn from
 *   cancel        POST /api/zarin/purchase-orders/{id}/cancel   inventory.manage
 *   overdue       GET /v1/hotels/{id}/purchase-orders/overdue (signed, n8n reminder)
 *
 * Purchase orders carry costs; like inventoryItems.unitCost they are readable
 * with inventory.view. Insights and actions carry quantities only.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const MOVEMENT_DAYS = 90;
const OPEN = ["awaitingApproval", "approved", "sent"];
const MAX_QUANTITY = 1e6;
const SECOND_APPROVERS = ["generalManager", "superAdmin"];

const num = (r, f) => r.getFloat(f);
const round2 = (v) => Math.round(v * 100) / 100;

function supplierMap(app, hotelId) {
  const out = {};
  for (const s of z.findMany(app, "suppliers", "hotel = {:h}", { h: hotelId })) {
    out[s.id] = { id: s.id, name: s.getString("name"), leadTimeDays: num(s, "leadTimeDays") || null, record: s };
  }
  return out;
}

/** Everything planReplenishment needs, as of [now]. */
function inputFor(app, hotelId, now) {
  const today = z.dayKey(now);
  const suppliers = supplierMap(app, hotelId);
  const items = z.findMany(app, "inventoryItems", "hotel = {:h}", { h: hotelId }).map((r) => {
    const sup = suppliers[r.getString("supplierRef")];
    return {
      id: r.id, name: r.getString("name"), unit: r.getString("unit"), quantity: num(r, "quantity"),
      reorderLevel: num(r, "reorderLevel"), reorderQuantity: num(r, "reorderQuantity"), unitCost: num(r, "unitCost"),
      supplierId: sup ? sup.id : null, supplierName: sup ? sup.name : r.getString("supplier") || null,
      leadTimeDays: num(r, "leadTimeDays") || null, shelfLifeDays: num(r, "shelfLifeDays") || null,
      parLevel: num(r, "parLevel") || null, deliveryPattern: r.getString("deliveryPattern") || "auto",
    };
  });
  const since = z.pbDate(new Date(now.getTime() - MOVEMENT_DAYS * 864e5));
  const movements = z.findMany(app, "inventoryMovements", "hotel = {:h} && created >= {:s}", { h: hotelId, s: since }).map((m) => ({
    itemId: m.getString("item"), type: m.getString("type"), delta: num(m, "delta"), day: z.dayKey(z.parseDate(m.getString("created"))),
  }));
  const orders = [];
  for (const po of z.findMany(app, "purchaseOrders", "hotel = {:h} && status != 'cancelled' && status != 'draft'", { h: hotelId })) {
    const dayOf = (f) => (po.getString(f) ? z.dayKey(z.parseDate(po.getString(f))) : null);
    for (const l of z.jsonOf(po, "lines") || []) {
      orders.push({
        itemId: l.itemId, supplierId: po.getString("supplier") || null, quantity: Number(l.quantity) || 0, status: po.getString("status"),
        orderedDay: dayOf("orderedAt"), expectedDay: dayOf("expectedAt"), receivedDay: dayOf("receivedAt"),
      });
    }
  }
  return { today, items, suppliers: Object.keys(suppliers).map((k) => suppliers[k]), movements, orders };
}

/** Nightly plan: stored per item, and returned for the rules engine (EngineInput.replenishment). */
function stateForRules(app, hotelId, now) {
  const input = inputFor(app, hotelId, now);
  const res = core.planReplenishment(input);
  const at = z.pbDate(now);
  for (const p of res.plans) {
    const rec = z.find(app, "inventoryItems", p.itemId);
    rec.set("replenishment", {
      at, ok: p.ok, reason: p.reason, pattern: p.pattern, method: p.forecast.method, rate: p.forecast.rate, sigma: p.forecast.sigma,
      leadTimeDays: p.leadTime.days, leadTimeSource: p.leadTime.source, safetyStock: p.safetyStock, reorderPoint: p.reorderPoint,
      parLevel: p.parLevel, onOrder: p.onOrder, daysOfCover: p.daysOfCover,
      suggestion: p.suggestion ? { kind: p.suggestion.kind, quantity: p.suggestion.quantity, orderBy: p.suggestion.orderBy } : null,
    });
    app.unsafeWithoutHooks().save(rec);
  }
  return res;
}

// ------------------------------------------------------------ draft orders
function linesWithCost(app, hotelId, lines) {
  return lines.map((l) => {
    const item = z.find(app, "inventoryItems", String(l.itemId));
    if (item.getString("hotel") !== hotelId) throw z.bad("cross_hotel_reference", { field: "inventoryItems" });
    const unitCost = num(item, "unitCost");
    const quantity = Number(l.quantity);
    return {
      itemId: item.id, name: item.getString("name"), unit: item.getString("unit"), quantity,
      suggested: l.suggested === undefined ? quantity : Number(l.suggested), kind: l.kind || "reorder", orderBy: l.orderBy || null,
      unitCost, cost: round2(unitCost * quantity),
    };
  });
}

const totalOf = (lines) => round2(lines.reduce((s, l) => s + (l.cost || 0), 0));

function leadTimeFor(app, lines) {
  let lead = 0;
  for (const l of lines) {
    const plan = z.jsonOf(z.find(app, "inventoryItems", l.itemId), "replenishment") || {};
    lead = Math.max(lead, Number(plan.leadTimeDays) || core.DEFAULT_LEAD_DAYS);
  }
  return lead || core.DEFAULT_LEAD_DAYS;
}

/** The draft order of a freshly proposed createPurchaseOrder action (called by actions.proposeFor). */
function attachDraft(app, action) {
  const hotelId = action.getString("hotel");
  const params = z.jsonOf(action, "params") || {};
  const lines = linesWithCost(app, hotelId, params.lines || []);
  const supplierId = params.supplierId && z.findFirst(app, "suppliers", "hotel = {:h} && id = {:id}", { h: hotelId, id: String(params.supplierId) }) ? String(params.supplierId) : "";
  const po = new Record(z.col(app, "purchaseOrders"), {
    hotel: hotelId, supplier: supplierId, supplierName: String(params.supplierName || "").slice(0, 120), status: "draft",
    action: action.id, lines, total: totalOf(lines), leadTimeDays: leadTimeFor(app, lines), approvals: [], needsSecondApproval: false,
    idempotencyKey: `action:${action.id}`,
  });
  app.save(po);
  action.set("params", Object.assign({}, params, { purchaseOrderId: po.id }));
  app.save(action);
  return po;
}

/** Nightly: drafts nobody has edited follow the latest plan of their insight. */
function refreshDrafts(app, hotelId) {
  let n = 0;
  for (const po of z.findMany(app, "purchaseOrders", "hotel = {:h} && status = 'draft' && editedBy = ''", { h: hotelId })) {
    const action = z.findFirst(app, "aiActions", "id = {:id} && status = 'proposed'", { id: po.getString("action") });
    if (!action) continue;
    const insight = action.getString("insight") ? z.findFirst(app, "aiInsights", "id = {:id}", { id: action.getString("insight") }) : null;
    const subject = insight ? ((z.jsonOf(insight, "expectedImpact") || {}).subject || {}) : {};
    if (!Array.isArray(subject.lines) || !subject.lines.length) continue;
    const lines = linesWithCost(app, hotelId, subject.lines);
    po.load({ lines, total: totalOf(lines), leadTimeDays: leadTimeFor(app, lines) });
    app.save(po);
    action.set("params", Object.assign({}, z.jsonOf(action, "params") || {}, {
      lines: lines.map((l) => ({ itemId: l.itemId, name: l.name, unit: l.unit, quantity: l.quantity, kind: l.kind, orderBy: l.orderBy })),
    }));
    app.save(action);
    n++;
  }
  return n;
}

/** Drafts of actions that will never be decided are cancelled with them. */
function cancelDraftOf(app, actionId, note) {
  const po = z.findFirst(app, "purchaseOrders", "action = {:a} && status = 'draft'", { a: actionId });
  if (!po) return;
  po.load({ status: "cancelled", note: String(note || "").slice(0, 1000) });
  app.save(po);
}

// --------------------------------------------------------------- approval
function settingsLimit(app, hotelId) {
  const s = z.jsonOf(z.find(app, "hotels", hotelId), "settings") || {};
  const v = Number(s.purchaseApprovalLimit);
  return v > 0 ? v : null;
}

function emitApproved(app, po) {
  const hotelId = po.getString("hotel");
  const sup = po.getString("supplier") ? z.findFirst(app, "suppliers", "id = {:id}", { id: po.getString("supplier") }) : null;
  z.emit(app, "purchaseOrder.approved", hotelId, {
    purchaseOrderId: po.id, supplierName: po.getString("supplierName"),
    supplierEmail: sup ? sup.getString("email") : "", supplierBaleChatId: sup ? sup.getString("baleChatId") : "",
    hotelName: z.find(app, "hotels", hotelId).getString("name"), expectedAt: po.getString("expectedAt"),
    // What the supplier needs: no prices.
    lines: (z.jsonOf(po, "lines") || []).map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity })),
  });
}

function markApproved(app, po, now) {
  const lead = num(po, "leadTimeDays") || core.DEFAULT_LEAD_DAYS;
  po.load({ status: "approved", orderedAt: z.pbDate(now), expectedAt: z.pbDate(new Date(now.getTime() + lead * 864e5)) });
}

/**
 * EXECUTE.createPurchaseOrder (inside the decide transaction): the first
 * approval. Returns the executedRef.
 */
function executeOrder(tx, c, action, params, now) {
  z.requirePerm(c, "inventory.manage");
  const po = z.findFirst(tx, "purchaseOrders", "id = {:id}", { id: String(params.purchaseOrderId || "") });
  if (!po || po.getString("hotel") !== action.getString("hotel")) throw z.bad("purchase_order_missing");
  if (po.getString("status") !== "draft") throw z.bad("purchase_order_not_draft", { status: po.getString("status") });
  const lines = z.jsonOf(po, "lines") || [];
  if (!lines.length) throw z.bad("purchase_order_empty");
  const total = totalOf(lines);
  const limit = settingsLimit(tx, po.getString("hotel"));
  const byGm = SECOND_APPROVERS.indexOf(c.role) >= 0;
  const second = !byGm && !(limit !== null && total <= limit);
  const approvals = (z.jsonOf(po, "approvals") || []).concat([{ step: 1, by: c.id, byName: c.name, role: c.role, at: z.pbDate(now), decision: "approve" }]);
  po.load({ approvals, total, needsSecondApproval: second });
  if (second) {
    po.set("status", "awaitingApproval");
    z.notify(tx, {
      hotelId: po.getString("hotel"), roles: ["generalManager"], title: `تأیید دوم سفارش خرید از «${po.getString("supplierName") || "—"}»`,
      body: `${c.name} سفارش را تأیید کرده است؛ ${limit === null ? "برای این هتل سقف مبلغی تعیین نشده" : "مبلغ از سقف هتل بیشتر است"} و تأیید مدیرکل لازم است.`,
      category: "ai", severity: "warning", route: "/inventory",
    });
  } else {
    markApproved(tx, po, now);
  }
  tx.save(po);
  if (!second) emitApproved(tx, po);
  z.audit(tx, po.getString("hotel"), { action: "purchaseOrders.approve", collection: "purchaseOrders", id: po.id, actor: z.actorOf(c), changes: { step: 1, total, second } });
  return { collection: "purchaseOrders", id: po.id, status: po.getString("status") };
}

// ------------------------------------------------------------------ routes
function loadOrder(e, c) {
  const po = z.find(e.app, "purchaseOrders", e.request.pathValue("id"));
  const hotelId = z.requireHotel(c, po.getString("hotel"));
  z.requireFeature(e.app, hotelId, "replenishment");
  return { po, hotelId };
}

/** POST /api/zarin/purchase-orders/{id}/lines {lines: [{itemId, quantity}]} — draft only; quantity 0 removes a line. */
function editLines(e) {
  const c = z.caller(e);
  const { po, hotelId } = loadOrder(e, c);
  z.requirePerm(c, "inventory.manage");
  if (po.getString("status") !== "draft") throw z.bad("purchase_order_not_draft", { status: po.getString("status") });
  const body = e.requestInfo().body || {};
  const current = z.jsonOf(po, "lines") || [];
  const wanted = {};
  for (const l of Array.isArray(body.lines) ? body.lines : []) {
    const q = Number(l && l.quantity);
    if (!l || typeof l.itemId !== "string" || !isFinite(q) || q < 0 || q > MAX_QUANTITY) throw z.bad("invalid_lines");
    wanted[l.itemId] = q;
  }
  // Only the draft's own items: a draft is edited, not turned into another order.
  for (const id of Object.keys(wanted)) if (!current.some((l) => l.itemId === id)) throw z.bad("unknown_line", { itemId: id });
  const next = linesWithCost(e.app, hotelId, current
    .map((l) => Object.assign({}, l, { quantity: wanted[l.itemId] === undefined ? l.quantity : wanted[l.itemId] }))
    .filter((l) => l.quantity > 0));
  if (!next.length) throw z.bad("purchase_order_empty");
  const changes = current.map((l) => ({ itemId: l.itemId, from: l.quantity, to: wanted[l.itemId] === undefined ? l.quantity : wanted[l.itemId] }))
    .filter((x) => x.from !== x.to);
  e.app.runInTransaction((tx) => {
    const r = z.find(tx, "purchaseOrders", po.id);
    if (r.getString("status") !== "draft") throw z.bad("purchase_order_not_draft");
    r.load({ lines: next, total: totalOf(next), editedBy: c.id, editedByName: c.name });
    tx.save(r);
    const action = r.getString("action") ? z.findFirst(tx, "aiActions", "id = {:id}", { id: r.getString("action") }) : null;
    if (action) {
      action.set("params", Object.assign({}, z.jsonOf(action, "params") || {}, {
        lines: next.map((l) => ({ itemId: l.itemId, name: l.name, unit: l.unit, quantity: l.quantity, kind: l.kind, orderBy: l.orderBy })),
      }));
      tx.save(action);
    }
    z.audit(tx, hotelId, { action: "purchaseOrders.edit", collection: "purchaseOrders", id: r.id, actor: z.actorOf(c), changes: { lines: changes } });
  });
  return e.json(200, z.find(e.app, "purchaseOrders", po.id));
}

/** POST /api/zarin/purchase-orders/{id}/approve {decision: "approve"|"reject", note} — the GM's second approval. */
function secondApproval(e) {
  const c = z.caller(e);
  const { po, hotelId } = loadOrder(e, c);
  if (SECOND_APPROVERS.indexOf(c.role) < 0) throw z.forbidden("second_approval_not_allowed", { role: c.role });
  z.requirePerm(c, "ai.actions.approve");
  if (po.getString("status") !== "awaitingApproval") throw z.bad("purchase_order_not_awaiting", { status: po.getString("status") });
  const b = e.requestInfo().body || {};
  if (b.decision !== "approve" && b.decision !== "reject") throw z.bad("invalid_decision");
  const note = String(b.note || "").trim().slice(0, 1000);
  if (b.decision === "reject" && note.length < 3) throw z.bad("note_required");
  const approvals = z.jsonOf(po, "approvals") || [];
  // Four eyes: the second approval is someone else's.
  if (approvals.some((a) => a.by === c.id)) throw z.forbidden("same_approver");
  const now = new Date();
  e.app.runInTransaction((tx) => {
    const r = z.find(tx, "purchaseOrders", po.id);
    if (r.getString("status") !== "awaitingApproval") throw z.bad("purchase_order_not_awaiting");
    r.set("approvals", approvals.concat([{ step: 2, by: c.id, byName: c.name, role: c.role, at: z.pbDate(now), decision: b.decision, note }]));
    if (b.decision === "approve") markApproved(tx, r, now);
    else r.load({ status: "cancelled", note });
    tx.save(r);
    if (b.decision === "approve") emitApproved(tx, r);
    z.audit(tx, hotelId, { action: "purchaseOrders.approve", collection: "purchaseOrders", id: r.id, actor: z.actorOf(c), changes: { step: 2, decision: b.decision, note } });
  });
  return e.json(200, z.find(e.app, "purchaseOrders", po.id));
}

/** POST /api/zarin/purchase-orders/{id}/receive {lines: [{itemId, quantity}]} — receipt closes the order. */
function receive(e) {
  const c = z.caller(e);
  const { po, hotelId } = loadOrder(e, c);
  z.requirePerm(c, "inventory.move");
  if (po.getString("status") !== "approved" && po.getString("status") !== "sent") throw z.bad("purchase_order_not_open", { status: po.getString("status") });
  const body = e.requestInfo().body || {};
  const got = {};
  for (const l of Array.isArray(body.lines) ? body.lines : []) {
    const q = Number(l && l.quantity);
    if (!l || typeof l.itemId !== "string" || !isFinite(q) || q < 0 || q > MAX_QUANTITY) throw z.bad("invalid_lines");
    got[l.itemId] = q;
  }
  const lines = z.jsonOf(po, "lines") || [];
  for (const id of Object.keys(got)) if (!lines.some((l) => l.itemId === id)) throw z.bad("unknown_line", { itemId: id });
  const now = new Date();
  const ops = require(`${__hooks}/lib/ops.js`);
  const moved = [];
  e.app.runInTransaction((tx) => {
    const r = z.find(tx, "purchaseOrders", po.id);
    if (r.getString("status") !== "approved" && r.getString("status") !== "sent") throw z.bad("purchase_order_not_open");
    const done = lines.map((l) => {
      // Lines not listed arrived in full.
      const q = got[l.itemId] === undefined ? Number(l.quantity) : got[l.itemId];
      if (q > 0) moved.push(ops.applyMovement(tx, c, z.find(tx, "inventoryItems", l.itemId), "receive", q, `دریافت سفارش خرید ${r.id}`));
      return Object.assign({}, l, { received: q });
    });
    r.load({ status: "received", receivedAt: z.pbDate(now), lines: done });
    tx.save(r);
    z.audit(tx, hotelId, { action: "purchaseOrders.receive", collection: "purchaseOrders", id: r.id, actor: z.actorOf(c), changes: { lines: done.map((l) => ({ itemId: l.itemId, ordered: l.quantity, received: l.received })) } });
  });
  for (const m of moved) ops.lowStockCheck(e.app, m.item, m.before);
  return e.json(200, z.find(e.app, "purchaseOrders", po.id));
}

/** POST /api/zarin/purchase-orders/{id}/cancel {note} — an order that has not arrived. */
function cancel(e) {
  const c = z.caller(e);
  const { po, hotelId } = loadOrder(e, c);
  z.requirePerm(c, "inventory.manage");
  if (["awaitingApproval", "approved", "sent"].indexOf(po.getString("status")) < 0) throw z.bad("purchase_order_not_open", { status: po.getString("status") });
  const note = String((e.requestInfo().body || {}).note || "").trim().slice(0, 1000);
  if (note.length < 3) throw z.bad("note_required");
  e.app.runInTransaction((tx) => {
    const r = z.find(tx, "purchaseOrders", po.id);
    r.load({ status: "cancelled", note });
    tx.save(r);
    z.audit(tx, hotelId, { action: "purchaseOrders.cancel", collection: "purchaseOrders", id: r.id, actor: z.actorOf(c), changes: { from: po.getString("status"), note } });
  });
  return e.json(200, z.find(e.app, "purchaseOrders", po.id));
}

/** Signed: POST /v1/hotels/{id}/purchase-orders/{po}/sent {via} — n8n delivered it to the supplier. */
function markSent(app, hotelId, poId, body) {
  const po = z.findFirst(app, "purchaseOrders", "hotel = {:h} && id = {:id}", { h: hotelId, id: poId });
  if (!po) throw z.notFound();
  if (po.getString("status") === "sent") return { ok: true, status: "sent" };
  if (po.getString("status") !== "approved") throw z.bad("purchase_order_not_approved", { status: po.getString("status") });
  po.load({ status: "sent", sentAt: z.pbDate(new Date()), sentVia: String((body || {}).via || "n8n").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) });
  app.save(po);
  z.audit(app, hotelId, { action: "purchaseOrders.sent", collection: "purchaseOrders", id: po.id, actor: { uid: "integration", type: "integration" }, changes: { via: po.getString("sentVia") }, source: "n8n" });
  return { ok: true, status: "sent" };
}

/** Signed: GET /v1/hotels/{id}/purchase-orders/overdue — approved or sent, past the expected day. */
function overdue(app, hotelId, now) {
  return z.findMany(app, "purchaseOrders", "hotel = {:h} && (status = 'approved' || status = 'sent') && expectedAt != '' && expectedAt < {:n}", { h: hotelId, n: z.pbDate(now) }, "expectedAt")
    .map((po) => ({
      purchaseOrderId: po.id, supplierName: po.getString("supplierName"), status: po.getString("status"), expectedAt: po.getString("expectedAt"),
      daysLate: Math.floor((now.getTime() - z.parseDate(po.getString("expectedAt")).getTime()) / 864e5),
      lines: (z.jsonOf(po, "lines") || []).map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity })),
    }));
}

module.exports = {
  inputFor, stateForRules, attachDraft, refreshDrafts, cancelDraftOf, executeOrder,
  editLines, secondApproval, receive, cancel, markSent, overdue,
};
