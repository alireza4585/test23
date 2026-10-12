/**
 * Daily forecasting for hotel KPIs (occupancy, revenue, energy).
 *
 * Three transparent models compete on a rolling-origin backtest:
 *   - seasonalNaive: the same weekday last week (the benchmark);
 *   - holtWinters:   additive Holt-Winters, weekly season, damped trend;
 *   - calendarRegression: weighted least squares on weekday, holiday and
 *     (with a year of history) annual-season terms.
 * The model with the lowest backtest MAE is chosen only if it is at least as
 * good as seasonal naive; otherwise seasonal naive is published. Intervals
 * come from the chosen model's backtest errors, so they reflect how wrong it
 * actually was, not a distributional assumption.
 */
import { dayToJalali, shiftDay, weekdayOf } from "./calendar";
import { dot, leastSquares, mean, quantile, round } from "./stats";

export type ForecastModel = "seasonalNaive" | "holtWinters" | "calendarRegression";

export interface SeriesPoint {
  day: string;
  value: number | null;
}

export interface ForecastPoint {
  day: string;
  value: number;
  lower: number;
  upper: number;
}

export interface ModelScore {
  model: ForecastModel;
  mae: number | null;
  mape: number | null;
  mase: number | null;
  origins: number;
}

export interface ForecastResult {
  ok: boolean;
  reason?: string;
  model?: ForecastModel;
  points: ForecastPoint[];
  scores: ModelScore[];
  trainedFrom?: string;
  trainedTo?: string;
  history: number;
  missing: number;
  backtestHorizon: number;
  interval: number;
}

export interface ForecastOptions {
  /** Days to forecast after the last history day. */
  horizon: number;
  /** Day keys that are holidays / special events. */
  special?: Set<string>;
  min?: number;
  max?: number;
  /** Coverage of the prediction interval (default 0.8). */
  interval?: number;
}

export const MIN_HISTORY_DAYS = 35;
const SEASON = 7;

/** Contiguous daily values from the first to the last day with data; gaps imputed. */
function prepare(series: SeriesPoint[]) {
  const known = series.filter((p) => p.value !== null && isFinite(p.value as number)).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (known.length === 0) return null;
  const byDay = new Map(known.map((p) => [p.day, p.value as number]));
  const first = known[0].day;
  const last = known[known.length - 1].day;
  const days: string[] = [];
  const values: number[] = [];
  const observed: boolean[] = [];
  const overall = mean(known.map((p) => p.value as number));
  for (let d = first; d <= last; d = shiftDay(d, 1)) {
    days.push(d);
    const v = byDay.get(d);
    if (v !== undefined) {
      values.push(v);
      observed.push(true);
    } else {
      // Same weekday last week, else the overall mean.
      values.push(values.length >= SEASON ? values[values.length - SEASON] : overall);
      observed.push(false);
    }
  }
  return { days, values, observed, missing: days.length - known.length };
}

// ------------------------------------------------------------------ models

function seasonalNaive(y: number[], h: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= h; k++) out.push(y[y.length - SEASON + ((k - 1) % SEASON)]);
  return out;
}

const PHI = 0.95;

function hwRun(y: number[], a: number, b: number, g: number) {
  const m = SEASON;
  let level = mean(y.slice(0, m));
  let trend = (mean(y.slice(m, 2 * m)) - level) / m;
  const season = y.slice(0, m).map((v) => v - level);
  let sse = 0;
  for (let t = m; t < y.length; t++) {
    const s = season[t % m];
    const fitted = level + PHI * trend + s;
    const e = y[t] - fitted;
    sse += e * e;
    const prevLevel = level;
    level = a * (y[t] - s) + (1 - a) * (prevLevel + PHI * trend);
    trend = b * (level - prevLevel) + (1 - b) * PHI * trend;
    season[t % m] = g * (y[t] - level) + (1 - g) * s;
  }
  return { sse, level, trend, season };
}

function holtWinters(y: number[], h: number): number[] {
  let best: ReturnType<typeof hwRun> | null = null;
  for (const a of [0.1, 0.3, 0.5]) {
    for (const b of [0, 0.05]) {
      for (const g of [0.05, 0.15, 0.3]) {
        const r = hwRun(y, a, b, g);
        if (!best || r.sse < best.sse) best = r;
      }
    }
  }
  const r = best!;
  const out: number[] = [];
  let damp = 0;
  for (let k = 1; k <= h; k++) {
    damp += Math.pow(PHI, k);
    out.push(r.level + damp * r.trend + r.season[(y.length + k - 1) % SEASON]);
  }
  return out;
}

function features(day: string, special: Set<string>, annual: boolean): number[] {
  const wd = weekdayOf(day);
  const f = [1];
  for (let k = 0; k < 6; k++) f.push(wd === k ? 1 : 0); // Saturday (6) is the reference
  f.push(special.has(day) ? 1 : 0);
  f.push(special.has(shiftDay(day, 1)) && !special.has(day) ? 1 : 0);
  if (annual) {
    const { jm, jd } = dayToJalali(day); // solar-year position: Nowruz-aligned
    const doy = (jm <= 6 ? (jm - 1) * 31 : 186 + (jm - 7) * 30) + jd - 1;
    const w = (2 * Math.PI * doy) / 365.2422;
    f.push(Math.sin(w), Math.cos(w), Math.sin(2 * w), Math.cos(2 * w));
  }
  return f;
}

