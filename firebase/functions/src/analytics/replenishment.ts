/**
 * Purchase suggestions (AI phase 2, F5). Replaces the 14-day linear stock-out
 * rule for hotels with the replenishment flag.
 *
 * Per item, from its daily usage (issue + waste) over the last HISTORY_DAYS:
 *   - regular usage: simple exponential smoothing (SES), alpha by the lowest
 *     one-step error on the history;
 *   - intermittent usage (average interval between usage days > 1.32):
 *     Croston with the Syntetos–Boylan correction (SBA);
 *   - sigma: root mean square of the one-step errors.
 * Lead time: the median of received purchase orders (order → receipt) when
 * there are at least MIN_LEAD_SAMPLES, the p90 when the last orders came late;
 * otherwise the item's, then the supplier's setting, then DEFAULT_LEAD_DAYS
 * (labelled "assumed").
 * Safety stock = z(95 %) · sigma · √lead time; reorder point = rate · lead
 * time + safety stock; inventory position = on hand + open orders.
 *
 * Items delivered daily (perishables: bread, milk, meat) follow a par level,
 * not the stock-out logic: they are topped up to par for the next delivery and
 * never produce a "will run out" warning while the par level covers them.
 *
 * Everything is a suggestion: an order is a draft until a person approves it.
 */
import { daysBetween, shiftDay } from "./calendar";
import { mean, quantile, round } from "./stats";

export const HISTORY_DAYS = 56;
export const MIN_HISTORY_DAYS = 14;
export const SERVICE_Z = 1.645; // 95 % cycle service level
export const DEFAULT_LEAD_DAYS = 3;
export const MIN_LEAD_SAMPLES = 2;
export const REVIEW_DAYS = 7;
/** Croston is used when usage days are on average further apart than this (Syntetos et al.). */
export const INTERMITTENT_ADI = 1.32;
/** Suggest an order when the order-by date is within this many days. */
export const LOOKAHEAD_DAYS = 2;
/** "daily" when deliveries arrived on at least this share of the last 28 days. */
export const DAILY_DELIVERY_SHARE = 0.5;

const ALPHAS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
/**
 * Croston is smoothed slowly, as is usual for intermittent demand: picked by
 * the one-step error alone, a large alpha chases the zeros and under-forecasts.
 */
const CROSTON_ALPHAS = [0.05, 0.1, 0.15, 0.2];

export type DeliveryPattern = "auto" | "daily" | "scheduled" | "onDemand";

export interface ReplenishmentItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  reorderQuantity?: number;
  unitCost?: number | null;
  supplierId?: string | null;
  supplierName?: string | null;
  leadTimeDays?: number | null;
  shelfLifeDays?: number | null;
  parLevel?: number | null;
  deliveryPattern?: DeliveryPattern | null;
}

export interface ReplenishmentSupplier {
  id: string;
  name: string;
  leadTimeDays?: number | null;
}

/** A movement already reduced to its hotel day (Tehran). */
export interface DayMovement {
  itemId: string;
  type: "receive" | "issue" | "adjust" | "waste";
  delta: number;
  day: string;
}

/** A purchase order line, for open quantity and learned lead times. */
export interface OrderLine {
  itemId: string;
  supplierId?: string | null;
  quantity: number;
  status: "draft" | "awaitingApproval" | "approved" | "sent" | "received" | "cancelled";
  orderedDay?: string | null;
  expectedDay?: string | null;
  receivedDay?: string | null;
}

export interface UsageForecast {
  method: "ses" | "croston" | "none";
  /** Expected usage per day. */
  rate: number;
  /** Root mean square of the one-step errors (per day). */
  sigma: number;
  alpha: number | null;
  /** Average interval between usage days. */
  adi: number | null;
  /** One-step mean absolute error on the history (for MASE). */
  mae: number | null;
}

export interface Suggestion {
  itemId: string;
  name: string;
  unit: string;
  supplierId: string | null;
  supplierName: string | null;
  kind: "reorder" | "par";
  quantity: number;
  orderBy: string;
  /** First day stock (without open orders) is expected to run out; null when not within the horizon. */
  stockoutDay: string | null;
  estimatedCost: number | null;
}

