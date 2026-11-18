import { describe, expect, it } from "vitest";

import { proposeActions } from "../../src/analytics/actions";
import { shiftDay } from "../../src/analytics/calendar";
import {
  DEFAULT_LEAD_DAYS,
  DayMovement,
  OrderLine,
  ReplenishmentItem,
  forecastUsage,
  leadTimeOf,
  mase,
  planItem,
  planReplenishment,
} from "../../src/analytics/replenishment";
import { EngineInput, generateInsights } from "../../src/analytics/rules-engine";
import { DEFAULT_SETTINGS } from "../../src/analytics/types";

const TODAY = "2026-10-07";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [days] of usage before TODAY: [perDay] ± 20 %, or on a share of days only (intermittent). */
function usage(itemId: string, days: number, perDay: number, opts: { seed?: number; share?: number } = {}): DayMovement[] {
  const r = rng(opts.seed ?? 1);
  const out: DayMovement[] = [];
  for (let i = days; i >= 1; i--) {
    if (opts.share !== undefined && r() > opts.share) continue;
    out.push({ itemId, type: "issue", delta: -Math.round(perDay * (0.8 + 0.4 * r())), day: shiftDay(TODAY, -i) });
  }
  return out;
}

const item = (over: Partial<ReplenishmentItem> = {}): ReplenishmentItem => ({
  id: "shampoo", name: "شامپو", unit: "عدد", quantity: 400, reorderLevel: 100, reorderQuantity: 0, unitCost: 50_000,
  supplierId: "sup1", supplierName: "پخش بهداشتی", ...over,
});