function calendarRegression(days: string[], y: number[], h: number, special: Set<string>): number[] | null {
  const annual = y.length >= 364;
  const n = y.length;
  const start = Math.max(0, n - 730);
  const X: number[][] = [];
  const Y: number[] = [];
  const W: number[] = [];
  for (let i = start; i < n; i++) {
    X.push(features(days[i], special, annual));
    Y.push(y[i]);
    // Recent days weigh more (half-life 60 days) so the level follows shifts.
    W.push(annual ? 1 : Math.pow(0.5, (n - 1 - i) / 60));
  }
  // With a year of data, the level is carried by annual terms plus a recent-level correction.
  const coef = leastSquares(X, Y, W, 1e-3);
  if (!coef) return null;
  let bias = 0;
  if (annual) {
    const recent = Math.min(28, n);
    let s = 0;
    for (let i = n - recent; i < n; i++) s += y[i] - dot(coef, features(days[i], special, annual));
    bias = s / recent;
  }
  const out: number[] = [];
  for (let k = 1; k <= h; k++) out.push(dot(coef, features(shiftDay(days[n - 1], k), special, annual)) + bias);
  return out;
}

function predict(model: ForecastModel, days: string[], y: number[], h: number, special: Set<string>): number[] | null {
  if (model === "seasonalNaive") return seasonalNaive(y, h);
  if (model === "holtWinters") return y.length >= 2 * SEASON + 7 ? holtWinters(y, h) : null;
  return y.length >= 28 ? calendarRegression(days, y, h, special) : null;
}

// ---------------------------------------------------------------- backtest

const MODELS: ForecastModel[] = ["seasonalNaive", "holtWinters", "calendarRegression"];

/**
 * Forecasts [options.horizon] days after the last day with data. Needs at
 * least MIN_HISTORY_DAYS of history (gaps are imputed and counted).
 */
export function forecastSeries(series: SeriesPoint[], options: ForecastOptions): ForecastResult {
  const interval = options.interval ?? 0.8;
  const empty = (reason: string, history = 0, missing = 0): ForecastResult => ({
    ok: false, reason, points: [], scores: [], history, missing, backtestHorizon: 0, interval,
  });
  const prep = prepare(series);
  if (!prep) return empty("no_data");
  const { days, values: y, observed, missing } = prep;
  if (y.length < MIN_HISTORY_DAYS) return empty("insufficient_history", y.length, missing);
  if (missing > y.length * 0.2) return empty("too_many_gaps", y.length, missing);

  const special = options.special ?? new Set<string>();
  const H = Math.max(1, Math.min(options.horizon, 120));
  const btH = Math.min(14, H);
  const minTrain = 28;
  const origins: number[] = [];
  for (let o = y.length - btH; o >= minTrain && origins.length < 8; o -= SEASON) origins.push(o);

  // Scale for MASE: in-sample MAE of the weekly seasonal naive.
  let naiveScale = 0;
  for (let t = SEASON; t < y.length; t++) naiveScale += Math.abs(y[t] - y[t - SEASON]);
  naiveScale /= y.length - SEASON;

  const errors: Record<string, number[][]> = {};
  const scores: ModelScore[] = [];
  for (const model of MODELS) {
    const perStep: number[][] = Array.from({ length: btH }, () => []);
    const abs: number[] = [];
    const pct: number[] = [];
    let used = 0;
    for (const o of origins) {
      const f = predict(model, days.slice(0, o), y.slice(0, o), btH, special);
      if (!f) continue;
      used++;
      for (let k = 0; k < btH; k++) {
        const t = o + k;
        if (!observed[t]) continue;
        const e = Math.abs(y[t] - clamp(f[k], options));
        perStep[k].push(e);
        abs.push(e);
        if (y[t] !== 0) pct.push(e / Math.abs(y[t]));
      }
    }
    errors[model] = perStep;
    const mae = abs.length ? mean(abs) : null;
    scores.push({
      model,
      mae: round(mae, 3),
      mape: pct.length ? round(mean(pct) * 100, 2) : null,
      mase: mae !== null && naiveScale > 0 ? round(mae / naiveScale, 3) : null,
      origins: used,
    });
  }

  const naive = scores.find((s) => s.model === "seasonalNaive")!;
  let chosen: ModelScore = naive;
  for (const s of scores) {
    if (s.mae === null || s.origins < Math.min(3, origins.length)) continue;
    if (chosen.mae === null || s.mae < chosen.mae) chosen = s;
  }
  if (naive.mae !== null && chosen.mae !== null && chosen.mae > naive.mae) chosen = naive;

  const f = predict(chosen.model, days, y, H, special) ?? seasonalNaive(y, H);
  const steps = errors[chosen.model];
  const width = (k: number) => {
    // Interval half-width from backtest errors at this step (pooled by week), widened beyond the backtest horizon.
    const lo = Math.floor(Math.min(k, btH - 1) / SEASON) * SEASON;
    const pool: number[] = [];
    for (let i = lo; i < Math.min(lo + SEASON, btH); i++) pool.push(...steps[i]);
    const all = pool.length ? pool : ([] as number[]).concat(...steps);
    const q = all.length ? quantile(all, interval) : 0;
    return k < btH ? q : q * Math.sqrt((k + 1) / btH);
  };
  const last = days[days.length - 1];
  const points: ForecastPoint[] = f.map((v, k) => {
    const value = clamp(v, options);
    const w = width(k);
    return {
      day: shiftDay(last, k + 1),
      value: round(value, 2) as number,
      lower: round(clamp(value - w, options), 2) as number,
      upper: round(clamp(value + w, options), 2) as number,
    };
  });
  return {
    ok: true, model: chosen.model, points, scores, trainedFrom: days[0], trainedTo: last,
    history: y.length, missing, backtestHorizon: btH, interval,
  };
}

function clamp(v: number, o: ForecastOptions): number {
  let x = v;
  if (o.min !== undefined && x < o.min) x = o.min;
  if (o.max !== undefined && x > o.max) x = o.max;
  return x;
}
