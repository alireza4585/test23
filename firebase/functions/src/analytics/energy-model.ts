/**
 * Weather-normalised energy models (AI phase 1, F2), built on the Batch 1
 * baseline (energy-baseline.ts) rather than beside it.
 *
 * Candidates, each fitted by least squares on up to a year of daily whole-
 * hotel meter totals:
 *   occupancy  consumption ≈ b0 + b1·occupied + b2·friday
 *   seasonal   … + annual harmonics (only with ≥ 300 days)
 *   weather    … + c1·CDD(Tc) + c2·CDD(Tc)·occupancy share + h1·HDD(Th)
 *              (change-point model in the style of CalTRACK / ASHRAE G14;
 *              balance temperatures Tc and Th found by grid search; cooling
 *              only, heating only or both; non-physical fits — negative
 *              heating or cooling response — are rejected)
 * Days beyond 3·RMSE are dropped and the chosen candidate refitted once.
 *
 * Quality gate (ASHRAE Guideline 14 calibration): CV(RMSE) of the monthly
 * totals (Jalali months with ≥ 20 days) below 15 % over at least 3 months.
 * A model that fails the gate is stored but not used for alerts; the caller
 * falls back to the Batch 1 baseline and says "model not reliable yet".
 *
 * Detection on top of a model. Meter noise grows with load, so a day's
 * residual is standardised by CV(RMSE) × expected rather than by a fixed RMSE.
 *   spike  z > 2.5 and above the hotel's alert threshold (percent);
 *   drift  one-sided CUSUM tuned to the smallest sustained fault of interest
 *          (MIN_SHIFT_PCT = 10 %): k = max(0.5, MIN_SHIFT_PCT / (2·CV)), h = 5,
 *          reset after each alarm. A well-fitting model therefore ignores a
 *          small bias (e.g. on unusually hot days) but catches a 10 %+ shift.
 */
import { dayToJalali, weekdayOf } from "./calendar";
import { dot, leastSquares, mean, round } from "./stats";

export const MIN_MODEL_DAYS = 90;
export const MAX_CVRMSE_MONTHLY = 15;
export const MIN_MONTH_DAYS = 20;
export const MIN_GATE_MONTHS = 3;
export const COVERED_MONTH_DAYS = 10;
export const CUSUM_K = 0.5;
export const CUSUM_H = 5;
export const MIN_SHIFT_PCT = 10;
export const SPIKE_Z = 2.5;
/** Weekly refits would slowly absorb a sustained fault; refit every 28 days. */
export const REFIT_DAYS = 28;

const COOL_GRID = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
const HEAT_GRID = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export interface ModelDay {
  day: string;
  consumption: number;
  occupied: number;
  /** Daily mean temperature (°C); missing when no weather is available. */
  tMean?: number | null;
}

export type ModelKind = "weather" | "seasonal" | "occupancy";

export interface ModelSpec {
  kind: ModelKind;
  coef: number[];
  features: string[];
  tbCool: number | null;
  tbHeat: number | null;
  /** Largest occupied-room count in training: occupancy share = occupied / occScale. */
  occScale: number;
}

export interface ModelStats {
  n: number;
  p: number;
  from: string;
  to: string;
  mean: number;
  rmse: number;
  cvrmseDaily: number;
  r2: number;
  months: number;
  cvrmseMonthly: number | null;
  nmbeMonthly: number | null;
  dropped: number;
  excluded: number;
  /**
   * Jalali months of the year (1–12) with at least COVERED_MONTH_DAYS training
   * days. In its first year a model has not seen every season; an alarm in an
   * uncovered month is labelled low-confidence (e.g. irrigation or a cooling
   * tower that starts in summer is not explained by temperature alone).
   */
  coveredMonths: number[];
}

export interface EnergyModel extends ModelSpec {
  stats: ModelStats;
  valid: boolean;
  /** Why the model is not valid (null when valid). */
  reason: string | null;
  /** Best model without temperature, used on days without weather data. */
  fallback: (ModelSpec & { stats: ModelStats; valid: boolean; reason: string | null }) | null;
}

