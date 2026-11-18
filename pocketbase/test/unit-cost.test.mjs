// Unit costs and stock value only with finance.view (1761000000): the same
// condition as revenue (dailyFinance) and purchase-order prices.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ACCOUNTS } from "../scripts/seed.mjs";
import { errorOf, hotelId, login, superuser } from "./helpers.mjs";

const nidOf = (role) => ACCOUNTS.find((a) => a[1] === role)[0];
let su;
let item;
const created = [];

beforeAll(async () => {
  su = await superuser();
  item = (await su.collection("inventoryItems").getList(1, 1, { filter: `hotel = "${hotelId()}" && unitCost > 0` })).items[0];
});
afterAll(async () => {
  for (const id of created) await su.collection("inventoryItems").delete(id).catch(() => {});
});

describe("unit cost behind finance.view", () => {
  it("every role sees unit costs exactly when it sees revenue (financeView)", async () => {
    expect(item.unitCost).toBeGreaterThan(0);
    const rev = (await su.collection("dailyFinance").getList(1, 1, { filter: `hotel = "${hotelId()}"` })).items[0];
    expect(rev).toBeTruthy();
    const seen = [];
    for (const role of [...new Set(ACCOUNTS.map((a) => a[1]))].filter((r) => r !== "superAdmin")) {
      const pb = await login(nidOf(role));
      let unit = null;
      try {
        unit = "unitCost" in (await pb.collection("inventoryItems").getOne(item.id));
      } catch (e) {
        unit = e.status === 404 ? "no inventory.view" : `error ${e.status}`;
      }
      const revenue = (await pb.collection("dailyFinance").getList(1, 1, { filter: `id = "${rev.id}"` })).totalItems > 0;
      seen.push({ role, financeView: pb.authStore.record.financeView, unitCost: unit, revenue });
    }
    if (process.env.ZH_TEST_VERBOSE) console.table(seen);
    for (const s of seen.filter((x) => typeof x.unitCost === "boolean")) {
      expect([s.role, s.unitCost]).toEqual([s.role, s.financeView]);
      expect([s.role, s.unitCost]).toEqual([s.role, s.revenue]);
    }
    // Both outcomes occur among roles that see inventory.
    expect(new Set(seen.filter((x) => typeof x.unitCost === "boolean").map((x) => x.unitCost))).toEqual(new Set([true, false]));
  });

  it("no filter or sort by unit cost (it would reveal the value), for anyone but a superuser", async () => {
    for (const role of ["inventoryManager", "generalManager"]) {
      const pb = await login(nidOf(role));
      expect((await errorOf(pb.collection("inventoryItems").getList(1, 5, { filter: `unitCost > ${item.unitCost - 1}` }))).status).toBe(400);
      expect((await errorOf(pb.collection("inventoryItems").getList(1, 5, { sort: "-unitCost" }))).status).toBe(400);
    }
  });

  it("the inventory manager may still enter a unit cost (write-only), and may not read it back", async () => {
    const inv = await login(nidOf("inventoryManager"));
    const rec = await inv.collection("inventoryItems").create({
      hotel: hotelId(), name: "آزمون قیمت", sku: `UC-${Date.now()}`, category: "other", unit: "عدد", quantity: 0, reorderLevel: 1, unitCost: 12_345,
    });
    created.push(rec.id);
    expect("unitCost" in rec).toBe(false);
    expect((await su.collection("inventoryItems").getOne(rec.id)).unitCost).toBe(12_345);
    await inv.collection("inventoryItems").update(rec.id, { unitCost: 23_456 });
    expect((await su.collection("inventoryItems").getOne(rec.id)).unitCost).toBe(23_456);
    expect((await errorOf(inv.collection("inventoryItems").update(rec.id, { unitCost: -1 }))).status).toBe(400);
    // An update without the field keeps it.
    await inv.collection("inventoryItems").update(rec.id, { location: "قفسه ۲" });
    expect((await su.collection("inventoryItems").getOne(rec.id)).unitCost).toBe(23_456);
    const gm = await login(nidOf("generalManager"));
    expect((await gm.collection("inventoryItems").getOne(rec.id)).unitCost).toBe(23_456);
    // The audit log records that the unit cost changed, never its value.
    const logs = await su.collection("auditLogs").getFullList({ filter: `resourceId = "${rec.id}"`, sort: "created" });
    expect(logs.map((l) => l.changes.unitCost)).toEqual([{ changed: true }, { changed: true }, undefined]);
    expect(JSON.stringify(logs)).not.toMatch(/12345|23456/);
  });

  it("the nightly rollup keeps stock value out of dailyMetrics (dashboard roles read it)", async () => {
    const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    await su.send(`/api/zarin/admin/hotels/${hotelId()}/analytics`, { method: "POST", body: { rollup: { from: day, to: day } } });
    const m = await su.collection("dailyMetrics").getFirstListItem(`hotel = "${hotelId()}" && day = "${day}"`);
    expect(m.data.inventory).toBeTruthy();
    expect("lowStock" in m.data.inventory).toBe(true);
    expect("stockValue" in m.data.inventory).toBe(false);
    const ops = await login(nidOf("operationsManager"));
    expect(JSON.stringify(await ops.collection("dailyMetrics").getList(1, 50))).not.toMatch(/stockValue/);
  });
});
