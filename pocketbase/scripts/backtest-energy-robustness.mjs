// F2 robustness backtest: the rolling-origin run of backtest-energy.mjs
// repeated on perturbed copies of the test dataset, because the dataset's
// energy was generated from its own temperature almost without noise (monthly
// CV(RMSE) 0.7–2 %) and real meters are not that clean.
//
//   node scripts/backtest-energy-robustness.mjs --csv <pack dir|zip> --xlsx <workbook> \
//     [--seeds 5] [--out report.json]
//
// Scenarios (each with --seeds random seeds; worst case and mean reported):
//   clean        the dataset as it is
//   noise5/10    every reading × (1 + ε), ε ~ N(0, 5 % / 10 %)
//   missing5     5 % of the days have no reading
//   outliers     one manual-entry error a month per meter: ×3 or 0, alternately
//   combined     noise10 + missing5 + outliers
// Per scenario and meter: injected 20 % faults (detection delay), false alarms
// per month on healthy days (all, and the ones that would leave the app —
// low-confidence alarms stay inside it), CV(RMSE), and whether every entry
// error was labelled a data error rather than a fault.
//
// The server's behaviour is mirrored: model refit every REFIT_DAYS days on the
// 365 days before, CUSUM carried over gaps of up to CUSUM_GAP_DAYS days, and
// one alert per meter per episode (no new alert within ALERT_EPISODE_DAYS days
// of the last one). "False alarms" are alerts on healthy days.
// Everything happens in memory; nothing is written except the --out file.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { readDataset } from "./dataset/load.mjs";
import { openWorkbook } from "./lib/xlsx.mjs";

const require = createRequire(import.meta.url);
const core = require("../pb_hooks/lib/core.js");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? acc.concat([[a.slice(2), all[i + 1]]]) : acc), []));
if (!args.csv || !args.xlsx) {
  console.error("usage: node scripts/backtest-energy-robustness.mjs --csv <pack> --xlsx <workbook> [--seeds 5] [--out file]");
  process.exit(2);
}
const SEEDS = Math.max(1, Number(args.seeds) || 5);
const TRAIN_DAYS = 365;
const CUSUM_GAP_DAYS = 7;
const MAX_FALSE_PER_MONTH = 2;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const excelDay = (v) => (typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10) : String(v).slice(0, 10));

// ------------------------------------------------------------------ data
const data = readDataset({ csv: args.csv, xlsx: args.xlsx });
const wb = openWorkbook(readFileSync(args.xlsx));
const threshold = (data.hotel.settings || {}).energyAlertThresholdPct ?? 15;
const occ = Object.fromEntries(data.operations.map((o) => [o.day, Number(o.roomsOccupied)]));
const temp = Object.fromEntries(wb.records("Weather").map((w) => [excelDay(w.date), Number(w.temp_mean_c)]));
const events = wb.records("Events").map((e) => ({ start: addDays(excelDay(e.start_date), -1), end: addDays(excelDay(e.end_date), 1) }));
const healthyDay = (d) => !events.some((w) => d >= w.start && d <= w.end);

function series(type) {
  const by = {};
  for (const r of data.energy) if (r.type === type) by[r.day] = (by[r.day] || 0) + Number(r.consumption);
  return Object.keys(by).sort().filter((d) => occ[d] !== undefined).map((d) => ({ day: d, consumption: by[d], occupied: occ[d], tMean: temp[d] ?? null }));
}

const FAULTS = [
  { id: "electricity-winter-20", type: "electricity", start: "2026-02-01" },
  { id: "electricity-spring-20", type: "electricity", start: "2026-04-20" },
  { id: "electricity-summer-20", type: "electricity", start: "2026-06-15" },
  { id: "electricity-autumn-20", type: "electricity", start: "2026-09-01" },
  { id: "gas-winter-20", type: "gas", start: "2026-02-01" },
  { id: "water-autumn-20", type: "water", start: "2026-09-01" },
].map((f) => ({ ...f, days: 14, pct: 20, end: addDays(f.start, 13) }));

// ------------------------------------------------------------ perturbation
function rng(seed) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { uni, normal: () => Math.sqrt(-2 * Math.log(uni() + 1e-12)) * Math.cos(2 * Math.PI * uni()) };
}