export interface ItemPlan {
  itemId: string;
  ok: boolean;
  reason: string | null;
  pattern: "daily" | "scheduled" | "onDemand";
  patternSource: "setting" | "history";
  forecast: UsageForecast;
  leadTime: { days: number; source: "learned" | "learnedLate" | "item" | "supplier" | "assumed"; samples: number };
  safetyStock: number;
  reorderPoint: number;
  parLevel: number | null;
  onHand: number;
  onOrder: number;
  position: number;
  daysOfCover: number | null;
  suggestion: Suggestion | null;
}

const r2 = (v: number) => round(v, 2) as number;

/** Daily usage (issue + waste, as positive numbers) for [from, to] inclusive. */
export function dailyUsage(movements: DayMovement[], itemId: string, from: string, to: string): number[] {
  const n = daysBetween(from, to) + 1;
  const out = new Array<number>(Math.max(0, n)).fill(0);
  for (const m of movements) {
    if (m.itemId !== itemId || (m.type !== "issue" && m.type !== "waste")) continue;
    const i = daysBetween(from, m.day);
    if (i >= 0 && i < n) out[i] += Math.abs(m.delta);
  }
  return out;
}

function ses(series: number[], alpha: number): { level: number; errors: number[] } {
  let level = series[0];
  const errors: number[] = [];
  for (let i = 1; i < series.length; i++) {
    errors.push(series[i] - level);
    level = alpha * series[i] + (1 - alpha) * level;
  }
  return { level, errors };
}

function croston(series: number[], alpha: number): { rate: number; errors: number[] } {
  let z: number | null = null; // demand size
  let p: number | null = null; // interval
  let gap = 1;
  const errors: number[] = [];
  const estimate = () => (z === null || p === null ? 0 : (z / p) * (1 - alpha / 2));
  for (const y of series) {
    errors.push(y - estimate());
    if (y > 0) {
      z = z === null ? y : alpha * y + (1 - alpha) * z;
      p = p === null ? gap : alpha * gap + (1 - alpha) * p;
      gap = 1;
    } else {
      gap++;
    }
  }
  // The first errors are made before any estimate exists; leave them out.
  const first = series.findIndex((y) => y > 0);
  return { rate: estimate(), errors: errors.slice(Math.max(1, first + 1)) };
}

const rms = (xs: number[]) => (xs.length ? Math.sqrt(xs.reduce((s, e) => s + e * e, 0) / xs.length) : 0);
const meanAbs = (xs: number[]) => (xs.length ? xs.reduce((s, e) => s + Math.abs(e), 0) / xs.length : 0);

/** SES or Croston-SBA on a daily usage series, alpha chosen by the lowest one-step error. */
export function forecastUsage(series: number[]): UsageForecast {
  const used = series.filter((y) => y > 0).length;
  if (series.length < 2 || used === 0) return { method: "none", rate: 0, sigma: 0, alpha: null, adi: null, mae: null };
  const adi = series.length / used;
  let best: UsageForecast | null = null;
  for (const a of adi > INTERMITTENT_ADI ? CROSTON_ALPHAS : ALPHAS) {
    const f = adi > INTERMITTENT_ADI
      ? (() => { const c = croston(series, a); return { method: "croston" as const, rate: c.rate, errors: c.errors }; })()
      : (() => { const s = ses(series, a); return { method: "ses" as const, rate: s.level, errors: s.errors }; })();
    const sigma = rms(f.errors);
    if (!best || sigma < best.sigma) best = { method: f.method, rate: f.rate, sigma, alpha: a, adi, mae: meanAbs(f.errors) };
  }
  const b = best as UsageForecast;
  return { ...b, rate: r2(Math.max(0, b.rate)), sigma: r2(b.sigma), adi: r2(adi), mae: b.mae === null ? null : r2(b.mae) };
}

/**
 * Mean absolute scaled error of [forecast] against the naive one-step forecast
 * (yesterday's usage) on [actual]: below 1 means better than naive.
 */
