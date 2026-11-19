// F5: what happens to an open draft purchase order night after night.
// An unedited draft follows the nightly plan (quantities recomputed, lines no
// longer needed dropped, cancelled when nothing is needed). An edited draft
// keeps the manager's quantities, loses lines no longer suggested and gains
// newly needed ones marked isNew (audited). Any draft expires after 7 days
// without a decision; a need that remains gets a fresh draft the next night.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { login, post, superuser } from "./helpers.mjs";

const PASSWORD = `Rf-${randomBytes(6).toString("hex")}-a1`;
const DAY_MS = 864e5;
const stamp = (d) => d.toISOString().replace("T", " ");
function nid(nine) {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(nine[i]) * (10 - i);
  const r = sum % 11;
  return `${nine}${r < 2 ? r : 11 - r}`;
}

let su;
let H;
let inv;
let invUser;
const items = {};
// One nightly run; [daysAhead] simulates a later night.
const analytics = (daysAhead = 0) => su.send(`/api/zarin/admin/hotels/${H}/analytics`, {
  method: "POST", body: { insights: true, ...(daysAhead ? { now: new Date(Date.now() + daysAhead * DAY_MS).toISOString() } : {}) },
});
const refreshLogs = async (poId) => su.collection("auditLogs").getFullList({ filter: `resourceId = "${poId}" && action ~ "purchaseOrders."`, sort: "created" });
const openDraft = async () => (await su.collection("purchaseOrders").getFullList({ filter: `hotel = "${H}" && status = "draft"` }))[0] ?? null;
const lines = (po) => Object.fromEntries(po.lines.map((l) => [l.itemId, l.quantity]));
const setStock = (sku, quantity) => su.collection("inventoryItems").update(items[sku].id, { quantity });

beforeAll(async () => {
  su = await superuser();
  H = (await su.collection("hotels").create({ name: "هتل آزمایشی تازه‌سازی", status: "trial", settings: { features: { recommendationLoop: true, replenishment: true } } })).id;
  const supplier = await su.collection("suppliers").create({ hotel: H, name: "تأمین مواد غذایی", leadTimeDays: 3, active: true });
  const n = nid("864213579");
  invUser = await su.collection("users").create({ nationalId: n, fullName: "آزمون انبار", role: "inventoryManager", hotels: [H], primaryHotel: H, status: "active", password: PASSWORD, passwordConfirm: PASSWORD });
  inv = await login(n, PASSWORD);
  await su.send("/api/zarin/admin/import", { method: "POST", body: { hotel: H, collection: "inventoryItems", records: [
    { fields: { name: "گوشت", sku: "MT-1", category: "foodAndBeverage", unit: "kg", quantity: 30, reorderLevel: 10, unitCost: 1, supplier: "تأمین مواد غذایی" } },
    { fields: { name: "پیاز", sku: "ON-1", category: "foodAndBeverage", unit: "kg", quantity: 30, reorderLevel: 10, unitCost: 1, supplier: "تأمین مواد غذایی" } },
  ] } });
  for (const it of await su.collection("inventoryItems").getFullList({ filter: `hotel = "${H}"` })) items[it.sku] = it;
  for (const sku of ["MT-1", "ON-1"]) await su.collection("inventoryItems").update(items[sku].id, { supplierRef: supplier.id });
  const moves = [];
  for (let i = 56; i >= 1; i--) {
    const at = stamp(new Date(Date.now() - i * DAY_MS));
    moves.push({ created: at, fields: { item: items["MT-1"].id, itemName: "گوشت", type: "issue", delta: -(10 + (i % 3)), quantityBefore: 0, quantityAfter: 0 } });
    moves.push({ created: at, fields: { item: items["ON-1"].id, itemName: "پیاز", type: "issue", delta: -(10 + (i % 4)), quantityBefore: 0, quantityAfter: 0 } });
  }
  await su.send("/api/zarin/admin/import", { method: "POST", body: { hotel: H, collection: "inventoryMovements", records: moves } });
});
afterAll(async () => {
  if (invUser) await su.collection("users").delete(invUser.id).catch(() => {});
  if (H) await su.collection("hotels").delete(H).catch(() => {});
});

