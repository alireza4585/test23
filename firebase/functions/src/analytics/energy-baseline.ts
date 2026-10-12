/**
 * Occupancy-normalised energy baselines (IPMVP Option C style, daily whole-
 * hotel meter totals) and what is built on them: expected consumption,
 * anomaly checks, CUSUM drift and savings measurement.
 *
 * Model per meter type:  consumption ≈ b0 + b1·occupiedRooms (+ Friday flag)
 *                        (+ annual sin/cos terms when ≥ 300 days of history)
 * Fit by least squares; points with residuals beyond 3·RMSE are dropped and
 * the model refit once, so a past spike does not distort the baseline.
 *
 * Fit statistics follow ASHRAE Guideline 14: CV(RMSE) and NMBE with n − p
 * degrees of freedom. A model is "valid" for alerts and savings only when
 * CV(RMSE) ≤ 25 % (the whole-building limit used for 12–60 months of data).
 */
import { dayToJalali, weekdayOf } from "./calendar";
import { dot, leastSquares, mean, round } from "./stats";

export interface EnergyDay {
  day: string;
  consumption: number;
  occupied: number;
}

export interface BaselineModel {
  type?: string;
  coef: number[];
  annual: boolean;
  n: number;
  p: number;
  from: string;
  to: string;
  mean: number;
  rmse: number;
  cvrmse: number;
  nmbe: number;
  r2: number;
  dropped: number;
  valid: boolean;
}

export const MIN_BASELINE_DAYS = 28;
export const MAX_CVRMSE = 25;

function x(day: string, occupied: number, annual: boolean): number[] {
  const f = [1, occupied, weekdayOf(day) === 5 ? 1 : 0];
  if (annual) {
    const { jm, jd } = dayToJalali(day);
    const doy = (jm <= 6 ? (jm - 1) * 31 : 186 + (jm - 7) * 30) + jd - 1;
    const w = (2 * Math.PI * doy) / 365.2422;
    f.push(Math.sin(w), Math.cos(w), Math.sin(2 * w), Math.cos(2 * w));
  }
  return f;
}

function fit(rows: EnergyDay[], annual: boolean) {
  const X = rows.map((r) => x(r.day, r.occupied, annual));
  const y = rows.map((r) => r.consumption);
  const coef = leastSquares(X, y, undefined, 1e-6);
  if (!coef) return null;
  const resid = y.map((v, i) => v - dot(coef, X[i]));
  return { coef, resid };
}

/** Fits a baseline on [rows] (one per day; days without occupancy are skipped). */
export function fitBaseline(rows: EnergyDay[]): BaselineModel | null {
  const data = rows.filter((r) => isFinite(r.consumption) && r.consumption >= 0 && isFinite(r.occupied)).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (data.length < MIN_BASELINE_DAYS) return null;
  const annual = data.length >= 300;
  let first = fit(data, annual);
  if (!first) return null;
  const p = first.coef.length;
  const rmse0 = Math.sqrt(first.resid.reduce((s, e) => s + e * e, 0) / Math.max(1, data.length - p));
  const kept = data.filter((_, i) => Math.abs(first!.resid[i]) <= 3 * rmse0);
  let used = data;
  if (kept.length >= MIN_BASELINE_DAYS && kept.length < data.length) {
    const second = fit(kept, annual);
    if (second) {
      first = second;
      used = kept;
    }
  }
  const n = used.length;
  const y = used.map((r) => r.consumption);
  const m = mean(y);
  const sse = first.resid.reduce((s, e) => s + e * e, 0);
  const sst = y.reduce((s, v) => s + (v - m) * (v - m), 0);
  const dof = Math.max(1, n - p);
  const rmse = Math.sqrt(sse / dof);
  const cvrmse = m > 0 ? (rmse / m) * 100 : Infinity;
  const nmbe = m > 0 ? (first.resid.reduce((s, e) => s + e, 0) / (dof * m)) * 100 : 0;
  return {
    coef: first.coef.map((c) => round(c, 6) as number),
    annual,
    n,
    p,
    from: used[0].day,
    to: used[n - 1].day,
    mean: round(m, 3) as number,
    rmse: round(rmse, 3) as number,
    cvrmse: round(cvrmse, 2) as number,
    nmbe: round(nmbe, 3) as number,
    r2: sst > 0 ? (round(1 - sse / sst, 4) as number) : 0,
    dropped: data.length - n,
    valid: cvrmse <= MAX_CVRMSE,
  };
}

export function expected(model: BaselineModel, day: string, occupied: number): number {
  return Math.max(0, dot(model.coef, x(day, occupied, model.annual)));
}

export interface AnomalyCheck {
  expected: number;
  deviationPct: number;
  z: number;
  anomaly: boolean;
  critical: boolean;
}

/**
 * A reading is anomalous when it is above the model's expectation by more
 * than 2.5 RMSE AND by more than [thresholdPct] percent (the hotel's alert
 * threshold), so small hotels with noisy meters do not get alerts for
 * statistically "significant" but trivial deviations.
 */
export function checkReading(model: BaselineModel, day: string, occupied: number, consumption: number, thresholdPct: number): AnomalyCheck {
  const e = expected(model, day, occupied);
  const deviationPct = e > 0 ? ((consumption - e) / e) * 100 : 0;
  const z = model.rmse > 0 ? (consumption - e) / model.rmse : 0;
  const anomaly = model.valid && z > 2.5 && deviationPct > thresholdPct;
  return {
    expected: round(e, 2) as number,
    deviationPct: round(deviationPct, 1) as number,
    z: round(z, 2) as number,
    anomaly,
    critical: anomaly && deviationPct > 2 * thresholdPct,
  };
}

export interface MeasuredDay {
  day: string;
  actual: number;
  expected: number;
  /** actual − expected (positive = more than expected). */
  diff: number;
  /** Running sum of diff from the first day of the period. */
  cusum: number;
  occupied: number;
}

export interface Measurement {
  days: MeasuredDay[];
  totalActual: number;
  totalExpected: number;
  /** expected − actual over the period: positive = savings. */
  savings: number;
  /** ±95 % half-width of [savings], from baseline RMSE (independent errors assumed). */
  uncertainty: number;
  significant: boolean;
}

/** Actual vs baseline for each day of a reporting period, with CUSUM and savings. */
export function measure(model: BaselineModel, period: EnergyDay[]): Measurement {
  const days: MeasuredDay[] = [];
  let cusum = 0;
  let totalActual = 0;
  let totalExpected = 0;
  for (const r of period.slice().sort((a, b) => (a.day < b.day ? -1 : 1))) {
    const e = expected(model, r.day, r.occupied);
    const diff = r.consumption - e;
    cusum += diff;
    totalActual += r.consumption;
    totalExpected += e;
    days.push({
      day: r.day,
      actual: round(r.consumption, 2) as number,
      expected: round(e, 2) as number,
      diff: round(diff, 2) as number,
      cusum: round(cusum, 2) as number,
      occupied: r.occupied,
    });
  }
  const savings = totalExpected - totalActual;
  const uncertainty = 1.96 * model.rmse * Math.sqrt(Math.max(1, days.length));
  return {
    days,
    totalActual: round(totalActual, 2) as number,
    totalExpected: round(totalExpected, 2) as number,
    savings: round(savings, 2) as number,
    uncertainty: round(uncertainty, 2) as number,
    significant: model.valid && days.length > 0 && Math.abs(savings) > uncertainty,
  };
}
