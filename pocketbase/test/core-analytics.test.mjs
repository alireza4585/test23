// Unit tests of the deterministic analytics core as bundled for PocketBase
// (pb_hooks/lib/core.js): calendar, forecasting, energy baselines, evaluation.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const core = createRequire(import.meta.url)("../pb_hooks/lib/core.js");

/** Deterministic pseudo-random noise in [-1, 1]. */
function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648) * 2 - 1;
  };
}

describe("calendar", () => {
  it("converts Jalali dates (Nowruz and fixed holidays)", () => {
    expect(core.jalaliToDay(1402, 1, 1)).toBe("2023-03-21");
    expect(core.jalaliToDay(1403, 1, 1)).toBe("2024-03-20");
    expect(core.jalaliToDay(1404, 1, 1)).toBe("2025-03-21");
    expect(core.jalaliToDay(1405, 1, 1)).toBe("2026-03-21");
    expect(core.jalaliToDay(1404, 11, 22)).toBe("2026-02-11");
    expect(core.jalaliToDay(1404, 7, 1)).toBe("2025-09-23");
  });

  it("round-trips every day of three years", () => {
    for (let d = "2024-01-01"; d <= "2026-12-31"; d = core.shiftDay(d, 1)) {
      const { jy, jm, jd } = core.dayToJalali(d);
      expect(core.jalaliToDay(jy, jm, jd)).toBe(d);
    }
  });

  it("lists Iran's fixed solar holidays in a range", () => {
    const h = core.iranFixedHolidays("2026-03-01", "2026-06-30");
    expect(h.map((x) => x.day)).toEqual([
      "2026-03-20", // 29 Esfand 1404
      "2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24", // Nowruz 1405
      "2026-04-01", "2026-04-02", // 12 and 13 Farvardin
      "2026-06-04", "2026-06-05", // 14 and 15 Khordad
    ]);
    expect(core.daySet([{ day: "2026-01-30", endDay: "2026-02-01", kind: "x", title: "x" }]).size).toBe(3);
  });
});

describe("forecasting", () => {
  const weekly = [40, 42, 41, 43, 55, 60, 45]; // Sun … Sat
  const series = (days, start = "2026-01-04", seed = 7, level = 0) => {
    const r = noise(seed);
    return Array.from({ length: days }, (_, i) => {
      const day = core.shiftDay(start, i);
      return { day, value: weekly[core.weekdayOf(day)] + level * i + r() * 2 };
    });
  };

  it("refuses short or gappy history", () => {
    expect(core.forecastSeries(series(20), { horizon: 7 }).reason).toBe("insufficient_history");
    const gappy = series(60).map((p, i) => (i % 3 === 0 ? { ...p, value: null } : p));
    expect(core.forecastSeries(gappy, { horizon: 7 }).reason).toBe("too_many_gaps");
  });

  it("forecasts a weekly pattern with intervals and never loses to seasonal naive", () => {
    const f = core.forecastSeries(series(120), { horizon: 28, min: 0, max: 100 });
    expect(f.ok).toBe(true);
    expect(f.points).toHaveLength(28);
    expect(f.points[0].day).toBe(core.shiftDay("2026-01-04", 120));
    const naive = f.scores.find((s) => s.model === "seasonalNaive");
    const chosen = f.scores.find((s) => s.model === f.model);
    expect(chosen.mae).toBeLessThanOrEqual(naive.mae);
    for (const p of f.points) {
      expect(p.lower).toBeLessThanOrEqual(p.value);
      expect(p.upper).toBeGreaterThanOrEqual(p.value);
      expect(Math.abs(p.value - weekly[core.weekdayOf(p.day)])).toBeLessThan(6);
    }
  });

  it("follows a trend that seasonal naive cannot", () => {
    const f = core.forecastSeries(series(150, "2026-01-04", 3, 0.3), { horizon: 14 });
    expect(f.model).not.toBe("seasonalNaive");
    const naive = f.scores.find((s) => s.model === "seasonalNaive");
    expect(f.scores.find((s) => s.model === f.model).mae).toBeLessThan(naive.mae);
  });

  it("learns holiday effects through the calendar regression", () => {
    const special = new Set();
    const r = noise(11);
    const pts = Array.from({ length: 200 }, (_, i) => {
      const day = core.shiftDay("2025-06-01", i);
      if (i % 17 === 0) special.add(day);
      return { day, value: 50 + (special.has(day) ? 30 : 0) + r() };
    });
    const next = core.shiftDay("2025-06-01", 203);
    special.add(next);
    const f = core.forecastSeries(pts, { horizon: 7, special });
    expect(f.model).toBe("calendarRegression");
    expect(f.points.find((p) => p.day === next).value).toBeGreaterThan(70);
  });

  it("clamps occupancy to its range", () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ day: core.shiftDay("2026-01-01", i), value: 99 + (i % 7 === 3 ? 1 : 0) }));
    for (const p of core.forecastSeries(pts, { horizon: 14, min: 0, max: 100 }).points) expect(p.upper).toBeLessThanOrEqual(100);
  });
});