export function mase(actual: number[], forecast: number[], history: number[]): number | null {
  const naive: number[] = [];
  for (let i = 1; i < history.length; i++) naive.push(Math.abs(history[i] - history[i - 1]));
  const scale = mean(naive);
  if (!(scale > 0) || !actual.length) return null;
  return r2(meanAbs(actual.map((a, i) => a - forecast[i])) / scale);
}

/** Lead time from received orders, the item, the supplier, or the default. */
export function leadTimeOf(item: ReplenishmentItem, supplier: ReplenishmentSupplier | null, orders: OrderLine[]): ItemPlan["leadTime"] {
  const received = orders
    .filter((o) => o.status === "received" && o.orderedDay && o.receivedDay
      && (o.itemId === item.id || (!!item.supplierId && o.supplierId === item.supplierId)))
    .sort((a, b) => ((a.receivedDay as string) < (b.receivedDay as string) ? -1 : 1));
  const samples = received.map((o) => Math.max(0, daysBetween(o.orderedDay as string, o.receivedDay as string)));
  if (samples.length >= MIN_LEAD_SAMPLES) {
    // The last two orders came later than expected: plan with the slow end.
    const late = received.slice(-2).every((o) => o.expectedDay && (o.receivedDay as string) > o.expectedDay);
    return late
      ? { days: Math.ceil(quantile(samples, 0.9)), source: "learnedLate", samples: samples.length }
      : { days: Math.ceil(quantile(samples, 0.5)), source: "learned", samples: samples.length };
  }
  if (item.leadTimeDays && item.leadTimeDays > 0) return { days: item.leadTimeDays, source: "item", samples: samples.length };
  if (supplier?.leadTimeDays && supplier.leadTimeDays > 0) return { days: supplier.leadTimeDays, source: "supplier", samples: samples.length };
  return { days: DEFAULT_LEAD_DAYS, source: "assumed", samples: samples.length };
}

/** "daily" when receipts came on at least half of the last 28 days, else the item's setting or "scheduled". */
export function deliveryPatternOf(item: ReplenishmentItem, movements: DayMovement[], today: string): { pattern: ItemPlan["pattern"]; source: ItemPlan["patternSource"] } {
  if (item.deliveryPattern && item.deliveryPattern !== "auto") return { pattern: item.deliveryPattern, source: "setting" };
  const from = shiftDay(today, -28);
  const days = new Set(movements.filter((m) => m.itemId === item.id && m.type === "receive" && m.day >= from && m.day < today).map((m) => m.day));
  return { pattern: days.size / 28 >= DAILY_DELIVERY_SHARE ? "daily" : "scheduled", source: "history" };
}