export type FitResult =
  | { ok: true; model: EnergyModel; candidates: { kind: ModelKind; cvrmseDaily: number; cvrmseMonthly: number | null; valid: boolean }[] }
  | { ok: false; reason: "insufficient_data"; have: number; need: number };

const cdd = (t: number, tb: number) => Math.max(0, t - tb);
const hdd = (t: number, tb: number) => Math.max(0, tb - t);

function harmonics(day: string): number[] {
  const { jm, jd } = dayToJalali(day);
  const doy = (jm <= 6 ? (jm - 1) * 31 : 186 + (jm - 7) * 30) + jd - 1;
  const w = (2 * Math.PI * doy) / 365.2422;
  return [Math.sin(w), Math.cos(w), Math.sin(2 * w), Math.cos(2 * w)];
}

/** Feature row for [spec]; null when the spec needs a temperature the day lacks. */
function row(spec: Pick<ModelSpec, "features" | "tbCool" | "tbHeat" | "occScale">, d: ModelDay): number[] | null {
  const out: number[] = [];
  const t = d.tMean;
  for (const f of spec.features) {
    switch (f) {
      case "intercept": out.push(1); break;
      case "occupied": out.push(d.occupied); break;
      case "friday": out.push(weekdayOf(d.day) === 5 ? 1 : 0); break;
      case "annual": out.push(...harmonics(d.day)); break;
      case "cdd":
      case "cddOcc":
      case "hdd": {
        if (t === null || t === undefined || !isFinite(t)) return null;
        if (f === "cdd") out.push(cdd(t, spec.tbCool as number));
        else if (f === "cddOcc") out.push(cdd(t, spec.tbCool as number) * (spec.occScale > 0 ? d.occupied / spec.occScale : 0));
        else out.push(hdd(t, spec.tbHeat as number));
        break;
      }
    }
  }
  return out;
}

function coefOf(spec: ModelSpec, name: string): number {
  let i = 0;
  for (const f of spec.features) {
    if (f === name) return spec.coef[i];
    i += f === "annual" ? 4 : 1;
  }
  return 0;
}

interface Fitted {
  spec: ModelSpec;
  used: ModelDay[];
  resid: number[];
  sse: number;
  p: number;
}

function fitSpec(base: Omit<ModelSpec, "coef">, data: ModelDay[]): Fitted | null {
  const X: number[][] = [];
  const y: number[] = [];
  const used: ModelDay[] = [];
  for (const d of data) {
    const r = row(base, d);
    if (!r) continue;
    X.push(r);
    y.push(d.consumption);
    used.push(d);
  }
  if (!X.length || X.length < X[0].length + 2) return null;
  const coef = leastSquares(X, y, undefined, 1e-6);
  if (!coef) return null;
  const resid = y.map((v, i) => v - dot(coef, X[i]));
  return { spec: Object.assign({}, base, { coef }), used, resid, sse: resid.reduce((s, e) => s + e * e, 0), p: coef.length };
}

/** Physical sanity: more heat or cooling demand never lowers consumption. */
function physical(f: Fitted): boolean {
  const s = f.spec;
  if (s.features.indexOf("hdd") >= 0 && coefOf(s, "hdd") < 0) return false;
  if (s.features.indexOf("cdd") >= 0) {
    const c = coefOf(s, "cdd");
    if (c < 0 || c + coefOf(s, "cddOcc") < 0) return false;
  }
  return true;
}

const adjusted = (f: Fitted) => f.sse / Math.max(1, f.used.length - f.p);

/** Drops days beyond 3·RMSE and refits once (as the Batch 1 baseline does). */
function robust(f: Fitted, minDays: number): Fitted {
  const rmse0 = Math.sqrt(adjusted(f));
  const kept = f.used.filter((_, i) => Math.abs(f.resid[i]) <= 3 * rmse0);
  if (kept.length === f.used.length || kept.length < minDays) return f;
  const base = Object.assign({}, f.spec) as Omit<ModelSpec, "coef"> & { coef?: number[] };
  delete base.coef;
  const second = fitSpec(base, kept);
  return second && physical(second) ? second : f;
}

function jalaliMonth(day: string): string {
  const { jy, jm } = dayToJalali(day);
  return `${jy}-${jm < 10 ? "0" : ""}${jm}`;
}

