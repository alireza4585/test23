// AI phase 2, F5 on a live server: the nightly plan, one draft purchase order
// per supplier through the Action Center, editing, who may approve, the
// purchase limit and the GM's second approval, n8n's "sent" and overdue
// routes, the receipt (stock and learned lead time) and who sees costs.
// A trial hotel with synthetic data and throw-away users.
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRequire } from "node:module";

import { errorOf, login, post, signed, superuser } from "./helpers.mjs";

const core = createRequire(import.meta.url)("../pb_hooks/lib/core.js");

const PASSWORD = `Rp-${randomBytes(6).toString("hex")}-a1`;
const DAY_MS = 864e5;
const stamp = (d) => d.toISOString().replace("T", " ");

/** A checksum-valid synthetic national ID from nine digits (built at run time). */
function nid(nine) {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(nine[i]) * (10 - i);
  const r = sum % 11;
  return `${nine}${r < 2 ? r : 11 - r}`;
}

let su;
let H;
let supplier;
const users = {};
const items = {};
const importRecords = (body) => su.send("/api/zarin/admin/import", { method: "POST", body });
const analytics = (body) => su.send(`/api/zarin/admin/hotels/${H}/analytics`, { method: "POST", body });

beforeAll(async () => {
  su = await superuser();
  H = (await su.collection("hotels").create({
    name: "هتل آزمایشی F5", status: "trial",
    settings: { features: { recommendationLoop: true, replenishment: true }, purchaseApprovalLimit: 20_000_000 },
  })).id;
  supplier = await su.collection("suppliers").create({ hotel: H, name: "پخش بهداشتی", email: "orders@supplier.example", leadTimeDays: 3, active: true });
  const roles = { inventoryManager: "432198765", generalManager: "246813579", housekeepingManager: "135792468", energyManager: "975318642" };
  for (const [role, nine] of Object.entries(roles)) {
    users[role] = { nid: nid(nine), rec: await su.collection("users").create({
      nationalId: nid(nine), fullName: `آزمون ${role}`, role, hotels: [H], primaryHotel: H, status: "active", password: PASSWORD, passwordConfirm: PASSWORD,
    }) };
  }
  // Shampoo: 40 a day, 220 left. Soap: 20 a day, 900 left (no need). Bread: daily delivery, par logic.
  const made = (await importRecords({ hotel: H, collection: "inventoryItems", records: [
    { fields: { name: "شامپو", sku: "SH-1", category: "guestAmenities", unit: "عدد", quantity: 220, reorderLevel: 100, unitCost: 50_000, supplier: "پخش بهداشتی" } },
    { fields: { name: "صابون", sku: "SO-1", category: "guestAmenities", unit: "عدد", quantity: 900, reorderLevel: 100, unitCost: 20_000, supplier: "پخش بهداشتی" } },
    { fields: { name: "نان", sku: "BR-1", category: "foodAndBeverage", unit: "عدد", quantity: 70, reorderLevel: 0, unitCost: 30_000, supplier: "نانوایی" } },
  ] })).ids || [];
  for (const it of await su.collection("inventoryItems").getFullList({ filter: `hotel = "${H}"` })) items[it.sku] = it;
  expect(Object.keys(items).sort()).toEqual(["BR-1", "SH-1", "SO-1"]);
  void made;
  for (const sku of ["SH-1", "SO-1"]) await su.collection("inventoryItems").update(items[sku].id, { supplierRef: supplier.id });
  const now = Date.now();
  const moves = [];
  for (let i = 56; i >= 1; i--) {
    const at = new Date(now - i * DAY_MS);
    moves.push({ created: stamp(at), fields: { item: items["SH-1"].id, itemName: "شامپو", type: "issue", delta: -(36 + (i % 9)), quantityBefore: 0, quantityAfter: 0 } });
    moves.push({ created: stamp(at), fields: { item: items["SO-1"].id, itemName: "صابون", type: "issue", delta: -(18 + (i % 5)), quantityBefore: 0, quantityAfter: 0 } });
    moves.push({ created: stamp(at), fields: { item: items["BR-1"].id, itemName: "نان", type: "issue", delta: -(48 + (i % 5)), quantityBefore: 0, quantityAfter: 0 } });
    if (i <= 28) moves.push({ created: stamp(at), fields: { item: items["BR-1"].id, itemName: "نان", type: "receive", delta: 50, quantityBefore: 0, quantityAfter: 0 } });
  }
  for (let i = 0; i < moves.length; i += 500) await importRecords({ hotel: H, collection: "inventoryMovements", records: moves.slice(i, i + 500) });
});
afterAll(async () => {
  for (const u of Object.values(users)) await su.collection("users").delete(u.rec.id).catch(() => {});
  if (H) await su.collection("hotels").delete(H).catch(() => {});
});

