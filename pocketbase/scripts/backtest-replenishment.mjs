// F5 backtest (rolling origin) on the test-dataset pack, offline, with the
// same core.js the server runs (planItem).
//
//   node scripts/backtest-replenishment.mjs --csv <pack dir|zip> --xlsx <workbook> \
//     [--item <sku>[,<sku>…]] [--days N] \
//     [--daily <sku>[,<sku>…]] [--daily-match "<regex on item names>"] \
//     [--shelf-life "<regex>=<days>;<regex>=<days>"] [--out report.json]
//
// For every night D (the whole ledger, or its last --days days) the plan is
// computed as the server would compute it that night: stock at the start of D
// (rebuilt from the ledger), movements before D, no purchase orders (the
// dataset has none, so lead times are the item's or the 3-day default).
// Nothing is written anywhere except the optional --out file.
//
//   --daily / --daily-match   force deliveryPattern = daily (the par path) for
//                             these items, as the hotel would set it for its
//                             fresh items; criterion 2 is reported for them
//   --shelf-life              shelf life in days by item-name pattern (the
//                             dataset may not have it; the values are yours)
//
// Acceptance criteria (docs/15, F5) and noise, as measured here:
//   1. Stock-out warning: for every item that runs out (stock reaches 0 in the
//      ledger), the reorder suggestion of the nights just before. Unmeasurable
//      when fewer than 3 nights had a plan before the stock-out (the first
//      MIN_HISTORY_DAYS of an item's ledger have none). Target ≥ 3 days.
//   2. Daily-delivery items: no "will run out" (reorder) warning on items on
//      the par path; the old 14-day linear rule on the same nights for contrast.
//   3. Forecast quality: out-of-sample MAE of the usage forecast against naive
//      (yesterday's usage), one day ahead and over the lead time (< 1: better).
//   Noise: suggestion runs (consecutive nights with a reorder suggestion) and
//      what followed within lead time + REVIEW_DAYS: a stock-out (needed), a
//      receipt in the ledger (the hotel reordered too) or neither (premature);
//      draft purchase orders per supplier per week, with the server's life
//      cycle (a new draft when a supplier goes from no lines to lines; the
//      draft is refreshed while lines remain); shelf life: the stock right after
//      a delivery (left on arrival + the order) against the shelf life.
//
// Observational: the ledger is what happened without these suggestions, so
// warning times are not prevented stock-outs, and a suggestion that nobody
// acts on stays on until the ledger's own delivery arrives.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { readDataset } from "./dataset/load.mjs";

const require = createRequire(import.meta.url);
const core = require("../pb_hooks/lib/core.js");
const MIN_HISTORY_DAYS = 14; // replenishment.ts
const REVIEW_DAYS = 7; // replenishment.ts
const MIN_WARNING_DAYS = 3; // the acceptance criterion

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const num = (v) => (v === "" || v === undefined || v === null || !isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pick = (row, ...keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k]; return undefined; };

/**
 * The backtest on plain inputs (exported for checks on synthetic data).
 * items: [{id, name, unit, quantity (at the end), reorderLevel, reorderQuantity, unitCost, supplierName,
 *          leadTimeDays, shelfLifeDays, parLevel, deliveryPattern}]
 * movements: [{itemId, type, delta, day, at}] (at: sortable time within the day)
 */