/** Monthly CV(RMSE) and NMBE of [spec] over [days] (months with ≥ MIN_MONTH_DAYS days). */
export function monthlyFit(spec: ModelSpec, days: ModelDay[]): { months: number; cvrmse: number | null; nmbe: number | null } {
  const groups: Record<string, { n: number; actual: number; predicted: number }> = {};
  for (const d of days) {
    const r = row(spec, d);
    if (!r) continue;
    const k = jalaliMonth(d.day);
    const g = groups[k] || (groups[k] = { n: 0, actual: 0, predicted: 0 });
    g.n++;
    g.actual += d.consumption;
    g.predicted += Math.max(0, dot(spec.coef, r));
  }
  const full = Object.keys(groups).map((k) => groups[k]).filter((g) => g.n >= MIN_MONTH_DAYS);
  if (full.length < 2) return { months: full.length, cvrmse: null, nmbe: null };
  const m = mean(full.map((g) => g.actual));
  const dof = full.length - 1;
  const sse = full.reduce((s, g) => s + (g.actual - g.predicted) * (g.actual - g.predicted), 0);
  const bias = full.reduce((s, g) => s + (g.actual - g.predicted), 0);
  return {
    months: full.length,
    cvrmse: m > 0 ? (round((Math.sqrt(sse / dof) / m) * 100, 2) as number) : null,
    nmbe: m > 0 ? (round((bias / (dof * m)) * 100, 3) as number) : null,
  };
}

function finish(f: Fitted, all: ModelDay[], excluded: number, dropped: number) {
  const n = f.used.length;
  const y = f.used.map((d) => d.consumption);
  const m = mean(y);
  const dof = Math.max(1, n - f.p);
  const rmse = Math.sqrt(f.sse / dof);
  const sst = y.reduce((s, v) => s + (v - m) * (v - m), 0);
  // The gate is judged on every training day the model can predict (dropped outliers included).
  const monthly = monthlyFit(f.spec, all);
  const perMonth: Record<number, number> = {};
  for (const d of f.used) {
    const jm = dayToJalali(d.day).jm;
    perMonth[jm] = (perMonth[jm] || 0) + 1;
  }
  const stats: ModelStats = {
    n,
    p: f.p,
    from: f.used[0].day,
    to: f.used[n - 1].day,
    mean: round(m, 3) as number,
    rmse: round(rmse, 3) as number,
    cvrmseDaily: m > 0 ? (round((rmse / m) * 100, 2) as number) : Infinity,
    r2: sst > 0 ? (round(1 - f.sse / sst, 4) as number) : 0,
    months: monthly.months,
    cvrmseMonthly: monthly.cvrmse,
    nmbeMonthly: monthly.nmbe,
    dropped,
    excluded,
    coveredMonths: Object.keys(perMonth).map(Number).filter((m) => perMonth[m] >= COVERED_MONTH_DAYS).sort((a, b) => a - b),
  };
  let reason: string | null = null;
  if (monthly.months < MIN_GATE_MONTHS) reason = `insufficient_months: ${monthly.months} of ${MIN_GATE_MONTHS} months with ≥ ${MIN_MONTH_DAYS} days`;
  else if (monthly.cvrmse === null || monthly.cvrmse >= MAX_CVRMSE_MONTHLY) reason = `cvrmse_monthly ${monthly.cvrmse}% ≥ ${MAX_CVRMSE_MONTHLY}%`;
  const spec: ModelSpec = {
    kind: f.spec.kind,
    coef: f.spec.coef.map((c) => round(c, 6) as number),
    features: f.spec.features,
    tbCool: f.spec.tbCool,
    tbHeat: f.spec.tbHeat,
    occScale: f.spec.occScale,
  };
  return Object.assign(spec, { stats, valid: reason === null, reason });
}

/**
 * Fits the candidates on [rows] minus [exclude] (days kept out by
 * adjustBaseline) and returns the chosen model with its no-weather fallback.
 * Weather is used only when at least [MIN_MODEL_DAYS] training days have a
 * temperature.
 */
