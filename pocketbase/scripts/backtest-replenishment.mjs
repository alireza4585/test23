// F5 backtest (rolling origin) on the test-dataset pack, offline, with the
// same core.js the server runs (planItem, forecastUsage).
//
//   node scripts/backtest-replenishment.mjs --csv <pack dir|zip> --xlsx <workbook> \
//     [--item <sku>] [--days 180] [--out report.json]
//
// For every day D of the last --days days the nightly plan is computed as the
// server would compute it that night: stock at the start of D (rebuilt from
// the ledger), movements before D, no purchase orders (the dataset has none,
// so lead times are the item's or the 3-day default). Nothing is written.
//
// Acceptance criteria (docs/15, F5) and how they are measured here:
//   1. Supplier delay (shampoo, or --item): for every day the item ran out
//      (stock reached 0 in the ledger), how many days earlier the plan first
//      suggested a reorder. Target ≥ 3.
//   2. Daily-delivery items with enough par: items the plan classes as daily
//      whose stock never ran out; count the "will run out" warnings (reorder
//      suggestions) the new plan gives them — target 0 — next to the old
//      14-day linear rule's warnings on the same days.
//   3. Forecast quality: out-of-sample MAE of the daily-usage forecast against
//      the naive forecast (yesterday's usage), one day ahead and over the lead
//      time. Ratio < 1 means better than naive (a MASE scaled by naive).
//
// Observational: the ledger is what happened without these suggestions, so
// (1) measures warning time, not prevented stock-outs.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { readDataset } from "./dataset/load.mjs";

const require = createRequire(import.meta.url);
const core = require("../pb_hooks/lib/core.js");

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const num = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
const r2 = (v) => (v === null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const pick = (row, ...keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k]; return undefined; };

/**
 * The backtest on plain inputs (exported for checks on synthetic data).
 * items: [{id, name, unit, quantity (at the end), reorderLevel, reorderQuantity, unitCost, supplierName,
 *          leadTimeDays, shelfLifeDays, parLevel, deliveryPattern}]
 * movements: [{itemId, type, delta, day, at}] (at: sortable time within the day)
 */
export function backtest({ items, movements, lastDay, days = 180, focus = [] }) {
  const byItem = new Map(items.map((i) => [i.id, []]));
  for (const m of movements) byItem.get(m.itemId)?.push(m);
  for (const list of byItem.values()) list.sort((a, b) => (a.day + a.at < b.day + b.at ? -1 : 1));
  const firstDay = addDays(lastDay, -days + 1);

  const perItem = [];
  for (const item of items) {
    const ms = byItem.get(item.id);
    // Stock at the start of each day, rebuilt backwards from the final quantity.
    const deltaByDay = new Map();
    for (const m of ms) deltaByDay.set(m.day, (deltaByDay.get(m.day) ?? 0) + m.delta);
    const startOf = new Map();
    let level = item.quantity;
    for (let d = lastDay; d >= firstDay; d = addDays(d, -1)) {
      level -= deltaByDay.get(d) ?? 0;
      startOf.set(d, level);
    }
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
      const plan = core.planItem({ ...item, quantity: Math.max(0, startOf.get(d)) }, null, before, [], d);
      // The old rule: 14-day linear rate, warning at ≤ 5 days of stock.
      const issued14 = before.filter((m) => m.day >= addDays(d, -14) && (m.type === "issue" || m.type === "waste")).reduce((s, m) => s + Math.abs(m.delta), 0);
      const perDay = issued14 / 14;
      const oldWarn = perDay > 0 && Math.max(0, startOf.get(d)) / perDay <= 5;
      nights.push({ day: d, ok: plan.ok, pattern: plan.pattern, kind: plan.suggestion?.kind ?? null, quantity: plan.suggestion?.quantity ?? null,
        orderBy: plan.suggestion?.orderBy ?? null, onHand: r2(startOf.get(d)), par: plan.parLevel, rate: plan.forecast.rate, lead: plan.leadTime.days, oldWarn, actual: usage(d) });
    }
    // Forecast errors (out of sample): the night's rate vs the day's usage, and over the lead time.
    const e1 = [];
    const n1 = [];
    const eL = [];
    const nL = [];
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
    const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    const ratio = (e, n) => (mean(n) > 0 ? r2(mean(e) / mean(n)) : null);
    const episodes = [...stockout].sort().filter((d) => !stockout.has(addDays(d, -1)));
    const warnings = episodes.map((s) => {
      const window = nights.filter((n) => n.day < s && n.day >= addDays(s, -30));
      // The run of nights right before the stock-out that kept suggesting a reorder.
      let first = null;
      for (let i = window.length - 1; i >= 0 && window[i].kind === "reorder"; i--) first = window[i].day;
      const anyFirst = window.find((n) => n.kind === "reorder")?.day ?? null;
      let oldFirst = null;
      for (let i = window.length - 1; i >= 0 && window[i].oldWarn; i--) oldFirst = window[i].day;
      return { stockout: s, firstSuggestion: first, leadDays: first ? between(first, s) : null, firstInWindow: anyFirst, oldRuleLeadDays: oldFirst ? between(oldFirst, s) : null };
    });
    const daily = nights.filter((n) => n.pattern === "daily");
    perItem.push({
      id: item.id, name: item.name, focus: focus.includes(item.id), stockoutDays: stockout.size, episodes: warnings,
      dailyNights: daily.length, pattern: daily.length > nights.length / 2 ? "daily" : "scheduled",
      newReorderOnDaily: daily.filter((n) => n.kind === "reorder").length, parTopUps: daily.filter((n) => n.kind === "par").length,
      parTopUpsAboveOrAtPar: daily.filter((n) => n.kind === "par" && n.par !== null && n.onHand >= n.par).length,
      oldWarnOnDaily: daily.filter((n) => n.oldWarn).length,
      nightsOk: nights.filter((n) => n.ok).length, nights: nights.length,
      mae1: r2(mean(e1)), naive1: r2(mean(n1)), ratio1: ratio(e1, n1), maeL: r2(mean(eL)), naiveL: r2(mean(nL)), ratioL: ratio(eL, nL),
    });
  }

  // ------------------------------------------------------------ criteria
  const focusItems = perItem.filter((p) => p.focus);
  const focusEpisodes = focusItems.flatMap((p) => p.episodes.map((e) => ({ item: p.name, ...e })));
  const c1 = !focusItems.length
    ? { status: "insufficient data: no item matched (pass --item <sku>)" }
    : !focusEpisodes.length
      ? { status: "insufficient data: the item never runs out in the ledger", items: focusItems.map((p) => p.name) }
      : { status: focusEpisodes.every((e) => e.leadDays !== null && e.leadDays >= 3) ? "pass" : "fail", episodes: focusEpisodes };
  const dailyEnough = perItem.filter((p) => p.pattern === "daily" && p.stockoutDays === 0);
  const c2 = {
    status: !dailyEnough.length ? "insufficient data: no daily-delivery item without stock-outs" : dailyEnough.every((p) => p.newReorderOnDaily === 0) ? "pass" : "fail",
    items: dailyEnough.length,
    newWarnings: dailyEnough.reduce((s, p) => s + p.newReorderOnDaily, 0),
    oldRuleWarnings: dailyEnough.reduce((s, p) => s + p.oldWarnOnDaily, 0),
    parTopUps: dailyEnough.reduce((s, p) => s + p.parTopUps, 0),
    parTopUpsAtOrAbovePar: dailyEnough.reduce((s, p) => s + p.parTopUpsAboveOrAtPar, 0),
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
  return { firstDay, lastDay, items: perItem.length, criteria: { supplierDelay: c1, dailyPar: c2, forecast: c3 }, perItem };
}

