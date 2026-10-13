// F2 backtest (rolling origin) on the test-dataset pack, run offline with the
// same core.js the server uses.
//
//   node scripts/backtest-energy.mjs --csv <pack dir|zip> --xlsx <workbook> \
//     [--faults scripts/backtest/energy-faults.json] [--out report.json]
//
// For every day after the first 90 the model in force is the one the server
// would hold: fitted on the 365 days before it and refitted every
// REFIT_DAYS days. Variants compared on the same days:
//   weather    F2 with the workbook's temperature
//   noWeather  F2 without temperature (occupancy / season)
//   batch1     the Batch 1 baseline (energy-baseline.ts) with its alert rule
//   static     the hotel's fixed daily baseline and alert threshold
// Injected faults come from a separate fixture file and are applied to an
// in-memory copy; nothing is written anywhere except the optional --out file.
//
// The workbook's temperature is "Estimated / Assumed (modelled)" and the
// dataset's energy was generated from it, so these results show that the
// implementation behaves as specified, not how well the model would fit a
// real hotel.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { readDataset } from "./dataset/load.mjs";
import { openWorkbook } from "./lib/xlsx.mjs";

const require = createRequire(import.meta.url);
const core = require("../pb_hooks/lib/core.js");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? acc.concat([[a.slice(2), all[i + 1]]]) : acc), []));
if (!args.csv || !args.xlsx) {
  console.error("usage: node scripts/backtest-energy.mjs --csv <pack> --xlsx <workbook> [--faults file] [--out file]");
  process.exit(2);
}
const faultsFile = args.faults || new URL("./backtest/energy-faults.json", import.meta.url).pathname;
const UNITS = { electricity: "kWh", water: "m³", gas: "m³" };
const TRAIN_DAYS = 365;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const excelDay = (v) => (typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10) : String(v).slice(0, 10));

// ------------------------------------------------------------------ data
const data = readDataset({ csv: args.csv, xlsx: args.xlsx });
const wb = openWorkbook(readFileSync(args.xlsx));
const settings = data.hotel.settings || {};
const threshold = settings.energyAlertThresholdPct ?? 15;
const staticBaseline = settings.energyDailyBaseline || {};
const occ = Object.fromEntries(data.operations.map((o) => [o.day, Number(o.roomsOccupied)]));
const temp = Object.fromEntries(wb.records("Weather").map((w) => [excelDay(w.date), Number(w.temp_mean_c)]));
const events = wb.records("Events").map((e) => ({ id: e.event_id, start: excelDay(e.start_date), end: excelDay(e.end_date), type: e.event_type, dept: e.department, text: String(e.description).slice(0, 90) }));

function series(type) {
  const by = {};
  for (const r of data.energy) if (r.type === type) by[r.day] = (by[r.day] || 0) + Number(r.consumption);
  return Object.keys(by).sort().filter((d) => occ[d] !== undefined).map((d) => ({ day: d, consumption: by[d], occupied: occ[d], tMean: temp[d] ?? null }));
}

// ------------------------------------------------------------ simulation
/** Rolling-origin run of one variant over [rows]; returns the alarms and refits. */
function simulate(rows, variant, { exclude = [], refitOn = null } = {}) {
  const input = variant === "noWeather" ? rows.map((r) => ({ ...r, tMean: null })) : rows;
  const alarms = [];
  const refits = [];
  let model = null;
  let fittedOn = null;
  let cusum = 0;
  let scored = 0;
  let invalidDays = 0;
  let lastAlert = null;
  for (let i = core.MIN_MODEL_DAYS; i < input.length; i++) {
    const row = input[i];
    const day = row.day;
    if (variant === "static") {
      const base = staticBaseline[row.type] || staticBaseline[rows.type] || 0;
      const dev = base > 0 ? ((row.consumption - base) / base) * 100 : 0;
      scored++;
      if (dev > threshold) alarms.push({ day, kind: "static", deviationPct: Math.round(dev) });
      continue;
    }
    const due = !fittedOn || between(fittedOn, day) >= core.REFIT_DAYS || (refitOn && day === refitOn);
    if (due) {
      const train = input.filter((r) => r.day >= addDays(day, -TRAIN_DAYS) && r.day < day);
      if (variant === "batch1") {
        model = core.fitBaseline(train);
        refits.push({ day, valid: !!model && model.valid, cvrmseDaily: model ? model.cvrmse : null });
      } else {
        const res = core.fitEnergyModel(train, exclude);
        model = res.ok ? res.model : null;
        refits.push(res.ok
          ? { day, kind: model.kind, valid: model.valid, cvrmseMonthly: model.stats.cvrmseMonthly, cvrmseDaily: model.stats.cvrmseDaily, tbCool: model.tbCool, tbHeat: model.tbHeat, excluded: model.stats.excluded }
          : { day, valid: false, reason: `${res.reason} ${res.have}/${res.need}` });
      }
      fittedOn = day;
    }
    if (!model || !model.valid) {
      invalidDays++;
      cusum = 0;
      continue;
    }
    scored++;
    if (variant === "batch1") {
      const c = core.checkReading(model, day, row.occupied, row.consumption, threshold);
      if (c.anomaly) alarms.push({ day, kind: "spike", deviationPct: c.deviationPct });
      continue;
    }
    const s = core.scoreDay(model, row, cusum, threshold);
    if (!s) continue;
    cusum = s.cusum;
    // One alert per meter per episode, as the server raises them.
    if ((s.spike || s.drift) && !(lastAlert && between(lastAlert, day) <= core.ALERT_EPISODE_DAYS)) {
      lastAlert = day;
      alarms.push({ day, kind: s.drift ? "drift" : "spike", deviationPct: s.deviationPct, usedWeather: s.usedWeather, seasonCovered: s.seasonCovered });
    }
  }
  return { variant, alarms, refits, scored, invalidDays };
}

