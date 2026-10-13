import { describe, expect, it } from "vitest";

import { BriefingInput, briefingText, buildItems, factsOf, itemsForRole, robustZ } from "../../src/analytics/briefing";
import { shiftDay } from "../../src/analytics/calendar";
import { DEFAULT_SETTINGS } from "../../src/analytics/types";
import { ROLE_PERMISSIONS } from "../../src/domain/rbac";

const TODAY = "2026-10-07";
const perms = (role: keyof typeof ROLE_PERMISSIONS) => Object.fromEntries(ROLE_PERMISSIONS[role].map((p) => [p, true]));

/** 30 quiet days, then a bad yesterday: electricity +40 %, slow checkout cleans with absences. */
function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  const days = Array.from({ length: 30 }, (_, i) => shiftDay(TODAY, -(30 - i)));
  const yesterday = shiftDay(TODAY, -1);
  const wob = (i: number) => ((i * 37) % 11) - 5;
  const tasks = days.flatMap((d, i) => Array.from({ length: 6 }, (_, k) => {
    const start = new Date(`${d}T07:00:00Z`);
    const minutes = d === yesterday ? 58 + k : 34 + ((i + k) % 4);
    return { type: "checkoutClean", status: "done", day: d, startedAt: start, completedAt: new Date(start.getTime() + minutes * 60000) };
  }));
  return {
    today: TODAY, addDays: shiftDay, now: new Date(`${TODAY}T03:20:00Z`), settings: DEFAULT_SETTINGS,
    operations: days.map((d, i) => ({ day: d, roomsAvailable: 100, roomsOccupied: 70 + wob(i), roomRevenue: 1e9 })),
    energy: days.map((d, i) => ({ day: d, type: "electricity" as const, consumption: d === yesterday ? 4200 : 3000 + 20 * wob(i) })),
    tickets: [{ id: "t1", title: "Chiller 2 trips", category: "hvac", priority: "high", status: "open", createdAt: new Date(`${yesterday}T05:00:00Z`) }],
    tasks: tasks as BriefingInput["tasks"],
    rooms: [{ id: "r1", number: "1715", status: "outOfOrder" }],
    shifts: days.flatMap((d) => Array.from({ length: 10 }, (_, k) => ({ day: d, department: "housekeeping", status: d === yesterday && k < 4 ? "absent" : "completed" }))),
    alerts: [],
    insights: [
      { id: "i1", rule: "stockout", category: "inventory", title: "پیش‌بینی اتمام «Shampoo 30 ml» تا 2 روز آینده", priority: "high" },
      { id: "i2", rule: "weekdayOccupancy", category: "revenue", title: "فاصلهٔ 18 واحدی اشغال آخر هفته", priority: "medium" },
      { id: "i3", rule: "repeatFailure", category: "maintenance", title: "5 خرابی تکراری در Laundry (B1) طی ۳۰ روز", priority: "high" },
    ],
    actions: [{ id: "a1", insight: "i1", priority: "high" }],
    ...overrides,
  } as BriefingInput;
}

describe("morning briefing (F4)", () => {
  it("robust z: needs 14 days, ignores one outlier in the history", () => {
    expect(robustZ(10, [1, 2, 3])).toBeNull();
    const h = Array.from({ length: 20 }, (_, i) => 100 + (i % 5));
    h[3] = 1000;
    const rz = robustZ(140, h)!;
    expect(rz.median).toBe(102);
    expect(rz.z).toBeGreaterThan(3);
  });

  it("finds yesterday's anomalies and links them to possible causes", () => {
    const items = buildItems(input());
    const energy = items.find((i) => i.id === "energy_electricity")!;
    expect(energy.kind).toBe("anomaly");
    expect(energy.cause).toContain("ممکن است مرتبط باشد با 1 تیکت باز HVAC");
    expect(energy.facts.counts.energy_electricity_openHvacTickets).toBe(1);
    const clean = items.find((i) => i.id === "housekeeping_clean")!;
    expect(clean.cause).toContain("غیبت 4 نفر");
    const stock = items.find((i) => i.id === "insight_i1")!;
    expect(stock).toMatchObject({ kind: "insight", category: "inventory", actionId: "a1" });
    expect(stock.facts.windows).toEqual({ i1_0: 2 });
    expect(items.find((i) => i.id === "insight_i3")!.facts.counts).toEqual({ i3_tickets_0: 5 });
    expect(items.find((i) => i.id === "rooms_ooo")!.facts.roomsNow).toEqual({ outOfOrder: 1 });
  });

  it("uses the F2 model for a meter that has one, instead of the raw median", () => {
    const yesterday = shiftDay(TODAY, -1);
    const items = buildItems(input({
      energyModel: [{
        type: "electricity", valid: true, kind: "weather", cvrmseMonthly: 2.1, unit: "kWh",
        days: [
          { day: shiftDay(TODAY, -2), expected: 3500, actual: 4300, deviationPct: 22.9, spike: true, drift: false, usedWeather: true, seasonCovered: true },
          { day: yesterday, expected: 3400, actual: 4200, deviationPct: 23.5, spike: true, drift: true, usedWeather: true, seasonCovered: true },
        ],
      }],
    }));
    const e = items.find((i) => i.id === "energy_electricity")!;
    expect(e.finding).toContain("23.5٪ بیشتر از 3,400 kWh موردانتظار مدل (با دما و اشغال)");
    expect(e.finding).toContain("2 روز پیاپی");
    expect(e.facts.values.energy_electricity_median).toBeUndefined();
  });

  it("per role: only its categories; revenue only with finance.view; most severe first, at most 7", () => {
    const items = buildItems(input());
    const hk = itemsForRole(items, perms("housekeepingManager"));
    expect(new Set(hk.map((i) => i.category))).toEqual(new Set(["occupancy", "housekeeping", "inventory", "staffing"]));
    expect(itemsForRole(items, perms("operationsManager")).some((i) => i.finance)).toBe(false);
    expect(itemsForRole(items, perms("generalManager")).some((i) => i.finance)).toBe(true);
    const gm = itemsForRole(items, perms("generalManager"));
    expect(gm.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < gm.length; i++) expect(gm[i - 1].severity).toBeGreaterThanOrEqual(gm[i].severity);
  });

  it("the text quotes only what is in the facts, and says so when there is nothing", () => {
    const items = itemsForRole(buildItems(input()), perms("generalManager"));
    const text = briefingText(items, TODAY);
    expect(text.split("\n")[0]).toBe(`گزارش صبحگاهی ${TODAY}`);
    expect(text).toContain("علت احتمالی");
    const facts = JSON.stringify(factsOf(items, TODAY));
    for (const n of text.replace(/^\d+\. /gm, "").replace(/\d{4}-\d{2}-\d{2}/g, "").match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []) {
      expect(facts, n).toContain(n.replace(/,/g, "").replace(/\.0$/, ""));
    }
    expect(briefingText([], TODAY)).toContain("دادهٔ کافی");
  });
});
