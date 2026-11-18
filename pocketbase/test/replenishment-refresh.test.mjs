// F5: what happens to an open draft purchase order night after night.
// An unedited draft follows the nightly plan (quantities recomputed, lines no
// longer needed dropped, cancelled when nothing is needed); an edited draft is
// left as the manager edited it.
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
const analytics = () => su.send(`/api/zarin/admin/hotels/${H}/analytics`, { method: "POST", body: { insights: true } });
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

  it("an edited draft is not refreshed: a line no longer needed stays until the manager acts", async () => {
    await setStock("MT-1", 30);
    await setStock("ON-1", 30);
    await analytics();
    const draft = await openDraft();
    await post(inv, `/api/zarin/purchase-orders/${draft.id}/lines`, { lines: [{ itemId: items["MT-1"].id, quantity: 25 }] });
    await setStock("ON-1", 400); // onions no longer needed
    await analytics();
    const after = await su.collection("purchaseOrders").getOne(draft.id);
    expect(after.status).toBe("draft");
    expect(lines(after)[items["MT-1"].id]).toBe(25); // the manager's quantity
    expect(items["ON-1"].id in lines(after)).toBe(true); // stale line kept (current behaviour)
  });
});