const inWindow = (d, w) => d >= w.start && d <= w.end;
const firstAlarm = (run, from, to) => run.alarms.find((a) => a.day >= from && a.day <= to) || null;

// --------------------------------------------------------------- report
const VARIANTS = ["weather", "noWeather", "batch1", "static"];
const report = { generatedAt: new Date().toISOString(), threshold, refitDays: core.REFIT_DAYS, types: {}, faults: [], acceptance: [] };
const faults = JSON.parse(readFileSync(faultsFile, "utf8")).faults;

for (const type of ["electricity", "gas", "water"]) {
  const rows = series(type);
  rows.type = type;
  rows.forEach((r) => (r.type = type));
  if (rows.length < core.MIN_MODEL_DAYS) continue;
  const full = core.fitEnergyModel(rows);
  const fullNoWeather = core.fitEnergyModel(rows.map((r) => ({ ...r, tMean: null })));
  const short = core.fitEnergyModel(rows.slice(0, core.MIN_MODEL_DAYS - 1));
  const runs = Object.fromEntries(VARIANTS.map((v) => [v, simulate(rows, v)]));
  // Healthy days: outside every dataset event (± 1 day) and every injected fault of this type.
  const windows = events.map((e) => ({ start: addDays(e.start, -1), end: addDays(e.end, 1) }));
  const healthy = (d) => !windows.some((w) => inWindow(d, w));
  const perMonth = (run) => {
    const m = {};
    for (const a of run.alarms) if (healthy(a.day)) m[core.exclusionMonth(a.day)] = (m[core.exclusionMonth(a.day)] || 0) + 1;
    return m;
  };
  const evaluated = rows.slice(core.MIN_MODEL_DAYS).filter((r) => healthy(r.day));
  const months = new Set(evaluated.map((r) => core.exclusionMonth(r.day))).size;
  report.types[type] = {
    unit: UNITS[type],
    days: rows.length,
    from: rows[0].day,
    to: rows[rows.length - 1].day,
    fullYear: {
      weather: full.ok ? { kind: full.model.kind, valid: full.model.valid, reason: full.model.reason, ...full.model.stats, tbCool: full.model.tbCool, tbHeat: full.model.tbHeat } : full,
      noWeather: fullNoWeather.ok ? { kind: fullNoWeather.model.kind, valid: fullNoWeather.model.valid, cvrmseMonthly: fullNoWeather.model.stats.cvrmseMonthly, cvrmseDaily: fullNoWeather.model.stats.cvrmseDaily } : fullNoWeather,
      candidates: full.ok ? full.candidates : [],
    },
    under90Days: short,
    healthyMonths: months,
    variants: Object.fromEntries(VARIANTS.map((v) => {
      const r = runs[v];
      const pm = perMonth(r);
      const healthyUnseen = r.alarms.filter((a) => healthy(a.day) && a.seasonCovered === false).length;
      return [v, {
        scoredDays: r.scored, invalidDays: r.invalidDays, alarms: r.alarms.length, healthyAlarmsUnseenSeason: healthyUnseen,
        healthyAlarms: Object.values(pm).reduce((s, n) => s + n, 0), maxHealthyAlarmsPerMonth: Math.max(0, ...Object.values(pm)), healthyAlarmsByMonth: pm,
        refits: r.refits,
      }];
    })),
    events: events.filter((e) => e.end >= rows[core.MIN_MODEL_DAYS].day).map((e) => ({
      ...e,
      alarms: Object.fromEntries(VARIANTS.map((v) => [v, runs[v].alarms.filter((a) => inWindow(a.day, e)).map((a) => `${a.day} ${a.kind} ${a.deviationPct}%`)])),
    })).filter((e) => VARIANTS.some((v) => e.alarms[v].length) || /Energy|HVAC|Degradation|Boiler|Leak/.test(`${e.type} ${e.text}`)),
  };

  for (const f of faults.filter((x) => x.type === type)) {
    const end = addDays(f.start, f.days - 1);
    const injected = rows.map((r) => (r.day >= f.start && r.day <= end ? { ...r, consumption: r.consumption * (1 + f.pct / 100) } : r));
    injected.type = type;
    const row = { ...f, end };
    for (const v of VARIANTS) {
      const run = simulate(injected, v);
      const a = firstAlarm(run, f.start, end);
      // Alarms the base run already raised in this window are not credited to the fault.
      const base = firstAlarm(runs[v], f.start, end);
      row[v] = a ? { detected: true, delayDays: between(f.start, a.day), alsoInBaseRun: !!base && base.day === a.day } : { detected: false };
    }
    report.faults.push(row);
  }
}