export function backtest({ items, movements, lastDay, firstDay, only = [] }) {
  const byItem = new Map(items.map((i) => [i.id, []]));
  for (const m of movements) byItem.get(m.itemId)?.push(m);
  for (const list of byItem.values()) list.sort((a, b) => (a.day + a.at < b.day + b.at ? -1 : 1));

  const perItem = [];
  const nightsBySupplier = new Map(); // supplier → Map(day → lines)
  const receiptsBySupplier = new Map(); // supplier → Set(day): the hotel's actual deliveries
  for (const item of items) {
    if (only.length && !only.includes(item.id)) continue;
    const ms = byItem.get(item.id);
    const itemStart = ms.length ? ms[0].day : null;
    // Stock at the start of each day, rebuilt backwards from the final quantity.
    const deltaByDay = new Map();
    for (const m of ms) deltaByDay.set(m.day, (deltaByDay.get(m.day) ?? 0) + m.delta);
    const startOf = new Map();
    let level = item.quantity;
    for (let d = lastDay; d >= firstDay; d = addDays(d, -1)) {
      level -= deltaByDay.get(d) ?? 0;
      startOf.set(d, level);
    }
    const receiptDays = new Set(ms.filter((m) => m.type === "receive" && m.delta > 0).map((m) => m.day));
    const supplierKey = item.supplierName || "(no supplier)";
    if (!receiptsBySupplier.has(supplierKey)) receiptsBySupplier.set(supplierKey, new Set());
    for (const d of receiptDays) if (d >= firstDay && d <= lastDay) receiptsBySupplier.get(supplierKey).add(d);
    // Stock-out: the level reaches 0 at some point of the day.
    const stockout = new Set();
    for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
      let l = startOf.get(d);
      if (l <= 0) stockout.add(d);
      for (const m of ms.filter((x) => x.day === d)) {
        l += m.delta;
        if (l <= 0 && m.delta < 0) stockout.add(d);
      }
    }
    const usage = (d) => ms.filter((m) => m.day === d && (m.type === "issue" || m.type === "waste")).reduce((s, m) => s + Math.abs(m.delta), 0);
    const nights = [];
    for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
      const before = ms.filter((m) => m.day < d);
      const onHand = Math.max(0, startOf.get(d));
      const plan = core.planItem({ ...item, quantity: onHand }, null, before, [], d);
      // The old rule: 14-day linear rate, warning at ≤ 5 days of stock.
      const issued14 = before.filter((m) => m.day >= addDays(d, -14) && (m.type === "issue" || m.type === "waste")).reduce((s, m) => s + Math.abs(m.delta), 0);
      const perDay = issued14 / 14;
      const s = plan.suggestion;
      nights.push({
        day: d, ok: plan.ok, pattern: plan.pattern, kind: s?.kind ?? null, quantity: s?.quantity ?? null, onHand: r2(onHand),
        par: plan.parLevel, rate: plan.forecast.rate, safety: plan.safetyStock, lead: plan.leadTime.days,
        oldWarn: perDay > 0 && onHand / perDay <= 5, actual: usage(d),
      });
      if (s) {
        const key = item.supplierName || "(no supplier)";
        if (!nightsBySupplier.has(key)) nightsBySupplier.set(key, new Map());
        const m = nightsBySupplier.get(key);
        m.set(d, (m.get(d) ?? 0) + 1);
      }
    }

    // 1. Stock-out episodes and the warning before each.
    const episodes = [...stockout].sort().filter((d) => !stockout.has(addDays(d, -1))).map((s) => {
      const prior = nights.filter((n) => n.day < s);
      const planned = prior.filter((n) => n.ok).length;
      let first = null;
      for (let i = prior.length - 1; i >= 0 && prior[i].kind === "reorder"; i--) first = prior[i];
      let oldFirst = null;
      for (let i = prior.length - 1; i >= 0 && prior[i].oldWarn; i--) oldFirst = prior[i].day;
      const measurable = planned >= MIN_WARNING_DAYS;
      return {
        stockout: s, measurable, reason: measurable ? null : `only ${planned} night(s) with a plan before it (ledger of this item starts ${itemStart}; plans need ${MIN_HISTORY_DAYS} days of history)`,
        firstSuggestion: first?.day ?? null, leadDays: first ? between(first.day, s) : 0,
        pass: measurable ? !!first && between(first.day, s) >= MIN_WARNING_DAYS : null,
        // Why early: the plan's lead time and safety stock (in days of usage) on the first night.
        leadTimeDays: first?.lead ?? null, safetyDays: first && first.rate > 0 ? r2(first.safety / first.rate) : null,
        oldRuleLeadDays: oldFirst ? between(oldFirst, s) : 0,
      };
    });

    // Noise: suggestion runs and what followed within lead time + review.
    const runs = [];
    for (let i = 0; i < nights.length; i++) {
      if (nights[i].kind !== "reorder" || (i > 0 && nights[i - 1].kind === "reorder")) continue;
      let j = i;
      while (j + 1 < nights.length && nights[j + 1].kind === "reorder") j++;
      const start = nights[i].day;
      const horizon = addDays(start, nights[i].lead + REVIEW_DAYS);
      let outcome = "premature";
      for (let d = start; d <= horizon && d <= lastDay; d = addDays(d, 1)) {
        if (stockout.has(d)) { outcome = "stockout"; break; }
        if (receiptDays.has(d) && outcome === "premature") outcome = "receipt";
      }
      if (horizon > lastDay && outcome === "premature") outcome = "open"; // the horizon runs past the ledger
      runs.push({ start, nights: j - i + 1, outcome });
    }

    // Shelf life of suggested quantities (when known).
    const shelf = item.shelfLifeDays;
    const sug = nights.filter((n) => n.kind && n.rate > 0);
    // Stock right after the delivery: what is left on arrival (lead time later) plus the order.
    const atDelivery = (n) => (n.kind === "par" ? n.onHand : Math.max(0, n.onHand - n.rate * n.lead)) + n.quantity;
    const shelfChecks = shelf ? {
      shelfLifeDays: shelf, suggestions: sug.length,
      // the order alone (rounding up one unit allowed)
      quantityOverShelfLife: sug.filter((n) => n.quantity > Math.ceil(n.rate * shelf)).length,
      // the stock after the delivery (one unit of rounding allowed)
      stockAtDeliveryOverShelfLife: sug.filter((n) => atDelivery(n) > n.rate * shelf + 1).length,
      medianCoverDaysAtDelivery: r2(median(sug.map((n) => atDelivery(n) / n.rate))),
    } : null;

    // 3. Forecast errors (out of sample).
    const e1 = []; const n1 = []; const eL = []; const nL = [];
    for (const [i, n] of nights.entries()) {
      if (!n.ok || i === 0) continue;
      e1.push(Math.abs(n.actual - n.rate));
      n1.push(Math.abs(n.actual - nights[i - 1].actual));
      const L = n.lead;
      if (i + L <= nights.length && i - L >= 0) {
        const act = nights.slice(i, i + L).reduce((s, x) => s + x.actual, 0);
        const naive = nights.slice(i - L, i).reduce((s, x) => s + x.actual, 0);
        eL.push(Math.abs(act - n.rate * L));
        nL.push(Math.abs(act - naive));
      }
    }
    const ratio = (e, n) => (mean(n) > 0 ? r2(mean(e) / mean(n)) : null);
    const daily = nights.filter((n) => n.pattern === "daily");
    perItem.push({
      id: item.id, name: item.name, supplier: item.supplierName || null, forcedDaily: item.deliveryPattern === "daily",
      pattern: daily.length > nights.length / 2 ? "daily" : "scheduled", ledgerStart: itemStart,
      stockoutDays: stockout.size, episodes, runs, shelf: shelfChecks,
      reorderNights: nights.filter((n) => n.kind === "reorder").length,
      dailyNights: daily.length, newReorderOnDaily: daily.filter((n) => n.kind === "reorder").length,
      parTopUps: daily.filter((n) => n.kind === "par").length, oldWarnOnDaily: daily.filter((n) => n.oldWarn).length,
      nightsOk: nights.filter((n) => n.ok).length, nights: nights.length,
      mae1: r2(mean(e1)), naive1: r2(mean(n1)), ratio1: ratio(e1, n1), maeL: r2(mean(eL)), naiveL: r2(mean(nL)), ratioL: ratio(eL, nL),
    });
  }

  // ------------------------------------------------------------ criteria
  const weeks = (between(firstDay, lastDay) + 1) / 7;
  const all = perItem.flatMap((p) => p.episodes.map((e) => ({ item: p.name, sku: p.id, ...e })));
  const measured = all.filter((e) => e.measurable);
  const c1 = {
    status: !all.length ? "insufficient data: no item runs out in the ledger" : !measured.length ? "insufficient data: no measurable stock-out" : measured.every((e) => e.pass) ? "pass" : "fail",
    itemsRunningOut: perItem.filter((p) => p.episodes.length).length, episodes: all.length, measurable: measured.length,
    passed: measured.filter((e) => e.pass).length, oldRulePassed: measured.filter((e) => e.oldRuleLeadDays >= MIN_WARNING_DAYS).length,
    medianLead: median(measured.filter((e) => e.pass).map((e) => e.leadDays)),
    leadBands: { "3–7": measured.filter((e) => e.leadDays >= 3 && e.leadDays <= 7).length, "8–14": measured.filter((e) => e.leadDays >= 8 && e.leadDays <= 14).length, ">14": measured.filter((e) => e.leadDays > 14).length },
    unmeasurable: all.filter((e) => !e.measurable).map((e) => ({ item: e.item, stockout: e.stockout, reason: e.reason })),
    failed: measured.filter((e) => !e.pass),
    episodesDetail: all,
  };
  const dailyItems = perItem.filter((p) => p.pattern === "daily");
  const dailyEnough = dailyItems.filter((p) => p.stockoutDays === 0);
  const c2 = {
    status: !dailyItems.length ? "not measurable: no item on the par path (set deliveryPattern, or --daily / --daily-match)" : dailyItems.every((p) => p.newReorderOnDaily === 0) ? "pass" : "fail",
    dailyItems: dailyItems.length, forced: dailyItems.filter((p) => p.forcedDaily).length, withoutStockouts: dailyEnough.length,
    newWarnings: dailyItems.reduce((s, p) => s + p.newReorderOnDaily, 0),
    oldRuleWarnings: dailyItems.reduce((s, p) => s + p.oldWarnOnDaily, 0),
    parTopUpNights: dailyItems.reduce((s, p) => s + p.parTopUps, 0),
    stillRanOut: dailyItems.filter((p) => p.stockoutDays > 0).map((p) => ({ item: p.name, days: p.stockoutDays })),
  };
  const rated = perItem.filter((p) => p.ratio1 !== null);
  const ratedL = perItem.filter((p) => p.ratioL !== null);
  const pooled = (k, n) => { const a = perItem.filter((p) => p[k] !== null && p[n] > 0); const e = a.reduce((s, p) => s + p[k], 0); const m = a.reduce((s, p) => s + p[n], 0); return m > 0 ? r2(e / m) : null; };
  const c3 = {
    status: !rated.length ? "insufficient data: no item with usage" : median(rated.map((p) => p.ratio1)) < 1 ? "pass" : "fail",
    items: rated.length,
    medianRatio1: r2(median(rated.map((p) => p.ratio1))), shareBetter1: r2(rated.filter((p) => p.ratio1 < 1).length / rated.length),
    medianRatioLead: r2(median(ratedL.map((p) => p.ratioL))), shareBetterLead: ratedL.length ? r2(ratedL.filter((p) => p.ratioL < 1).length / ratedL.length) : null,
    pooledRatio1: pooled("mae1", "naive1"), pooledRatioLead: pooled("maeL", "naiveL"),
  };

  // Noise: runs, never-out items, drafts per supplier per week.
  const runs = perItem.flatMap((p) => p.runs.map((r) => ({ item: p.name, ...r })));
  const count = (o) => runs.filter((r) => r.outcome === o).length;
  const neverOut = perItem.filter((p) => p.stockoutDays === 0);
  const suppliers = [...nightsBySupplier.entries()].map(([supplier, days]) => {
    let drafts = 0;
    let maxLines = 0;
    for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
      const n = days.get(d) ?? 0;
      if (n > 0 && !(days.get(addDays(d, -1)) > 0)) drafts++;
      maxLines = Math.max(maxLines, n);
    }
    const deliveries = receiptsBySupplier.get(supplier)?.size ?? 0;
    return { supplier, drafts, perWeek: r2(drafts / weeks), deliveriesPerWeek: r2(deliveries / weeks), nightsWithDraft: days.size, shareOfNights: r2(days.size / (weeks * 7)), maxLines };
  }).sort((a, b) => b.drafts - a.drafts);
  const draftsTotal = suppliers.reduce((s, x) => s + x.drafts, 0);
  const openPerNight = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) openPerNight.push([...nightsBySupplier.values()].filter((m) => m.get(d) > 0).length);
  const shelfItems = perItem.filter((p) => p.shelf);
  const noise = {
    suggestionRuns: runs.length,
    runOutcomes: { stockout: count("stockout"), receipt: count("receipt"), premature: count("premature"), open: count("open") },
    itemsNeverOut: neverOut.length,
    itemsNeverOutWithReorderSuggestions: neverOut.filter((p) => p.reorderNights > 0).length,
    reorderNightsOnNeverOutItems: neverOut.reduce((s, p) => s + p.reorderNights, 0),
    draftsPerWeek: r2(draftsTotal / weeks), draftsTotal, suppliersWithDrafts: suppliers.length,
    // For comparison: how often the hotel actually took deliveries from the same suppliers.
    actualDeliveriesPerWeek: r2(suppliers.reduce((s, x) => s + (receiptsBySupplier.get(x.supplier)?.size ?? 0), 0) / weeks),
    openDraftsPerNight: { median: median(openPerNight), max: Math.max(0, ...openPerNight) },
    perSupplier: suppliers,
    shelfLife: !shelfItems.length ? "unmeasurable: no shelf life (dataset column shelfLifeDays, or --shelf-life)" : {
      items: shelfItems.length,
      suggestions: shelfItems.reduce((s, p) => s + p.shelf.suggestions, 0),
      quantityOverShelfLife: shelfItems.reduce((s, p) => s + p.shelf.quantityOverShelfLife, 0),
      stockAtDeliveryOverShelfLife: shelfItems.reduce((s, p) => s + p.shelf.stockAtDeliveryOverShelfLife, 0),
      perItem: shelfItems.map((p) => ({ item: p.name, ...p.shelf })),
    },
  };
  return { firstDay, lastDay, weeks: r2(weeks), items: perItem.length, criteria: { stockoutWarning: c1, dailyPar: c2, forecast: c3 }, noise, perItem };
}