const SCENARIOS = {
  clean: {},
  noise5: { noise: 0.05 },
  noise10: { noise: 0.1 },
  missing5: { missing: 0.05 },
  outliers: { outliers: true },
  combined: { noise: 0.1, missing: 0.05, outliers: true },
};

/**
 * A perturbed copy of [rows] and the days that carry an entry error. The same
 * seed gives the same noise, gaps and errors whether or not a fault is
 * injected, so a fault run differs from its base run only by the fault.
 */
function perturb(rows, spec, seed, fault) {
  const r = rng(seed);
  const errors = {};
  let out = rows.map((d) => {
    const eps = spec.noise ? spec.noise * r.normal() : 0;
    const drop = spec.missing ? r.uni() < spec.missing : false;
    let c = d.consumption * Math.max(0.05, 1 + eps);
    if (fault && d.day >= fault.start && d.day <= fault.end) c *= 1 + fault.pct / 100;
    return drop ? null : { ...d, consumption: c };
  }).filter(Boolean);
  if (spec.outliers) {
    // One entry error per 30 days at a random offset: ×3 and 0 alternately.
    for (let i = 0, k = 0; i < out.length; i += 30, k++) {
      const j = Math.min(out.length - 1, i + Math.floor(r.uni() * 30));
      out[j] = { ...out[j], consumption: k % 2 ? 0 : out[j].consumption * 3 };
      errors[out[j].day] = k % 2 ? "zero" : "x3";
    }
  }
  out = out.slice();
  return { rows: out, errors };
}

// ------------------------------------------------------------ simulation
function simulate(rows) {
  const alarms = [];
  const labels = {};
  const refits = [];
  let flagged = 0;
  const scoredDays = {};
  let model = null;
  let fittedOn = null;
  let cusum = 0;
  let lastScored = null;
  let lastAlert = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (between(rows[0].day, row.day) < core.MIN_MODEL_DAYS) continue;
    const day = row.day;
    if (!fittedOn || between(fittedOn, day) >= core.REFIT_DAYS) {
      const res = core.fitEnergyModel(rows.filter((r) => r.day >= addDays(day, -TRAIN_DAYS) && r.day < day));
      model = res.ok ? res.model : null;
      if (model) refits.push({ day, valid: model.valid, cvrmseMonthly: model.stats.cvrmseMonthly, cvrmseDaily: model.stats.cvrmseDaily, dataErrors: model.stats.dataErrors });
      fittedOn = day;
    }
    if (!model || !model.valid) {
      cusum = 0;
      continue;
    }
    if (lastScored && between(lastScored, day) > CUSUM_GAP_DAYS) cusum = 0;
    const s = core.scoreDay(model, row, cusum, threshold);
    if (!s) continue;
    cusum = s.cusum;
    lastScored = day;
    scoredDays[day] = s.expected > 0 ? row.consumption / s.expected : null;
    if (s.dataError) labels[day] = s.dataError;
    if (!(s.spike || s.drift)) continue;
    flagged++;
    if (lastAlert && between(lastAlert, day) <= core.ALERT_EPISODE_DAYS) continue;
    lastAlert = day;
    alarms.push({ day, kind: s.drift ? "drift" : "spike", lowConfidence: s.lowConfidence });
  }
  return { alarms, labels, refits, flagged, scoredDays };
}

// --------------------------------------------------------------- run
const types = ["electricity", "gas", "water"];
const base = Object.fromEntries(types.map((t) => [t, series(t)]));
const report = { generatedAt: new Date().toISOString(), threshold, spikeZ: core.SPIKE_Z, alertEpisodeDays: core.ALERT_EPISODE_DAYS, seeds: SEEDS, refitDays: core.REFIT_DAYS, dataErrorBand: [core.DATA_ERROR_LOW_RATIO, core.DATA_ERROR_HIGH_RATIO], scenarios: {} };
const t0 = Date.now();