export function fitEnergyModel(rows: ModelDay[], exclude: string[] = []): FitResult {
  const skip: Record<string, boolean> = {};
  for (const d of exclude) skip[d] = true;
  const clean = rows
    .filter((r) => isFinite(r.consumption) && r.consumption >= 0 && isFinite(r.occupied))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  const data = clean.filter((r) => !skip[r.day]);
  const excluded = clean.length - data.length;
  if (data.length < MIN_MODEL_DAYS) return { ok: false, reason: "insufficient_data", have: data.length, need: MIN_MODEL_DAYS };
  const occScale = Math.max(1, ...data.map((d) => d.occupied));
  const base = { tbCool: null, tbHeat: null, occScale };

  const noWeather: Fitted[] = [];
  const occ = fitSpec(Object.assign({ kind: "occupancy" as ModelKind, features: ["intercept", "occupied", "friday"] }, base), data);
  if (occ) noWeather.push(occ);
  if (data.length >= 300) {
    const seas = fitSpec(Object.assign({ kind: "seasonal" as ModelKind, features: ["intercept", "occupied", "friday", "annual"] }, base), data);
    if (seas) noWeather.push(seas);
  }

  let weather: Fitted | null = null;
  const withTemp = data.filter((d) => d.tMean !== null && d.tMean !== undefined && isFinite(d.tMean));
  if (withTemp.length >= MIN_MODEL_DAYS) {
    const tries: Omit<ModelSpec, "coef">[] = [];
    for (const tc of COOL_GRID) {
      tries.push({ kind: "weather", features: ["intercept", "occupied", "friday", "cdd", "cddOcc"], tbCool: tc, tbHeat: null, occScale });
      for (const th of HEAT_GRID) {
        if (th > tc) continue;
        tries.push({ kind: "weather", features: ["intercept", "occupied", "friday", "cdd", "cddOcc", "hdd"], tbCool: tc, tbHeat: th, occScale });
      }
    }
    for (const th of HEAT_GRID) tries.push({ kind: "weather", features: ["intercept", "occupied", "friday", "hdd"], tbCool: null, tbHeat: th, occScale });
    for (const t of tries) {
      const f = fitSpec(t, withTemp);
      if (!f || !physical(f)) continue;
      if (!weather || adjusted(f) < adjusted(weather)) weather = f;
    }
  }

  const done = (f: Fitted, all: ModelDay[]) => {
    const r = robust(f, MIN_MODEL_DAYS);
    return finish(r, all, excluded, f.used.length - r.used.length);
  };
  const fallbacks = noWeather.map((f) => done(f, data));
  const bestOf = <T extends { valid: boolean; stats: ModelStats }>(xs: T[]): T | null =>
    xs.slice().sort((a, b) => (a.valid !== b.valid ? (a.valid ? -1 : 1) : a.stats.cvrmseDaily - b.stats.cvrmseDaily))[0] || null;
  const fallback = bestOf(fallbacks);
  const weatherModel = weather ? done(weather, withTemp) : null;
  // A weather model is preferred when it passes the gate, or when nothing else does.
  const chosen = weatherModel && (weatherModel.valid || !(fallback && fallback.valid)) ? weatherModel : fallback;
  if (!chosen) return { ok: false, reason: "insufficient_data", have: data.length, need: MIN_MODEL_DAYS };
  const candidates = (weatherModel ? [weatherModel] : []).concat(fallbacks).map((c) => ({
    kind: c.kind, cvrmseDaily: c.stats.cvrmseDaily, cvrmseMonthly: c.stats.cvrmseMonthly, valid: c.valid,
  }));
  const model: EnergyModel = Object.assign({}, chosen, { fallback: chosen === fallback ? null : fallback });
  return { ok: true, model, candidates };
}

export interface Prediction {
  expected: number;
  lower: number;
  upper: number;
  /** Standard deviation of the day's residual: CV(RMSE) × expected. */
  sigma: number;
  /** Daily CV(RMSE) of the model used, percent. */
  cv: number;
  /** Which model produced it ("weather" needs the day's temperature). */
  kind: ModelKind;
  usedWeather: boolean;
  valid: boolean;
}