const as = (role) => login(users[role].nid, PASSWORD);
const draftOf = async () => su.collection("purchaseOrders").getFirstListItem(`hotel = "${H}" && status = "draft"`);
const costsOf = async (poId) => su.collection("purchaseOrderCosts").getFirstListItem(`purchaseOrder = "${poId}"`);

describe("F5 purchase suggestions", () => {
  it("nightly: a plan per item, one insight and one draft order per supplier, bread follows its par level", async () => {
    await analytics({ insights: true });
    const sh = await su.collection("inventoryItems").getOne(items["SH-1"].id);
    expect(sh.replenishment).toMatchObject({ ok: true, method: "ses", leadTimeDays: 3, leadTimeSource: "supplier", pattern: "scheduled" });
    expect(sh.replenishment.suggestion.kind).toBe("reorder");
    const br = await su.collection("inventoryItems").getOne(items["BR-1"].id);
    expect(br.replenishment.pattern).toBe("daily");
    expect(br.replenishment.suggestion).toBeNull(); // 70 on hand covers tomorrow
    const insights = await su.collection("aiInsights").getFullList({ filter: `hotel = "${H}" && status = "active"` });
    expect(insights.map((i) => i.rule)).toEqual(["replenishment"]);
    expect(insights[0].key).toBe(`replenishment_${supplier.id}`);
    const action = await su.collection("aiActions").getFirstListItem(`hotel = "${H}" && type = "createPurchaseOrder"`);
    expect(action).toMatchObject({ status: "proposed", department: "inventory" });
    expect(JSON.stringify(action.params)).not.toMatch(/cost|50000/i);
    const po = await draftOf();
    expect(po).toMatchObject({ supplier: supplier.id, action: action.id, leadTimeDays: 3 });
    expect(po.lines.map((l) => l.itemId)).toEqual([items["SH-1"].id]);
    // The order has no prices; they are apart, in purchaseOrderCosts.
    expect(po.total).toBeUndefined();
    expect(JSON.stringify(po.lines)).not.toMatch(/cost/i);
    const costs = await costsOf(po.id);
    expect(costs.total).toBe(po.lines[0].quantity * 50_000);
    expect(costs.lines).toEqual([{ itemId: items["SH-1"].id, unitCost: 50_000, cost: po.lines[0].quantity * 50_000 }]);
    expect(action.params.purchaseOrderId).toBe(po.id);
    // The next night keeps one action and one draft (same insight cycle).
    await analytics({ insights: true });
    expect((await su.collection("purchaseOrders").getList(1, 5, { filter: `hotel = "${H}"` })).totalItems).toBe(1);
  });

  it("orders with inventory.view; their prices exactly when revenue is visible (financeView), for every role", async () => {
    const po = await draftOf();
    expect((await (await as("energyManager")).collection("purchaseOrders").getList(1, 5)).totalItems).toBe(0);
    expect((await (await as("housekeepingManager")).collection("purchaseOrders").getList(1, 5)).totalItems).toBe(1);
    // One revenue row to compare with (phase 0.5: dailyFinance needs finance.view).
    const rev = await su.collection("dailyFinance").create({ hotel: H, day: "2026-01-01", roomRevenue: 1, totalRevenue: 1, source: "seed" });
    const extra = [];
    try {
      const seen = [];
      for (const [i, role] of core.ROLES.filter((r) => r !== "superAdmin").entries()) {
        let pb;
        if (users[role]) pb = await as(role);
        else {
          const id = nid(String(700000000 + i * 1111));
          const u = await su.collection("users").create({
            nationalId: id, fullName: `آزمون ${role}`, role, hotels: [H], primaryHotel: H, status: "active", password: PASSWORD, passwordConfirm: PASSWORD,
          });
          extra.push(u.id);
          pb = await login(id, PASSWORD);
        }
        const me = pb.authStore.record;
        const prices = (await pb.collection("purchaseOrderCosts").getList(1, 5)).totalItems;
        const revenue = (await pb.collection("dailyFinance").getList(1, 5, { filter: `id = "${rev.id}"` })).totalItems;
        seen.push([role, me.financeView, prices > 0, revenue > 0]);
      }
      if (process.env.ZH_TEST_VERBOSE) console.table(seen.map(([role, financeView, prices, revenue]) => ({ role, financeView, prices, revenue })));
      for (const [role, financeView, prices, revenue] of seen) {
        expect([role, prices], "prices follow financeView").toEqual([role, financeView]);
        expect([role, prices], "prices follow revenue").toEqual([role, revenue]);
      }
      // Both outcomes occur (the comparison is not vacuous).
      expect(new Set(seen.map((s) => s[1]))).toEqual(new Set([true, false]));
    } finally {
      await su.collection("dailyFinance").delete(rev.id);
      for (const id of extra) await su.collection("users").delete(id);
    }
    const denied = await errorOf(post(await as("housekeepingManager"), `/api/zarin/purchase-orders/${po.id}/lines`, { lines: [{ itemId: items["SH-1"].id, quantity: 1 }] }));
    expect(denied.code).toBe("missing_permission");
    const inv = await as("inventoryManager");
    const unknown = await errorOf(post(inv, `/api/zarin/purchase-orders/${po.id}/lines`, { lines: [{ itemId: items["SO-1"].id, quantity: 5 }] }));
    expect(unknown.code).toBe("unknown_line");
    // 400 × 50,000 = 20,000,000: exactly the hotel's limit.
    const edited = await post(inv, `/api/zarin/purchase-orders/${po.id}/lines`, { lines: [{ itemId: items["SH-1"].id, quantity: 400 }] });
    expect(edited).toMatchObject({ editedByName: "آزمون inventoryManager" });
    expect(JSON.stringify(edited)).not.toMatch(/cost|total/i);
    expect((await costsOf(po.id)).total).toBe(20_000_000);
    const action = await su.collection("aiActions").getOne(po.action);
    expect(action.params.lines[0].quantity).toBe(400);
    // An edited draft is no longer refreshed by the nightly plan.
    await analytics({ insights: true });
    expect((await su.collection("purchaseOrders").getOne(po.id)).lines[0].quantity).toBe(400);
  });

  it("a housekeeping manager cannot approve it; the inventory manager approves within the limit; n8n gets it without prices", async () => {
    const po = await draftOf();
    const hk = await errorOf(post(await as("housekeepingManager"), `/api/zarin/actions/${po.action}/decide`, { decision: "approve" }));
    expect([hk.status, hk.code]).toEqual([403, "department_not_allowed"]);
    const before = (await su.collection("outbox").getFullList({ filter: `hotel = "${H}" && type = "purchaseOrder.approved"` })).length;
    const out = await post(await as("inventoryManager"), `/api/zarin/actions/${po.action}/decide`, { decision: "approve" });
    expect(out).toMatchObject({ status: "executed", executedRef: { collection: "purchaseOrders", id: po.id, status: "approved" } });
    const approved = await su.collection("purchaseOrders").getOne(po.id);
    expect(approved).toMatchObject({ status: "approved", needsSecondApproval: false });
    expect(approved.expectedAt).not.toBe("");
    const events = await su.collection("outbox").getFullList({ filter: `hotel = "${H}" && type = "purchaseOrder.approved"` });
    expect(events.length).toBe(before + 1);
    const payload = events[events.length - 1].payload.data;
    expect(payload).toMatchObject({ purchaseOrderId: po.id, supplierEmail: "orders@supplier.example" });
    expect(payload.lines).toEqual([{ name: "شامپو", unit: "عدد", quantity: 400 }]);
    expect(JSON.stringify(payload)).not.toMatch(/cost|total/i);
  });

  it("n8n marks it sent (signed); overdue lists it after the expected day", async () => {
    const po = await su.collection("purchaseOrders").getFirstListItem(`hotel = "${H}" && status = "approved"`);
    expect((await signed(`/v1/hotels/${H}/purchase-orders/${po.id}/sent`, { method: "POST", body: { via: "email" } })).json).toEqual({ ok: true, status: "sent" });
    expect((await su.collection("purchaseOrders").getOne(po.id))).toMatchObject({ status: "sent", sentVia: "email" });
    expect((await fetch(`${su.baseURL}/v1/hotels/${H}/purchase-orders/${po.id}/sent`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await signed(`/v1/hotels/${H}/purchase-orders/overdue`)).json).toEqual([]);
    await su.collection("purchaseOrders").update(po.id, { expectedAt: stamp(new Date(Date.now() - 2 * DAY_MS)) });
    const late = (await signed(`/v1/hotels/${H}/purchase-orders/overdue`)).json;
    expect(late).toEqual([expect.objectContaining({ purchaseOrderId: po.id, daysLate: 2, lines: [{ name: "شامپو", unit: "عدد", quantity: 400 }] })]);
  });

  it("the receipt adds stock through the ledger and becomes a lead-time sample", async () => {
    const po = await su.collection("purchaseOrders").getFirstListItem(`hotel = "${H}" && status = "sent"`);
    const before = (await su.collection("inventoryItems").getOne(items["SH-1"].id)).quantity;
    const out = await post(await as("inventoryManager"), `/api/zarin/purchase-orders/${po.id}/receive`, { lines: [{ itemId: items["SH-1"].id, quantity: 380 }] });
    expect(out).toMatchObject({ status: "received" });
    expect(out.lines[0]).toMatchObject({ quantity: 400, received: 380 });
    expect((await su.collection("inventoryItems").getOne(items["SH-1"].id)).quantity).toBe(before + 380);
    const mv = await su.collection("inventoryMovements").getFirstListItem(`item = "${items["SH-1"].id}" && type = "receive"`, { sort: "-created" });
    expect(mv).toMatchObject({ delta: 380, quantityBefore: before, quantityAfter: before + 380 });
    const again = await errorOf(post(await as("inventoryManager"), `/api/zarin/purchase-orders/${po.id}/receive`, {}));
    expect(again.code).toBe("purchase_order_not_open");
  });

  it("above the limit an inventory manager's approval waits for the GM, who must be someone else", async () => {
    // Back to low stock: a new cycle, a new draft.
    await su.collection("inventoryItems").update(items["SH-1"].id, { quantity: 150 });
    await su.collection("aiInsights").update((await su.collection("aiInsights").getFirstListItem(`hotel = "${H}" && rule = "replenishment"`)).id, { status: "resolved" });
    await analytics({ insights: true });
    const po = await draftOf();
    await post(await as("inventoryManager"), `/api/zarin/purchase-orders/${po.id}/lines`, { lines: [{ itemId: items["SH-1"].id, quantity: 600 }] });
    await post(await as("inventoryManager"), `/api/zarin/actions/${po.action}/decide`, { decision: "approve" });
    expect(await su.collection("purchaseOrders").getOne(po.id)).toMatchObject({ status: "awaitingApproval", needsSecondApproval: true });
    expect((await costsOf(po.id)).total).toBe(30_000_000);
    const notYou = await errorOf(post(await as("inventoryManager"), `/api/zarin/purchase-orders/${po.id}/approve`, { decision: "approve" }));
    expect(notYou.code).toBe("second_approval_not_allowed");
    const gm = await as("generalManager");
    const reason = await errorOf(post(gm, `/api/zarin/purchase-orders/${po.id}/approve`, { decision: "reject" }));
    expect(reason.code).toBe("note_required");
    const ok = await post(gm, `/api/zarin/purchase-orders/${po.id}/approve`, { decision: "approve" });
    expect(ok.status).toBe("approved");
    expect(ok.approvals.map((a) => [a.step, a.role])).toEqual([[1, "inventoryManager"], [2, "generalManager"]]);
    // Cancelling an order that has not arrived needs a reason.
    const inv = await as("inventoryManager");
    expect((await errorOf(post(inv, `/api/zarin/purchase-orders/${po.id}/cancel`, {}))).code).toBe("note_required");
    expect((await post(inv, `/api/zarin/purchase-orders/${po.id}/cancel`, { note: "تأمین‌کننده موجودی ندارد" })).status).toBe("cancelled");
  });

  it("without the flag the routes refuse and the old stock-out rule is back", async () => {
    const hotel = await su.collection("hotels").getOne(H);
    await su.collection("hotels").update(H, { settings: { ...hotel.settings, features: { recommendationLoop: true } } });
    try {
      const po = await su.collection("purchaseOrders").getFirstListItem(`hotel = "${H}"`);
      expect((await errorOf(post(await as("inventoryManager"), `/api/zarin/purchase-orders/${po.id}/cancel`, { note: "آزمون پرچم" }))).code).toBe("feature_disabled");
      await su.collection("inventoryItems").update(items["SH-1"].id, { quantity: 60 });
      await analytics({ insights: true });
      const rules = (await su.collection("aiInsights").getFullList({ filter: `hotel = "${H}" && status = "active"` })).map((i) => i.rule);
      expect(rules).toContain("stockout");
    } finally {
      await su.collection("hotels").update(H, { settings: hotel.settings });
    }
  });
});