// Exclusion cap: a 28-day 20 % autumn fault inside the training window, the
// maximum allowed days excluded, refit at its end; the fault must stay visible.
{
  const rows = series("electricity");
  const start = "2026-09-01";
  const end = "2026-09-28";
  const injected = rows.map((r) => (r.day >= start && r.day <= end ? { ...r, consumption: r.consumption * 1.2 } : r));
  const perMonth = {};
  const exclude = injected.filter((r) => r.day >= start && r.day <= end).map((r) => r.day).filter((d) => {
    const k = core.exclusionMonth(d);
    perMonth[k] = (perMonth[k] || 0) + 1;
    return perMonth[k] <= core.MAX_EXCLUDED_DAYS_PER_MONTH;
  });
  const fit = core.fitEnergyModel(injected.filter((r) => r.day <= end), exclude);
  let cusum = 0;
  const flagged = [];
  const devs = [];
  for (const r of injected.filter((x) => x.day >= start && x.day <= end)) {
    const s = core.scoreDay(fit.model, r, cusum, threshold);
    cusum = s.cusum;
    devs.push(s.deviationPct);
    if (s.spike || s.drift) flagged.push(r.day);
  }
  report.exclusionCap = {
    fault: { start, end, pct: 20 }, excludedDays: exclude, refitValid: fit.ok && fit.model.valid,
    flaggedDays: flagged.length, firstFlag: flagged[0] || null, meanDeviationPct: Math.round((devs.reduce((s, v) => s + v, 0) / devs.length) * 10) / 10,
  };
}

// ----------------------------------------------------------- acceptance
const e = report.types.electricity;
const autumn20 = report.faults.find((f) => f.id === "autumn-20");
const evt18 = e.events.find((x) => x.id === "EVT-018");
const evt15 = e.events.find((x) => x.id === "EVT-015");
const gasEvt07 = report.types.gas?.events.find((x) => x.id === "EVT-007");
const accept = (criterion, ok, detail) => report.acceptance.push({ criterion, result: ok ? "✓" : "✗", detail });
accept("Injected 20 % autumn fault detected within 3 days (weather model)", autumn20.weather.detected && autumn20.weather.delayDays <= 2,
  autumn20.weather.detected ? `delay ${autumn20.weather.delayDays} day(s) after the first fault day` : "not detected");
accept("≤ 2 false alarms per month in healthy periods (weather model, electricity)", e.variants.weather.maxHealthyAlarmsPerMonth <= 2,
  `max ${e.variants.weather.maxHealthyAlarmsPerMonth} per month, ${e.variants.weather.healthyAlarms} over ${e.healthyMonths} months`);
for (const t of ["gas", "water"]) {
  const v = report.types[t]?.variants.weather;
  if (!v) continue;
  accept(`≤ 2 false alarms per month in healthy periods (weather model, ${t})`, v.maxHealthyAlarmsPerMonth <= 2,
    `max ${v.maxHealthyAlarmsPerMonth} per month, ${v.healthyAlarms} total, of which ${v.healthyAlarmsUnseenSeason} in a month the model had not seen yet (labelled low-confidence)`);
}
accept("Monthly CV(RMSE) < 15 % (electricity, full year)", e.fullYear.weather.valid && e.fullYear.weather.cvrmseMonthly < 15,
  `${e.fullYear.weather.cvrmseMonthly}% (${e.fullYear.weather.kind}, ${e.fullYear.weather.months} months)`);
