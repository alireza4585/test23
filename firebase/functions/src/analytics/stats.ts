/** Small numeric helpers shared by forecasting, baselines and evaluation. */

export function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Weighted least squares with a small ridge penalty (not applied to the
 * intercept, column 0). Returns null when the system is singular.
 */
export function leastSquares(X: number[][], y: number[], weights?: number[], ridge = 1e-6): number[] | null {
  const p = X[0]?.length ?? 0;
  if (p === 0 || X.length < p) return null;
  const A: number[][] = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    const w = weights ? weights[i] : 1;
    const row = X[i];
    for (let a = 0; a < p; a++) {
      const wa = w * row[a];
      for (let b = a; b < p; b++) A[a][b] += wa * row[b];
      A[a][p] += wa * y[i];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) A[a][b] = A[b][a];
    if (a > 0) A[a][a] += ridge;
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[p] / A[i][i]);
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Rounds to [d] decimals; keeps null/NaN as null. */
export function round(v: number | null | undefined, d = 2): number | null {
  if (v === null || v === undefined || !isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/** Welch's t statistic for the difference of means (b − a). */
export function welchT(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length);
  return se === 0 ? null : (mean(b) - mean(a)) / se;
}

/**
 * 95 % bootstrap interval of mean(after) − mean(before), resampling each group
 * with replacement. Seeded (mulberry32) so the same data gives the same
 * interval on every run. Null when a group has fewer than 2 values.
 */
export function bootstrapMeanDiff(before: number[], after: number[], iterations = 2000, seed = 20261013): [number, number] | null {
  if (before.length < 2 || after.length < 2) return null;
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const resampleMean = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rnd() * xs.length)];
    return s / xs.length;
  };
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i++) diffs.push(resampleMean(after) - resampleMean(before));
  return [round(quantile(diffs, 0.025), 2) as number, round(quantile(diffs, 0.975), 2) as number];
}