// -------------------------------------------------------------------- CLI
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? acc.concat([[a.slice(2), all[i + 1]]]) : acc), []));
  if (!args.csv || !args.xlsx) {
    console.error("usage: node scripts/backtest-replenishment.mjs --csv <pack> --xlsx <workbook> [--item sku] [--days 180] [--out file]");
    process.exit(2);
  }
  const data = readDataset({ csv: args.csv, xlsx: args.xlsx });
  const items = data.items.map((it) => ({
    id: it.sku, name: it.name, unit: it.unit, quantity: Number(it.quantity), reorderLevel: Number(it.reorderLevel), reorderQuantity: Number(it.reorderQuantity || 0),
    unitCost: num(it.unitCost), supplierId: null, supplierName: it.supplier || null,
    leadTimeDays: num(pick(it, "leadTimeDays", "lead_time_days")), shelfLifeDays: num(pick(it, "shelfLifeDays", "shelf_life_days")),
    parLevel: num(pick(it, "parLevel", "par_level")), deliveryPattern: pick(it, "deliveryPattern", "delivery_pattern") || null,
  }));
  const movements = data.movements.map((m) => ({ itemId: m.item_id, type: m.type, delta: Number(m.delta), day: String(m.created).slice(0, 10), at: String(m.created).slice(11) + m.movement_id }));
  const lastDay = movements.reduce((d, m) => (m.day > d ? m.day : d), "");
  const focus = args.item ? [args.item] : items.filter((i) => /shampoo|شامپو/i.test(i.name)).map((i) => i.id);
  const res = backtest({ items, movements, lastDay, days: Number(args.days || 180), focus });
  const scenarios = data.scenarios.filter((s) => /shampoo|شامپو|supplier|تأمین/i.test(JSON.stringify(s)));
  const c = res.criteria;
  console.log(`F5 backtest ${res.firstDay} … ${res.lastDay}, ${res.items} items; focus: ${focus.join(", ") || "—"}`);
  if (scenarios.length) console.log(`Test_Scenarios mentioning the supplier / shampoo: ${scenarios.length}`);
  console.log(`1. supplier delay: ${c.supplierDelay.status}`);
  for (const e of c.supplierDelay.episodes ?? []) console.log(`   ${e.item}: ran out ${e.stockout}; reorder suggested from ${e.firstSuggestion ?? "—"} (${e.leadDays ?? "—"} days before; old rule ${e.oldRuleLeadDays ?? "—"})`);
  console.log(`2. daily delivery, enough par: ${c.dailyPar.status} — ${c.dailyPar.items} items, new warnings ${c.dailyPar.newWarnings}, old rule ${c.dailyPar.oldRuleWarnings}, par top-ups ${c.dailyPar.parTopUps} (${c.dailyPar.parTopUpsAtOrAbovePar} at or above par)`);
  console.log(`3. forecast vs naive: ${c.forecast.status} — ${c.forecast.items} items; 1 day: median ${c.forecast.medianRatio1}, pooled ${c.forecast.pooledRatio1}, better on ${c.forecast.shareBetter1}; lead time: median ${c.forecast.medianRatioLead}, pooled ${c.forecast.pooledRatioLead}, better on ${c.forecast.shareBetterLead}`);
  if (args.out) writeFileSync(args.out, JSON.stringify({ ...res, scenarios }, null, 2));
  void readFileSync;
}