// -------------------------------------------------------------------- CLI
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? acc.concat([[a.slice(2), all[i + 1]]]) : acc), []));
  if (!args.csv || !args.xlsx) {
    console.error("usage: node scripts/backtest-replenishment.mjs --csv <pack> --xlsx <workbook> [--item sku,…] [--days N] [--daily sku,…] [--daily-match regex] [--shelf-life \"regex=days;…\"] [--out file]");
    process.exit(2);
  }
  const data = readDataset({ csv: args.csv, xlsx: args.xlsx });
  const dailySkus = new Set(String(args.daily || "").split(",").map((s) => s.trim()).filter(Boolean));
  const dailyMatch = args["daily-match"] ? new RegExp(args["daily-match"], "i") : null;
  const shelfRules = String(args["shelf-life"] || "").split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.lastIndexOf("=");
    return [new RegExp(s.slice(0, i), "i"), Number(s.slice(i + 1))];
  });
  const items = data.items.map((it) => {
    const daily = dailySkus.has(it.sku) || (dailyMatch && dailyMatch.test(it.name));
    const shelfRule = shelfRules.find(([re]) => re.test(it.name));
    return {
      id: it.sku, name: it.name, unit: it.unit, quantity: Number(it.quantity), reorderLevel: Number(it.reorderLevel), reorderQuantity: Number(it.reorderQuantity || 0),
      unitCost: num(it.unitCost), supplierId: null, supplierName: it.supplier || null,
      leadTimeDays: num(pick(it, "leadTimeDays", "lead_time_days")),
      shelfLifeDays: num(pick(it, "shelfLifeDays", "shelf_life_days")) ?? (shelfRule ? shelfRule[1] : null),
      parLevel: num(pick(it, "parLevel", "par_level")),
      deliveryPattern: daily ? "daily" : (pick(it, "deliveryPattern", "delivery_pattern") || null),
    };
  });
  const movements = data.movements.map((m) => ({ itemId: m.item_id, type: m.type, delta: Number(m.delta), day: String(m.created).slice(0, 10), at: String(m.created).slice(11) + m.movement_id }));
  const lastDay = movements.reduce((d, m) => (m.day > d ? m.day : d), "");
  const ledgerStart = movements.reduce((d, m) => (!d || m.day < d ? m.day : d), "");
  const firstDay = args.days ? [addDays(lastDay, -Number(args.days) + 1), ledgerStart].sort().pop() : ledgerStart;
  const only = args.item ? String(args.item).split(",").map((s) => s.trim()) : [];
  const res = backtest({ items, movements, lastDay, firstDay, only });
  const { stockoutWarning: c1, dailyPar: c2, forecast: c3 } = res.criteria;
  const n = res.noise;
  const forced = items.filter((i) => i.deliveryPattern === "daily").map((i) => i.name);
  console.log(`F5 backtest ${res.firstDay} … ${res.lastDay} (${res.weeks} weeks), ${res.items} items${forced.length ? `; par path forced for ${forced.length}: ${forced.join(", ")}` : ""}`);
  console.log(`1. stock-out warning ≥ ${MIN_WARNING_DAYS} days: ${c1.status} — ${c1.itemsRunningOut} items run out, ${c1.episodes} episodes, ${c1.measurable} measurable: ${c1.passed}/${c1.measurable} warned in time (old rule ${c1.oldRulePassed}/${c1.measurable}); median lead ${c1.medianLead} days; lead 3–7: ${c1.leadBands["3–7"]}, 8–14: ${c1.leadBands["8–14"]}, >14: ${c1.leadBands[">14"]}; unmeasurable ${c1.unmeasurable.length}`);
  for (const e of c1.failed) console.log(`   ✗ ${e.item}: ran out ${e.stockout}, warned ${e.leadDays} day(s) before`);
  for (const e of c1.unmeasurable) console.log(`   · unmeasurable ${e.item} ${e.stockout}: ${e.reason}`);
  console.log(`2. daily delivery: ${c2.status} — ${c2.dailyItems} items on the par path (${c2.forced} forced), new warnings ${c2.newWarnings}, old rule ${c2.oldRuleWarnings}, par top-up nights ${c2.parTopUpNights}; still ran out: ${c2.stillRanOut.map((x) => `${x.item} (${x.days} d)`).join(", ") || "none"}`);
  console.log(`3. forecast vs naive: ${c3.status} — ${c3.items} items; 1 day: median ${c3.medianRatio1}, pooled ${c3.pooledRatio1}, better on ${c3.shareBetter1}; lead time: median ${c3.medianRatioLead}, pooled ${c3.pooledRatioLead}, better on ${c3.shareBetterLead}`);
  console.log(`noise: ${n.suggestionRuns} suggestion runs → stock-out ${n.runOutcomes.stockout}, receipt ${n.runOutcomes.receipt}, premature ${n.runOutcomes.premature}, open ${n.runOutcomes.open}; items never out with reorder suggestions ${n.itemsNeverOutWithReorderSuggestions}/${n.itemsNeverOut} (${n.reorderNightsOnNeverOutItems} nights)`);
  console.log(`      draft orders: ${n.draftsTotal} (${n.draftsPerWeek}/week; the same suppliers actually delivered ${n.actualDeliveriesPerWeek} times/week) from ${n.suppliersWithDrafts} suppliers; open drafts per night: median ${n.openDraftsPerNight.median}, max ${n.openDraftsPerNight.max}`);
  for (const s of n.perSupplier.slice(0, 12)) console.log(`      ${s.supplier}: ${s.drafts} drafts (${s.perWeek}/week vs ${s.deliveriesPerWeek} deliveries/week), open on ${Math.round(s.shareOfNights * 100)}% of nights, up to ${s.maxLines} lines`);
  if (typeof n.shelfLife === "string") console.log(`      shelf life: ${n.shelfLife}`);
  else console.log(`      shelf life: ${n.shelfLife.items} items, ${n.shelfLife.suggestions} suggestions; quantity over shelf life ${n.shelfLife.quantityOverShelfLife}; stock at delivery over shelf life ${n.shelfLife.stockAtDeliveryOverShelfLife}`);
  if (args.out) writeFileSync(args.out, JSON.stringify(res, null, 2));
}
