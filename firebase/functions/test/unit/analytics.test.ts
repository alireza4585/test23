import { describe, expect, it } from "vitest";

import { computeDailyMetrics } from "../../src/analytics/metrics";
import {
  energyIntensityRule,
  EngineInput,
  generateInsights,
  outOfOrderRevenueRule,
  repeatFailureRule,
  stockoutForecastRule,
} from "../../src/analytics/rules-engine";
import { DEFAULT_SETTINGS, OperationsDay, TicketRow } from "../../src/analytics/types";

const addDays = (key: string, delta: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
const now = new Date("2026-10-05T07:00:00Z");
const today = "2026-10-05";

function baseInput(overrides: Partial<EngineInput> = {}): EngineInput {
  const operations: OperationsDay[] = [];
  const energy: EngineInput["energy"] = [];
  for (let i = 30; i >= 1; i--) {
    const day = addDays(today, -i);
    operations.push({ day, roomsAvailable: 58, roomsOccupied: 42, roomRevenue: 42 * 85_000_000 });
    // 54 kWh/room normally, +22% over the last 4 days
    energy.push({ day, type: "electricity", consumption: 42 * 54 * (i <= 4 ? 1.22 : 1) });
  }
  return {
    today,
    now,
    addDays,
    settings: DEFAULT_SETTINGS,
    operations,
    energy,
    tickets: [],
    tasks: [],
    items: [],
    movements: [],
    rooms: [],
    ...overrides,
  };
}

const ticket = (over: Partial<TicketRow>): TicketRow => ({
  id: "t",
  title: "AC fault",
  category: "hvac",
  priority: "high",
  status: "open",
  createdAt: new Date(now.getTime() - 2 * 864e5),
  ...over,
});

describe("computeDailyMetrics", () => {
  it("derives hospitality KPIs and energy intensity", () => {
    const m = computeDailyMetrics({
      day: "2026-10-04",
      now,
      dayKeyOf: (d) => d.toISOString().slice(0, 10),
      settings: DEFAULT_SETTINGS,
      operations: { day: "2026-10-04", roomsAvailable: 50, roomsOccupied: 40, roomRevenue: 4_000_000 },
      energy: [{ day: "2026-10-04", type: "electricity", consumption: 2400 }],
      tickets: [ticket({ slaDueAt: new Date(now.getTime() - 1000) }), ticket({ id: "x", status: "closed" })],
      tasks: [],
      items: [{ id: "i", name: "Soap", unit: "pc", quantity: 5, reorderLevel: 10, unitCost: 100 }],
      rooms: [{ id: "r", number: "101", status: "outOfOrder" }],
    });
    expect(m.occupancyRate).toBe(80);
    expect(m.adr).toBe(100_000);
    expect(m.revpar).toBe(80_000);
    expect(m.electricityPerOccupiedRoom).toBe(60);
    expect(m.electricityVsBaselinePct).toBe(0);
    expect(m.maintenance.open).toBe(1);
    expect(m.maintenance.overdue).toBe(1);
    expect(m.inventory.lowStock).toBe(1);
    expect(m.rooms.outOfOrder).toBe(1);
  });
});

describe("rule engine", () => {
  it("flags rising energy intensity with flat occupancy and links HVAC tickets", () => {
    const [insight] = energyIntensityRule(baseInput({ tickets: [ticket({})] }));
    expect(insight).toBeDefined();
    expect(insight.id).toBe("energyIntensity_electricity");
    expect(insight.confidence).toBeGreaterThan(0.8);
    expect(insight.estimatedMonthlySaving).toBeGreaterThan(0);
    expect(insight.evidence.length).toBeGreaterThanOrEqual(3);
  });

  it("stays quiet when consumption follows occupancy", () => {
    const input = baseInput();
    input.energy = input.energy.map((e) => ({ ...e, consumption: 42 * 54 }));
    expect(energyIntensityRule(input)).toHaveLength(0);
  });

  it("forecasts stock-outs from issue velocity", () => {
    const movements = Array.from({ length: 14 }, (_, i) => ({
      itemId: "inv-1",
      type: "issue" as const,
      delta: -45,
      createdAt: new Date(now.getTime() - i * 864e5),
    }));
    const out = stockoutForecastRule(
      baseInput({
        items: [{ id: "inv-1", name: "Shampoo", unit: "pc", quantity: 140, reorderLevel: 200, reorderQuantity: 600 }],
        movements,
      }),
    );
    expect(out).toHaveLength(1);
    // max(reorder quantity 600, 14 days × 45/day) = 630
    expect(out[0].recommendation).toContain("630");
  });

  it("detects repeat failures at one location", () => {
    const tickets = [1, 2, 3].map((i) => ticket({ id: `t${i}`, roomNumber: "609", category: "hvac" }));
    expect(repeatFailureRule(baseInput({ tickets }))).toHaveLength(1);
  });

  it("prices out-of-order rooms", () => {
    const rooms = [{ id: "r", number: "405", status: "outOfOrder", updatedAt: new Date(now.getTime() - 3 * 864e5) }];
    const [i] = outOfOrderRevenueRule(baseInput({ rooms }));
    expect(i.estimatedMonthlySaving).toBeGreaterThan(0);
  });

  it("produces stable ids so reruns update instead of duplicating", () => {
    const a = generateInsights(baseInput({ tickets: [ticket({})] })).map((i) => i.id);
    const b = generateInsights(baseInput({ tickets: [ticket({})] })).map((i) => i.id);
    expect(a).toEqual(b);
  });
});