describe("replenishment (F5)", () => {
  it("SES for regular usage, Croston for intermittent usage", () => {
    const regular = usage("a", 56, 40).map((m) => Math.abs(m.delta));
    expect(forecastUsage(regular)).toMatchObject({ method: "ses" });
    expect(forecastUsage(regular).rate).toBeGreaterThan(32);
    expect(forecastUsage(regular).rate).toBeLessThan(48);
    const r = rng(9);
    const sparse = Array.from({ length: 56 }, () => (r() < 0.25 ? 12 : 0));
    const f = forecastUsage(sparse);
    expect(f.method).toBe("croston");
    expect(f.rate).toBeGreaterThan(1.5);
    expect(f.rate).toBeLessThan(5);
  });

  it("suggests an order before the reorder point, sized for lead time + review period, with its cost", () => {
    const plan = planItem(item({ quantity: 220 }), null, usage("shampoo", 56, 40), [], TODAY);
    expect(plan.ok).toBe(true);
    expect(plan.leadTime).toEqual({ days: DEFAULT_LEAD_DAYS, source: "assumed", samples: 0 });
    expect(plan.reorderPoint).toBeGreaterThan(plan.forecast.rate * DEFAULT_LEAD_DAYS);
    const s = plan.suggestion!;
    expect(s.kind).toBe("reorder");
    expect(s.quantity).toBeGreaterThan(plan.forecast.rate * (DEFAULT_LEAD_DAYS + 7) - 220);
    expect(s.estimatedCost).toBe(s.quantity * 50_000);
    // At least 3 days before the stock runs out.
    expect(s.stockoutDay! >= shiftDay(s.orderBy, 3)).toBe(true);
  });

  it("nothing to order with plenty of stock, or when an open order already covers it", () => {
    expect(planItem(item({ quantity: 2000 }), null, usage("shampoo", 56, 40), [], TODAY).suggestion).toBeNull();
    const open: OrderLine[] = [{ itemId: "shampoo", quantity: 600, status: "sent", orderedDay: shiftDay(TODAY, -1) }];
    const p = planItem(item({ quantity: 220 }), null, usage("shampoo", 56, 40), open, TODAY);
    expect(p.onOrder).toBe(600);
    expect(p.suggestion).toBeNull();
  });

  it("learns the lead time from received orders, and plans with the slow end when the supplier is late", () => {
    const on = (ordered: number, received: number, expected?: number): OrderLine => ({
      itemId: "shampoo", supplierId: "sup1", quantity: 100, status: "received",
      orderedDay: shiftDay(TODAY, -ordered), receivedDay: shiftDay(TODAY, -received), expectedDay: expected === undefined ? null : shiftDay(TODAY, -expected),
    });
    expect(leadTimeOf(item(), null, [on(40, 36), on(30, 26), on(20, 16)])).toEqual({ days: 4, source: "learned", samples: 3 });
    // The last two arrived after their expected day: p90.
    const late = leadTimeOf(item(), null, [on(40, 36, 36), on(30, 22, 26), on(20, 10, 16)]);
    expect(late.source).toBe("learnedLate");
    expect(late.days).toBeGreaterThanOrEqual(9);
    // A longer lead time moves the order earlier.
    const base = planItem(item({ quantity: 380 }), null, usage("shampoo", 56, 40), [on(40, 36), on(30, 26)], TODAY);
    const slow = planItem(item({ quantity: 380 }), null, usage("shampoo", 56, 40), [on(40, 36, 36), on(30, 22, 26), on(20, 10, 16)], TODAY);
    expect(slow.reorderPoint).toBeGreaterThan(base.reorderPoint);
    expect(base.suggestion).toBeNull();
    expect(slow.suggestion?.kind).toBe("reorder");
  });

  it("daily deliveries follow a par level: no stock-out warning while par covers tomorrow", () => {
    const bread = item({ id: "bread", name: "نان", supplierId: "bakery", supplierName: "نانوایی", quantity: 60 });
    const moves = [...usage("bread", 56, 50)];
    for (let i = 28; i >= 1; i--) moves.push({ itemId: "bread", type: "receive", delta: 50, day: shiftDay(TODAY, -i) });
    const ok = planItem(bread, null, moves, [], TODAY);
    expect(ok.pattern).toBe("daily");
    expect(ok.suggestion).toBeNull(); // 60 on hand ≥ par for one day
    const low = planItem({ ...bread, quantity: 10 }, null, moves, [], TODAY);
    expect(low.suggestion).toMatchObject({ kind: "par", stockoutDay: null });
    expect(low.suggestion!.quantity).toBe(Math.ceil(low.parLevel! - 10));
  });

  it("a short shelf life caps the order quantity", () => {
    const milk = item({ id: "milk", name: "شیر", quantity: 30, shelfLifeDays: 4, deliveryPattern: "scheduled" });
    const p = planItem(milk, null, usage("milk", 56, 20), [], TODAY);
    expect(p.suggestion!.quantity).toBeLessThanOrEqual(Math.ceil(p.forecast.rate * 4));
  });

  it("a short shelf life caps the stock after delivery, not just the order", () => {
    // 20 a day, 3-day lead time, 4-day shelf life: plan for what is left on arrival.
    const milk = item({ id: "milk", name: "شیر", shelfLifeDays: 4, deliveryPattern: "scheduled" });
    for (const quantity of [40, 70, 100]) {
      const p = planItem({ ...milk, quantity }, null, usage("milk", 56, 20), [], TODAY);
      if (!p.suggestion) continue;
      const left = Math.max(0, quantity - p.forecast.rate * p.leadTime.days);
      expect(left + p.suggestion.quantity).toBeLessThanOrEqual(p.forecast.rate * 4 + 1e-9);
    }
    // Low enough that an order is due: it is suggested, and it fits.
    const due = planItem({ ...milk, quantity: 40 }, null, usage("milk", 56, 20), [], TODAY);
    expect(due.suggestion?.kind).toBe("reorder");
  });

  it("under 14 days of history: no forecast and no suggestion", () => {
    const p = planItem(item({ quantity: 5 }), null, usage("shampoo", 10, 40), [], TODAY);
    expect(p).toMatchObject({ ok: false, suggestion: null });
    expect(p.reason).toMatch(/^insufficient_history/);
  });

  it("groups suggestions by supplier, one draft order each", () => {
    const res = planReplenishment({
      today: TODAY,
      items: [item({ quantity: 200 }), item({ id: "soap", name: "صابون", quantity: 50 }), item({ id: "towel", name: "حوله", supplierId: "sup2", supplierName: "نساجی", quantity: 10 })],
      suppliers: [{ id: "sup1", name: "پخش بهداشتی", leadTimeDays: 3 }, { id: "sup2", name: "نساجی", leadTimeDays: 7 }],
      movements: [...usage("shampoo", 56, 40), ...usage("soap", 56, 20, { seed: 2 }), ...usage("towel", 56, 5, { seed: 3 })],
      orders: [],
    });
    expect(res.bySupplier.map((g) => [g.supplierId, g.lines.map((l) => l.itemId).sort()])).toEqual([
      ["sup1", ["shampoo", "soap"]],
      ["sup2", ["towel"]],
    ]);
    expect(res.plans.find((p) => p.itemId === "towel")!.leadTime).toEqual({ days: 7, source: "supplier", samples: 0 });
  });

  it("MASE: below 1 when the forecast beats the naive one", () => {
    const history = [10, 30, 10, 30, 10, 30, 10, 30];
    expect(mase([20, 20], [20, 20], history)).toBe(0);
    expect(mase([20, 20], [40, 0], history)).toBe(1);
  });

  it("with the flag, one insight per supplier replaces the stock-out rule; the action carries no cost", () => {
    const movements = usage("shampoo", 56, 40);
    const state = planReplenishment({ today: TODAY, items: [item({ quantity: 120 })], suppliers: [], movements, orders: [] });
    const input: EngineInput = {
      today: TODAY, now: new Date(`${TODAY}T06:00:00Z`), addDays: shiftDay, settings: DEFAULT_SETTINGS,
      operations: [], energy: [], tickets: [], tasks: [], rooms: [],
      items: [{ id: "shampoo", name: "شامپو", unit: "عدد", quantity: 120, reorderLevel: 100, unitCost: 50_000 }],
      movements: movements.map((m) => ({ itemId: m.itemId, type: m.type, delta: m.delta, createdAt: new Date(`${m.day}T08:00:00Z`) })),
    };
    expect(generateInsights(input).map((i) => i.rule)).toContain("stockout");
    const withFlag = generateInsights({ ...input, replenishment: state });
    expect(withFlag.map((i) => i.rule)).not.toContain("stockout");
    const insight = withFlag.find((i) => i.rule === "replenishment")!;
    expect(insight).toMatchObject({ id: "replenishment_sup1", category: "inventory" });
    expect(JSON.stringify({ t: insight.title, s: insight.summary, e: insight.evidence })).not.toMatch(/50[,٬]?000|ریال|تومان/);
    const [action] = proposeActions(insight);
    expect(action).toMatchObject({ type: "createPurchaseOrder", department: "inventory", params: { supplierId: "sup1" } });
    const lines = (action.params as { lines: Record<string, unknown>[] }).lines;
    expect(lines).toEqual([expect.objectContaining({ itemId: "shampoo", kind: "reorder" })]);
    expect(lines.every((l) => !("estimatedCost" in l))).toBe(true);
  });
});
