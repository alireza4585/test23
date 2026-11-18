/// <reference path="../pb_data/types.d.ts" />
/**
 * Unit costs and stock value only with finance.view (AI phase 2, deployed
 * with the new APK in stage 3). Purchase-order prices are already apart
 * (purchaseOrderCosts); without this, quantity × unit cost would give them away.
 *
 * - inventoryItems.unitCost becomes a hidden field: no non-superuser can read,
 *   filter or sort by it. pb_hooks (onRecordEnrich) shows it again to callers
 *   with finance.view in the item's hotel, the dailyFinance condition; callers
 *   with inventory.manage may still write it (write-only, like finance.record).
 * - dailyMetrics.data.inventory.stockValue (readable with the dashboards) is
 *   moved into a hidden field and no longer written by the nightly rollup.
 *
 * Down restores both exactly.
 */
migrate((app) => {
  const items = app.findCollectionByNameOrId("inventoryItems");
  items.fields.getByName("unitCost").hidden = true;
  app.save(items);

  const metrics = app.findCollectionByNameOrId("dailyMetrics");
  metrics.fields.add(new JSONField({ name: "stockValueStash", hidden: true, maxSize: 2000 }));
  app.save(metrics);
  const db = app.db();
  for (const r of app.findAllRecords("dailyMetrics")) {
    let data = null;
    try { data = JSON.parse(String(r.get("data") || "null")); } catch (_) { data = null; }
    if (!data || !data.inventory || !("stockValue" in data.inventory)) continue;
    const stash = { stockValue: data.inventory.stockValue };
    delete data.inventory.stockValue;
    db.newQuery("UPDATE dailyMetrics SET data = {:d}, stockValueStash = {:s} WHERE id = {:id}")
      .bind({ d: JSON.stringify(data), s: JSON.stringify(stash), id: r.id }).execute();
  }
}, (app) => {
  const db = app.db();
  for (const r of app.findAllRecords("dailyMetrics")) {
    let stash = null;
    try { stash = JSON.parse(String(r.get("stockValueStash") || "null")); } catch (_) { stash = null; }
    if (!stash || !("stockValue" in stash)) continue;
    let data = {};
    try { data = JSON.parse(String(r.get("data") || "null")) || {}; } catch (_) { data = {}; }
    data.inventory = Object.assign({}, data.inventory || {}, { stockValue: stash.stockValue });
    db.newQuery("UPDATE dailyMetrics SET data = {:d} WHERE id = {:id}").bind({ d: JSON.stringify(data), id: r.id }).execute();
  }
  const metrics = app.findCollectionByNameOrId("dailyMetrics");
  metrics.fields.removeByName("stockValueStash");
  app.save(metrics);

  const items = app.findCollectionByNameOrId("inventoryItems");
  items.fields.getByName("unitCost").hidden = false;
  app.save(items);
});