/** Expected consumption for one day, with a ±1.96·σ band (approximate: parameter uncertainty ignored). */
export function predictDay(model: EnergyModel, d: ModelDay): Prediction | null {
  let spec: EnergyModel | (ModelSpec & { stats: ModelStats; valid: boolean }) = model;
  let r = row(model, d);
  if (!r && model.fallback) {
    spec = model.fallback;
    r = row(spec, d);
  }
  if (!r) return null;
  const e = Math.max(0, dot(spec.coef, r));
  const cv = spec.stats.mean > 0 ? spec.stats.rmse / spec.stats.mean : 0;
  const sigma = e > 0 && cv > 0 ? cv * e : spec.stats.rmse;
  return {
    expected: round(e, 2) as number,
    lower: round(Math.max(0, e - 1.96 * sigma), 2) as number,
    upper: round(e + 1.96 * sigma, 2) as number,
    sigma: round(sigma, 3) as number,
    cv: round(cv * 100, 3) as number,
    kind: spec.kind,
    usedWeather: spec.kind === "weather",
    valid: spec.valid,
  };
}

export interface DayScore {
  day: string;
  expected: number;
  lower: number;
  upper: number;
  actual: number;
  residual: number;
  z: number;
  deviationPct: number;
  /** CUSUM after this day (0 after an alarm). */
  cusum: number;
  spike: boolean;
  drift: boolean;
  usedWeather: boolean;
  valid: boolean;
  /** Whether the model was trained on this time of year (see ModelStats.coveredMonths). */
  seasonCovered: boolean;
}

/**
 * Scores one day against [model]: spike (z > SPIKE_Z and deviation above
 * [thresholdPct]) and drift (CUSUM continuing from [prevCusum]). Only a
 * valid prediction raises flags.
 */
export function scoreDay(model: EnergyModel, d: ModelDay, prevCusum: number, thresholdPct: number): DayScore | null {
  const p = predictDay(model, d);
  if (!p) return null;
  const residual = d.consumption - p.expected;
  const z = p.sigma > 0 ? residual / p.sigma : 0;
  const deviationPct = p.expected > 0 ? (residual / p.expected) * 100 : 0;
  const k = p.cv > 0 ? Math.max(CUSUM_K, MIN_SHIFT_PCT / (2 * p.cv)) : CUSUM_K;
  let cusum = Math.max(0, (prevCusum || 0) + z - k);
  const drift = p.valid && cusum > CUSUM_H;
  if (drift) cusum = 0;
  return {
    day: d.day,
    expected: p.expected,
    lower: p.lower,
    upper: p.upper,
    actual: round(d.consumption, 2) as number,
    residual: round(residual, 2) as number,
    z: round(z, 2) as number,
    deviationPct: round(deviationPct, 1) as number,
    cusum: round(cusum, 3) as number,
    spike: p.valid && z > SPIKE_Z && deviationPct > thresholdPct,
    drift,
    usedWeather: p.usedWeather,
    valid: p.valid,
    seasonCovered: (model.stats.coveredMonths || []).indexOf(dayToJalali(d.day).jm) >= 0,
  };
}

/** Actual vs model over a period (for impact measurement): totals and a ±95 % band. */
export function measureWithModel(model: EnergyModel, period: ModelDay[]): {
  days: number; totalActual: number; totalExpected: number; savings: number; uncertainty: number; significant: boolean;
} {
  let a = 0;
  let e = 0;
  let n = 0;
  let variance = 0;
  for (const d of period) {
    const p = predictDay(model, d);
    if (!p) continue;
    a += d.consumption;
    e += p.expected;
    variance += p.sigma * p.sigma;
    n++;
  }
  const savings = e - a;
  // Independent daily errors assumed, so the band may be optimistic.
  const uncertainty = 1.96 * Math.sqrt(variance);
  return {
    days: n,
    totalActual: round(a, 2) as number,
    totalExpected: round(e, 2) as number,
    savings: round(savings, 2) as number,
    uncertainty: round(uncertainty, 2) as number,
    significant: model.valid && n > 0 && Math.abs(savings) > uncertainty,
  };
}

/** Jalali month key (yyyy-mm) of a day: the unit of the adjustBaseline cap. */
export const exclusionMonth = jalaliMonth;
/** At most this many days per meter type and Jalali month may be kept out of a fit. */
export const MAX_EXCLUDED_DAYS_PER_MONTH = 5;