describe("energy baseline", () => {
  const history = (days, seed = 5) => {
    const r = noise(seed);
    return Array.from({ length: days }, (_, i) => {
      const occupied = 30 + ((i * 7) % 25);
      return { day: core.shiftDay("2025-09-01", i), occupied, consumption: 1500 + 18 * occupied + r() * 40 };
    });
  };

  it("fits consumption against occupancy with Guideline 14 statistics", () => {
    const m = core.fitBaseline(history(90));
    expect(m.valid).toBe(true);
    expect(m.coef[1]).toBeGreaterThan(16);
    expect(m.coef[1]).toBeLessThan(20);
    expect(m.cvrmse).toBeLessThan(3);
    expect(Math.abs(m.nmbe)).toBeLessThan(0.5);
    expect(core.fitBaseline(history(20))).toBeNull();
  });

  it("drops a past spike before fitting", () => {
    const h = history(90);
    h[40].consumption *= 2;
    const m = core.fitBaseline(h);
    expect(m.dropped).toBe(1);
    expect(m.cvrmse).toBeLessThan(3);
  });

  it("flags readings far above expectation, scaled by occupancy", () => {
    const m = core.fitBaseline(history(90));
    const day = "2025-12-15";
    const busy = core.checkReading(m, day, 60, 1500 + 18 * 60, 15);
    expect(busy.anomaly).toBe(false); // high, but explained by occupancy
    const spike = core.checkReading(m, day, 30, (1500 + 18 * 30) * 1.4, 15);
    expect(spike.anomaly).toBe(true);
    expect(spike.critical).toBe(true);
    expect(core.checkReading(m, day, 30, (1500 + 18 * 30) * 1.1, 15).anomaly).toBe(false); // under the hotel threshold
  });

  it("measures savings with CUSUM and an uncertainty band", () => {
    const m = core.fitBaseline(history(90));
    const after = history(14, 9).map((r, i) => ({ ...r, day: core.shiftDay("2025-12-01", i), consumption: r.consumption * 0.9 }));
    const res = core.measureEnergy(m, after);
    expect(res.days).toHaveLength(14);
    expect(res.savings).toBeGreaterThan(0);
    expect(res.significant).toBe(true);
    expect(res.days[13].cusum).toBeCloseTo(-res.savings, 0);
    const same = core.measureEnergy(m, history(14, 21).map((r, i) => ({ ...r, day: core.shiftDay("2025-12-01", i) })));
    expect(same.significant).toBe(false);
  });
});

describe("recommendation evaluation", () => {
  const win = { afterFrom: "2026-01-01", afterTo: "2026-01-14" };

  it("reports energy savings only when they exceed the uncertainty", () => {
    const r = noise(2);
    const base = Array.from({ length: 60 }, (_, i) => ({ day: core.shiftDay("2025-11-01", i), occupied: 40 + (i % 10), consumption: 2000 + 15 * (40 + (i % 10)) + r() * 30 }));
    const model = core.fitBaseline(base);
    const after = Array.from({ length: 14 }, (_, i) => ({ day: core.shiftDay("2026-01-01", i), occupied: 45, consumption: (2000 + 15 * 45) * 0.92 }));
    const e = core.evaluateEnergy(model, after, 3200, win);
    expect(e.status).toBe("evaluated");
    expect(e.improved).toBe(true);
    expect(e.monthlyIrr).toBeGreaterThan(0);
    expect(core.evaluateEnergy(model, after.slice(0, 5), 3200, win).status).toBe("insufficientData");
    expect(core.evaluateEnergy(null, after, 3200, win).status).toBe("insufficientData");
  });

  it("compares means and counts, and calls small differences inconclusive", () => {
    const before = [44, 46, 45, 47, 43, 45, 46];
    expect(core.evaluateMean("durationAvg", "min", before, [36, 35, 37, 34, 36, 35, 36], win).improved).toBe(true);
    expect(core.evaluateMean("durationAvg", "min", before, [45, 44, 46, 45, 47, 44, 45], win).status).toBe("inconclusive");
    expect(core.evaluateMean("durationAvg", "min", before, [40, 41], win).status).toBe("insufficientData");
    expect(core.evaluateCount("ticketCount", "tickets", 12, 2, win).improved).toBe(true);
    expect(core.evaluateCount("ticketCount", "tickets", 3, 2, win).status).toBe("inconclusive");
    expect(core.evaluateOutcome("stockout", false, "no stock-out", win).improved).toBe(true);
  });
});

describe("insight drafts", () => {
  it("carry the expected impact and evaluation method", () => {
    const today = "2026-02-20";
    const operations = Array.from({ length: 30 }, (_, i) => ({ day: core.shiftDay(today, -30 + i), roomsAvailable: 60, roomsOccupied: 40, roomRevenue: 40 * 1e6 }));
    const energy = operations.map((o, i) => ({ day: o.day, type: "electricity", consumption: i >= 26 ? 3000 : 2400 }));
    const drafts = core.generateInsights({
      today, now: new Date(`${today}T06:00:00Z`), addDays: core.shiftDay, settings: core.DEFAULT_SETTINGS,
      operations, energy, tickets: [], tasks: [], items: [], movements: [], rooms: [],
    });
    const e = drafts.find((d) => d.rule === "energyIntensity");
    expect(e.expectedImpact).toMatchObject({ method: "energyBaseline", unit: "kWh", baseline: 75, expected: 60 });
    expect(e.expectedImpact.monthlyIrr).toBe(e.estimatedMonthlySaving);
  });
});