/** The plan (and suggestion, if any) for one item as of [today]. */
export function planItem(
  item: ReplenishmentItem, supplier: ReplenishmentSupplier | null, movements: DayMovement[], orders: OrderLine[], today: string,
): ItemPlan {
  const to = shiftDay(today, -1);
  const from = shiftDay(today, -HISTORY_DAYS);
  const mine = movements.filter((m) => m.itemId === item.id && m.day <= to);
  const firstDay = mine.reduce((d, m) => (d === null || m.day < d ? m.day : d), null as string | null);
  const start = firstDay && firstDay > from ? firstDay : from;
  const series = dailyUsage(mine, item.id, start, to);
  const { pattern, source: patternSource } = deliveryPatternOf(item, movements, today);
  const lead = leadTimeOf(item, supplier, orders);
  const onOrder = orders
    .filter((o) => o.itemId === item.id && (o.status === "approved" || o.status === "sent" || o.status === "awaitingApproval"))
    .reduce((s, o) => s + o.quantity, 0);
  const base = {
    itemId: item.id, pattern, patternSource, leadTime: lead, onHand: item.quantity, onOrder, position: r2(item.quantity + onOrder),
  };
  if (series.length < MIN_HISTORY_DAYS) {
    return {
      ...base, ok: false, reason: `insufficient_history: ${series.length} of ${MIN_HISTORY_DAYS} days`,
      forecast: { method: "none", rate: 0, sigma: 0, alpha: null, adi: null, mae: null },
      safetyStock: 0, reorderPoint: item.reorderLevel, parLevel: item.parLevel ?? null, daysOfCover: null, suggestion: null,
    };
  }
  const f = forecastUsage(series);
  const cover = f.rate > 0 ? r2(item.quantity / f.rate) : null;
  const stockoutDay = f.rate > 0 ? shiftDay(today, Math.floor(item.quantity / f.rate)) : null;
  const cost = (q: number) => (item.unitCost && item.unitCost > 0 ? r2(q * item.unitCost) : null);
  const suggestion = (kind: Suggestion["kind"], quantity: number, orderBy: string): Suggestion => ({
    itemId: item.id, name: item.name, unit: item.unit, supplierId: item.supplierId ?? null, supplierName: item.supplierName ?? supplier?.name ?? null,
    kind, quantity, orderBy, stockoutDay: kind === "reorder" ? stockoutDay : null, estimatedCost: cost(quantity),
  });

  if (pattern === "daily") {
    // Next delivery is tomorrow: cover tomorrow's usage plus a one-day safety margin.
    const ss1 = r2(SERVICE_Z * f.sigma);
    const par = item.parLevel && item.parLevel > 0 ? item.parLevel : r2(f.rate * 1 + ss1);
    const short = Math.ceil(par - item.quantity - onOrder);
    return {
      ...base, ok: true, reason: null, forecast: f, safetyStock: ss1, reorderPoint: par, parLevel: par, daysOfCover: cover,
      suggestion: short > 0 ? suggestion("par", short, today) : null,
    };
  }

  const ss = r2(SERVICE_Z * f.sigma * Math.sqrt(lead.days));
  const rop = r2(f.rate * lead.days + ss);
  const position = item.quantity + onOrder;
  // Days until the position reaches the reorder point at the forecast rate.
  const slack = f.rate > 0 ? Math.floor((position - rop) / f.rate) : Infinity;
  let s: Suggestion | null = null;
  if (f.rate > 0 && slack <= LOOKAHEAD_DAYS) {
    let q = Math.ceil(f.rate * (lead.days + REVIEW_DAYS) + ss - position);
    q = Math.max(q, Math.ceil(item.reorderQuantity ?? 0));
    if (item.shelfLifeDays && item.shelfLifeDays > 0) q = Math.min(q, Math.ceil(f.rate * item.shelfLifeDays));
    if (q > 0) s = suggestion("reorder", q, shiftDay(today, Math.max(0, slack)));
  }
  return { ...base, ok: true, reason: null, forecast: f, safetyStock: ss, reorderPoint: rop, parLevel: null, daysOfCover: cover, suggestion: s };
}

/** Plans for every item, and the suggestions grouped by supplier (one draft order each). */
export function planReplenishment(input: {
  today: string;
  items: ReplenishmentItem[];
  suppliers: ReplenishmentSupplier[];
  movements: DayMovement[];
  orders: OrderLine[];
}): { plans: ItemPlan[]; bySupplier: { supplierId: string | null; supplierName: string | null; lines: Suggestion[] }[] } {
  const suppliers = new Map(input.suppliers.map((s) => [s.id, s]));
  const plans = input.items.map((it) => planItem(it, it.supplierId ? suppliers.get(it.supplierId) ?? null : null, input.movements, input.orders, input.today));
  const groups = new Map<string, { supplierId: string | null; supplierName: string | null; lines: Suggestion[] }>();
  for (const p of plans) {
    if (!p.suggestion) continue;
    const key = p.suggestion.supplierId ?? `name:${p.suggestion.supplierName ?? ""}`;
    const g = groups.get(key) ?? { supplierId: p.suggestion.supplierId, supplierName: p.suggestion.supplierName, lines: [] };
    g.lines.push(p.suggestion);
    groups.set(key, g);
  }
  const bySupplier = [...groups.values()].map((g) => ({ ...g, lines: g.lines.sort((a, b) => (a.orderBy < b.orderBy ? -1 : a.orderBy > b.orderBy ? 1 : 0)) }));
  return { plans, bySupplier };
}