for (const [name, spec] of Object.entries(SCENARIOS)) {
  const sc = (report.scenarios[name] = { types: {}, faults: {} });
  for (const type of types) {
    const perSeed = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { rows, errors } = perturb(base[type], spec, seed * 7919 + types.indexOf(type));
      const run = simulate(rows);
      const fit = core.fitEnergyModel(rows);
      const evaluated = rows.filter((r) => between(rows[0].day, r.day) >= core.MIN_MODEL_DAYS);
      const months = new Set(evaluated.filter((r) => healthyDay(r.day)).map((r) => core.exclusionMonth(r.day))).size;
      const byMonth = {};
      const outboundByMonth = {};
      for (const a of run.alarms) {
        if (!healthyDay(a.day) || errors[a.day]) continue;
        const k = core.exclusionMonth(a.day);
        byMonth[k] = (byMonth[k] || 0) + 1;
        if (!a.lowConfidence) outboundByMonth[k] = (outboundByMonth[k] || 0) + 1;
      }
      // Entry errors on days the model scored (before the first valid model nothing is scored;
      // the server then labels them against the Batch 1 baseline instead).
      const errorDays = Object.keys(errors).filter((d) => run.scoredDays[d] !== undefined);
      const ratios = Object.entries(run.scoredDays).filter(([d, r]) => !errors[d] && r !== null).map(([, r]) => r);
      perSeed.push({
        seed,
        days: rows.length,
        cvrmseMonthly: fit.ok ? fit.model.stats.cvrmseMonthly : null,
        cvrmseDaily: fit.ok ? fit.model.stats.cvrmseDaily : null,
        valid: fit.ok && fit.model.valid,
        trainingDataErrors: fit.ok ? fit.model.stats.dataErrors : null,
        healthyMonths: months,
        falseAlarms: Object.values(byMonth).reduce((s, n) => s + n, 0),
        maxFalsePerMonth: Math.max(0, ...Object.values(byMonth)),
        outboundFalseAlarms: Object.values(outboundByMonth).reduce((s, n) => s + n, 0),
        maxOutboundFalsePerMonth: Math.max(0, ...Object.values(outboundByMonth)),
        entryErrors: errorDays.length,
        entryErrorsNotScored: Object.keys(errors).length - errorDays.length,
        maxRatioOtherDays: Math.round(Math.max(0, ...ratios) * 100) / 100,
        minRatioOtherDays: Math.round(Math.min(9, ...ratios) * 100) / 100,
        entryErrorsLabelled: errorDays.filter((d) => run.labels[d]).length,
        entryErrorsAlarmedAsFault: errorDays.filter((d) => run.alarms.some((a) => a.day === d)).length,
        otherDaysLabelledDataError: Object.keys(run.labels).filter((d) => !errors[d]).length,
      });
    }
    const max = (k) => Math.max(...perSeed.map((p) => p[k] ?? 0));
    const avg = (k) => Math.round((perSeed.reduce((s, p) => s + (p[k] ?? 0), 0) / perSeed.length) * 100) / 100;
    sc.types[type] = {
      cvrmseMonthly: { mean: avg("cvrmseMonthly"), max: max("cvrmseMonthly") },
      cvrmseDaily: { mean: avg("cvrmseDaily"), max: max("cvrmseDaily") },
      allValid: perSeed.every((p) => p.valid),
      maxFalsePerMonth: max("maxFalsePerMonth"),
      falseAlarmsMean: avg("falseAlarms"),
      maxOutboundFalsePerMonth: max("maxOutboundFalsePerMonth"),
      outboundFalseAlarmsMean: avg("outboundFalseAlarms"),
      entryErrors: perSeed.reduce((s, p) => s + p.entryErrors, 0),
      entryErrorsNotScored: perSeed.reduce((s, p) => s + p.entryErrorsNotScored, 0),
      ratioRangeOtherDays: [Math.min(...perSeed.map((p) => p.minRatioOtherDays)), max("maxRatioOtherDays")],
      entryErrorsLabelled: perSeed.reduce((s, p) => s + p.entryErrorsLabelled, 0),
      entryErrorsAlarmedAsFault: perSeed.reduce((s, p) => s + p.entryErrorsAlarmedAsFault, 0),
      otherDaysLabelledDataError: perSeed.reduce((s, p) => s + p.otherDaysLabelledDataError, 0),
      perSeed,
    };
  }
  for (const f of FAULTS) {
    const delays = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s0 = seed * 7919 + types.indexOf(f.type);
      const baseRun = simulate(perturb(base[f.type], spec, s0).rows);
      const faultRun = simulate(perturb(base[f.type], spec, s0, f).rows);
      // An alarm the base run raised on the same day is not credited to the fault.
      const a = faultRun.alarms.find((x) => x.day >= f.start && x.day <= f.end && !baseRun.alarms.some((b) => b.day === x.day));
      delays.push(a ? between(f.start, a.day) : null);
    }
    const found = delays.filter((d) => d !== null);
    sc.faults[f.id] = {
      detected: found.length, of: delays.length, delays,
      maxDelay: found.length ? Math.max(...found) : null,
      within3Days: delays.filter((d) => d !== null && d <= 2).length,
    };
  }
  console.error(`${name} done (${Math.round((Date.now() - t0) / 1000)} s)`);
}