describe("F5 open drafts, night after night", () => {
  it("an unedited draft is recomputed nightly, drops lines no longer needed, and is cancelled when none are", async () => {
    await analytics();
    const first = await openDraft();
    expect(Object.keys(lines(first)).sort()).toEqual([items["MT-1"].id, items["ON-1"].id].sort());

    // Night 2: less meat on hand (needs more), onions restocked (no longer needed).
    await setStock("MT-1", 15);
    await setStock("ON-1", 400);
    await analytics();
    const second = await openDraft();
    expect(second.id).toBe(first.id); // the same draft, refreshed
    expect(Object.keys(lines(second))).toEqual([items["MT-1"].id]);
    expect(lines(second)[items["MT-1"].id]).toBeGreaterThan(lines(first)[items["MT-1"].id]);

    // Night 3: nothing needed: the action expires and the draft is cancelled.
    await setStock("MT-1", 400);
    await analytics();
    expect(await openDraft()).toBeNull();
    expect((await su.collection("purchaseOrders").getOne(first.id)).status).toBe("cancelled");
    expect((await su.collection("aiActions").getOne(first.action)).status).toBe("expired");
  });

  it("an edited draft keeps the manager's quantities, drops lines no longer suggested and marks new ones", async () => {
    await setStock("MT-1", 30);
    await setStock("ON-1", 30);
    await analytics();
    const draft = await openDraft();
    await post(inv, `/api/zarin/purchase-orders/${draft.id}/lines`, { lines: [{ itemId: items["MT-1"].id, quantity: 25 }] });

    // Onions no longer needed: the line goes, the manager's meat quantity stays.
    await setStock("ON-1", 400);
    await analytics();
    let po = await su.collection("purchaseOrders").getOne(draft.id);
    expect(po.status).toBe("draft");
    expect(lines(po)).toEqual({ [items["MT-1"].id]: 25 });

    // Onions needed again: added with the suggested quantity, marked new.
    await setStock("ON-1", 15);
    await analytics();
    po = await su.collection("purchaseOrders").getOne(draft.id);
    expect(lines(po)[items["MT-1"].id]).toBe(25);
    const onion = po.lines.find((l) => l.itemId === items["ON-1"].id);
    expect(onion).toMatchObject({ isNew: true });
    expect(onion.quantity).toBeGreaterThan(0);
    expect(po.lines.find((l) => l.itemId === items["MT-1"].id).isNew).toBeUndefined();

    // Both changes are in the audit log, by the system.
    const logs = (await refreshLogs(draft.id)).filter((l) => l.action === "purchaseOrders.refresh");
    expect(logs.map((l) => [l.changes.removed.map((x) => x.itemId), l.changes.added.map((x) => x.itemId)])).toEqual([
      [[items["ON-1"].id], []],
      [[], [items["ON-1"].id]],
    ]);
    expect(logs.every((l) => l.actor.type === "system")).toBe(true);

    // The manager edits again: nothing stays marked new.
    await post(inv, `/api/zarin/purchase-orders/${draft.id}/lines`, { lines: [{ itemId: items["ON-1"].id, quantity: 20 }] });
    po = await su.collection("purchaseOrders").getOne(draft.id);
    expect(po.lines.some((l) => l.isNew)).toBe(false);
    expect(lines(po)).toEqual({ [items["MT-1"].id]: 25, [items["ON-1"].id]: 20 });
  });

  it("a draft without a decision for 7 days expires; if still needed, a fresh one comes the next night", async () => {
    const draft = await openDraft();
    expect(draft).toBeTruthy();
    await setStock("MT-1", 0);
    await setStock("ON-1", 0);
    // Six days on: still open.
    await analytics(6);
    expect((await su.collection("purchaseOrders").getOne(draft.id)).status).toBe("draft");
    // Eight days on: expired, the action too, the insight closed for a new cycle.
    await analytics(8);
    const expired = await su.collection("purchaseOrders").getOne(draft.id);
    expect(expired.status).toBe("cancelled");
    expect(expired.note).toMatch(/۷ روز/);
    const action = await su.collection("aiActions").getOne(draft.action);
    expect(action.status).toBe("expired");
    const insight = await su.collection("aiInsights").getOne(action.insight);
    expect(insight).toMatchObject({ status: "resolved", closedReason: "draft_expired" });
    expect((await refreshLogs(draft.id)).some((l) => l.action === "purchaseOrders.expire" && l.actor.type === "system")).toBe(true);
    // The next night (still needed): a new cycle with a fresh draft.
    await analytics();
    const fresh = await openDraft();
    expect(fresh).toBeTruthy();
    expect(fresh.id).not.toBe(draft.id);
    expect(fresh.action).not.toBe(draft.action);
  });
});