accept("Under 90 days: insufficient data", e.under90Days.ok === false && e.under90Days.reason === "insufficient_data",
  JSON.stringify(e.under90Days));
const evt18First = evt18?.alarms.weather[0]?.slice(0, 10);
accept("EVT-018 (BMS override, ~3,600 kWh/day from 2026-10-03) detected within 3 days", !!evt18First && between("2026-10-03", evt18First) <= 2,
  evt18First ? `first alarm ${evt18First}` : "no alarm in the event window");
accept("Heat wave EVT-015: no weather-model alarm", (evt15?.alarms.weather.length ?? 0) === 0,
  `weather ${evt15?.alarms.weather.length ?? 0}, noWeather ${evt15?.alarms.noWeather.length ?? 0}, batch1 ${evt15?.alarms.batch1.length ?? 0}, static ${evt15?.alarms.static.length ?? 0}`);
if (gasEvt07) {
  accept("Cold snap EVT-007 (gas): no weather-model alarm", gasEvt07.alarms.weather.length === 0,
    `weather ${gasEvt07.alarms.weather.length}, noWeather ${gasEvt07.alarms.noWeather.length}, batch1 ${gasEvt07.alarms.batch1.length}, static ${gasEvt07.alarms.static.length}`);
}
accept("Excluding fault days within the cap does not hide a sustained 20 % fault", report.exclusionCap.flaggedDays > 0 && report.exclusionCap.meanDeviationPct > 10,
  `${report.exclusionCap.excludedDays.length} days excluded, ${report.exclusionCap.flaggedDays} of 28 fault days flagged, mean deviation ${report.exclusionCap.meanDeviationPct}%`);

// --------------------------------------------------------------- output
const lines = [];
lines.push("# F2 backtest", "", `threshold ${threshold}% · refit every ${core.REFIT_DAYS} days · train ${TRAIN_DAYS} days · temperature: workbook (estimated)`, "");
lines.push("## Acceptance", "", "| criterion | result | detail |", "|---|---|---|");
for (const a of report.acceptance) lines.push(`| ${a.criterion} | ${a.result} | ${a.detail} |`);
lines.push("", "## Model quality (fit on the whole year)", "", "| type | model | valid | CV(RMSE) monthly | CV(RMSE) daily | Tc / Th | no-weather CV(RMSE) monthly |", "|---|---|---|---|---|---|---|");
for (const [t, r] of Object.entries(report.types)) {
  const w = r.fullYear.weather;
  lines.push(`| ${t} | ${w.kind} | ${w.valid ? "yes" : `no (${w.reason})`} | ${w.cvrmseMonthly}% | ${w.cvrmseDaily}% | ${w.tbCool ?? "—"} / ${w.tbHeat ?? "—"} | ${r.fullYear.noWeather.cvrmseMonthly}% |`);
}
lines.push("", "## Alarms on healthy days (max per month / total; F2: of which in a month the model had not seen yet)", "", "| type | weather | noWeather | batch1 | static |", "|---|---|---|---|---|");
for (const [t, r] of Object.entries(report.types)) {
  const cell = (v) => {
    const x = r.variants[v];
    return `${x.maxHealthyAlarmsPerMonth} / ${x.healthyAlarms}${v === "weather" || v === "noWeather" ? ` (unseen ${x.healthyAlarmsUnseenSeason})` : ""}`;
  };
  lines.push(`| ${t} | ${VARIANTS.map(cell).join(" | ")} |`);
}
lines.push("", "## Injected faults (delay in days after the first fault day; – = not detected)", "", "| fault | weather | noWeather | batch1 | static |", "|---|---|---|---|---|");
for (const f of report.faults) lines.push(`| ${f.id} (${f.type}, ${f.start}, +${f.pct}%) | ${VARIANTS.map((v) => (f[v].detected ? `${f[v].delayDays}${f[v].alsoInBaseRun ? "*" : ""}` : "–")).join(" | ")} |`);
lines.push("", "\\* also alarmed in the run without the fault (a dataset event in the same window).", "", "## Dataset events in the evaluated period", "", "| event | type | window | weather | noWeather | batch1 | static |", "|---|---|---|---|---|---|---|");
for (const [t, r] of Object.entries(report.types)) {
  for (const ev of r.events) lines.push(`| ${ev.id} (${t}) | ${ev.type} | ${ev.start} – ${ev.end} | ${VARIANTS.map((v) => ev.alarms[v].length).join(" | ")} |`);
}
console.log(lines.join("\n"));
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2));