// ------------------------------------------------------------ output
const lines = [];
lines.push("# F2 robustness backtest", "", `threshold ${threshold}% · spike z > ${core.SPIKE_Z} · one alert per meter per ${core.ALERT_EPISODE_DAYS} days · ${SEEDS} seeds per scenario · refit every ${core.REFIT_DAYS} days · data-error band ${core.DATA_ERROR_LOW_RATIO}–${core.DATA_ERROR_HIGH_RATIO} × expected`, "");
lines.push("## Model fit and false alerts (healthy days, worst seed; mean over seeds in brackets)", "",
  "With one year of data almost every scored month is one the model has not seen, so nearly every alert is low-confidence and stays in the app; the column \"leave the app\" says little until a second year.", "",
  "| scenario | meter | CV(RMSE) monthly | CV(RMSE) daily | valid | false alarms max/month | of which leave the app (max/month) | entry errors labelled (scored days) | entry errors alarmed as fault | other days labelled data error | actual ÷ expected, other days |",
  "|---|---|---|---|---|---|---|---|---|---|---|");
for (const [name, sc] of Object.entries(report.scenarios)) {
  for (const [t, x] of Object.entries(sc.types)) {
    lines.push(`| ${name} | ${t} | ${x.cvrmseMonthly.max}% (${x.cvrmseMonthly.mean}%) | ${x.cvrmseDaily.max}% (${x.cvrmseDaily.mean}%) | ${x.allValid ? "yes" : "no"} | ${x.maxFalsePerMonth} (${x.falseAlarmsMean} total) | ${x.maxOutboundFalsePerMonth} (${x.outboundFalseAlarmsMean} total) | ${x.entryErrors ? `${x.entryErrorsLabelled}/${x.entryErrors}${x.entryErrorsNotScored ? ` (+${x.entryErrorsNotScored} before the first valid model)` : ""}` : "—"} | ${x.entryErrors ? x.entryErrorsAlarmedAsFault : "—"} | ${x.otherDaysLabelledDataError} | ${x.ratioRangeOtherDays[0]}–${x.ratioRangeOtherDays[1]} |`);
  }
}
lines.push("", "## Injected 20 % faults (14 days): seeds detected / seeds; detected within 3 days; delays per seed (– = missed)", "",
  `| scenario | ${FAULTS.map((f) => f.id).join(" | ")} |`, `|---|${FAULTS.map(() => "---").join("|")}|`);
for (const [name, sc] of Object.entries(report.scenarios)) {
  lines.push(`| ${name} | ${FAULTS.map((f) => { const x = sc.faults[f.id]; return `${x.detected}/${x.of}; ≤3 d: ${x.within3Days} (${x.delays.map((d) => (d === null ? "–" : d)).join(",")})`; }).join(" | ")} |`);
}
const over = [];
for (const [name, sc] of Object.entries(report.scenarios)) for (const [t, x] of Object.entries(sc.types)) if (x.maxFalsePerMonth > MAX_FALSE_PER_MONTH) over.push(`${name}/${t}: ${x.maxFalsePerMonth}`);
report.overLimit = over;
lines.push("", over.length ? `**Over ${MAX_FALSE_PER_MONTH} false alarms a month:** ${over.join(", ")}` : `No scenario exceeds ${MAX_FALSE_PER_MONTH} false alarms a month.`);
console.log(lines.join("\n"));
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2));
