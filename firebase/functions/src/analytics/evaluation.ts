/**
 * Closed-loop evaluation of recommendations: after a recommendation is
 * accepted or implemented, compare a "before" window with an "after" window
 * using the method fixed when the recommendation was made. Results that are
 * not distinguishable from noise are reported as inconclusive, never as
 * savings.
 */
import { BaselineModel, EnergyDay, measure } from "./energy-baseline";
import { mean, round, welchT } from "./stats";

export type EvaluationStatus = "pending" | "evaluated" | "inconclusive" | "insufficientData" | "notSupported";

export interface Evaluation {
  status: EvaluationStatus;
  method: string;
  unit?: string;
  baseline?: number | null;
  actual?: number | null;
  delta?: number | null;
  improved?: boolean | null;
  monthlyIrr?: number | null;
  confidence?: "low" | "medium" | "high";
  detail?: string;
  limitations: string[];
  window?: { beforeFrom?: string; beforeTo?: string; afterFrom: string; afterTo: string };
}

/** Days to wait after the decision before each method can be evaluated. */
export const EVALUATION_WINDOW_DAYS: Record<string, number> = {
  energyBaseline: 14,
  durationAvg: 7,
  ticketCount: 30,
  stockout: 14,
  oooRooms: 7,
  occupancyGap: 28,
};

/**
 * Energy: savings against a baseline fitted on data before the decision.
 * [model] must be fitted only on days before the decision.
 */
export function evaluateEnergy(model: BaselineModel | null, after: EnergyDay[], tariff: number, window: Evaluation["window"]): Evaluation {
  const limitations = ["Baseline adjusts for occupancy and season only; weather and operational changes are not modelled."];
  if (!model) return { status: "insufficientData", method: "energyBaseline", limitations: [...limitations, "No baseline: fewer than 28 days with energy and occupancy before the decision."], window };
  if (!model.valid) return { status: "insufficientData", method: "energyBaseline", limitations: [...limitations, `Baseline CV(RMSE) ${model.cvrmse}% exceeds the 25% limit.`], window };
  if (after.length < 10) return { status: "insufficientData", method: "energyBaseline", limitations: [...limitations, `Only ${after.length} days measured after the decision (need 10).`], window };
  const m = measure(model, after);
  const perDay = m.savings / after.length;
  return {
    status: m.significant ? "evaluated" : "inconclusive",
    method: "energyBaseline",
    unit: "kWh",
    baseline: m.totalExpected,
    actual: m.totalActual,
    delta: m.savings,
    improved: m.significant ? m.savings > 0 : null,
    monthlyIrr: m.significant ? Math.round(perDay * 30 * tariff) : null,
    confidence: m.significant ? (Math.abs(m.savings) > 2 * m.uncertainty ? "high" : "medium") : "low",
    detail: `savings ${round(m.savings, 0)} kWh ± ${round(m.uncertainty, 0)} kWh (95%) over ${after.length} days; baseline CV(RMSE) ${model.cvrmse}%`,
    limitations: [...limitations, "Uncertainty assumes independent daily errors, so it may be optimistic."],
    window,
  };
}

/** Mean of a measure before vs after (e.g. checkout-clean minutes); lower is better. */
export function evaluateMean(method: string, unit: string, before: number[], after: number[], window: Evaluation["window"], lowerIsBetter = true): Evaluation {
  const limitations = ["Simple before/after comparison: other changes in the same period are not controlled for."];
  if (before.length < 5 || after.length < 5) {
    return { status: "insufficientData", method, unit, limitations: [...limitations, `Samples: ${before.length} before, ${after.length} after (need 5 each).`], window };
  }
  const b = mean(before);
  const a = mean(after);
  const t = welchT(before, after);
  const significant = t !== null && Math.abs(t) >= 2;
  const delta = a - b;
  return {
    status: significant ? "evaluated" : "inconclusive",
    method,
    unit,
    baseline: round(b, 2),
    actual: round(a, 2),
    delta: round(delta, 2),
    improved: significant ? (lowerIsBetter ? delta < 0 : delta > 0) : null,
    confidence: significant ? (Math.abs(t!) >= 3 ? "high" : "medium") : "low",
    detail: `n=${before.length}/${after.length}, Welch t=${round(t, 2)}`,
    limitations,
    window,
  };
}

/** Event counts in equal windows before and after (e.g. repeat failures); lower is better. */
export function evaluateCount(method: string, unit: string, before: number, after: number, window: Evaluation["window"]): Evaluation {
  // Poisson comparison: difference beyond 2 standard errors of the counts.
  const se = Math.sqrt(before + after);
  const significant = se > 0 && Math.abs(after - before) >= 2 * se;
  return {
    status: significant ? "evaluated" : "inconclusive",
    method,
    unit,
    baseline: before,
    actual: after,
    delta: after - before,
    improved: significant ? after < before : null,
    confidence: significant ? "medium" : "low",
    detail: `${before} before vs ${after} after`,
    limitations: ["Counts are small; a change may be chance.", "Other changes in the same period are not controlled for."],
    window,
  };
}

/** Outcome check (did the risk materialise?), e.g. a stock-out after an order recommendation. */
export function evaluateOutcome(method: string, happened: boolean, detail: string, window: Evaluation["window"]): Evaluation {
  return {
    status: "evaluated",
    method,
    actual: happened ? 1 : 0,
    improved: !happened,
    confidence: "medium",
    detail,
    limitations: ["Shows whether the problem occurred, not how much the action contributed."],
    window,
  };
}
