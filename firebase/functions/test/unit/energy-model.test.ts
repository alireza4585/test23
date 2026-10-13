import { describe, expect, it } from "vitest";

import { shiftDay } from "../../src/analytics/calendar";
import {
  MAX_EXCLUDED_DAYS_PER_MONTH,
  MIN_MODEL_DAYS,
  ModelDay,
  exclusionMonth,
  fitEnergyModel,
  predictDay,
  scoreDay,
} from "../../src/analytics/energy-model";

/** Deterministic PRNG (mulberry32) and a Box–Muller normal. */
function rng(seed: number) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(uni() + 1e-12)) * Math.cos(2 * Math.PI * uni());
  return { uni, normal };
}

const START = "2025-01-01";

/**
 * Synthetic hotel: cooling above 18 °C (partly occupancy-driven), heating
 * below 12 °C, 2 % noise. [heatWave] adds +7 °C on its days (the load follows
 * the temperature, so a weather model should not alarm); [fault] multiplies
 * consumption on its days (a real fault).
 */
function hotel(days: number, opts: { seed?: number; heatWave?: [string, number]; fault?: [string, number, number] } = {}): ModelDay[] {
  const r = rng(opts.seed ?? 7);
  const out: ModelDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = shiftDay(START, i);
    let t = 17 + 13 * Math.sin((2 * Math.PI * (i - 100)) / 365) + 2 * r.normal();
    if (opts.heatWave && day >= opts.heatWave[0] && day < shiftDay(opts.heatWave[0], opts.heatWave[1])) t += 7;
    const occupied = Math.round(260 + 80 * r.uni());
    const cool = Math.max(0, t - 18);
    const heat = Math.max(0, 12 - t);
    let kwh = 9000 + 18 * occupied + 260 * cool + 180 * cool * (occupied / 340) + 220 * heat;
    kwh *= 1 + 0.02 * r.normal();
    if (opts.fault && day >= opts.fault[0] && day < shiftDay(opts.fault[0], opts.fault[1])) kwh *= 1 + opts.fault[2];
    out.push({ day, consumption: Math.round(kwh), occupied, tMean: Math.round(t * 10) / 10 });
  }
  return out;
}

/** Scores [days] in order; returns the days on which a spike or drift fired. */
function alarms(model: Parameters<typeof scoreDay>[0], days: ModelDay[], thresholdPct = 15): string[] {
  let cusum = 0;
  const out: string[] = [];
  for (const d of days) {
    const s = scoreDay(model, d, cusum, thresholdPct);
    if (!s) continue;
    cusum = s.cusum;
    if (s.spike || s.drift) out.push(d.day);
  }
  return out;
}

describe("weather-normalised energy model (F2)", () => {
  it("finds the balance temperatures and passes the monthly CV(RMSE) gate", () => {
    const res = fitEnergyModel(hotel(365));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const m = res.model;
    expect(m.kind).toBe("weather");
    expect(m.valid).toBe(true);
    expect(m.tbCool).toBeGreaterThanOrEqual(17);
    expect(m.tbCool).toBeLessThanOrEqual(19);
    expect(m.tbHeat).toBeGreaterThanOrEqual(11);
    expect(m.tbHeat).toBeLessThanOrEqual(13);
    expect(m.stats.months).toBeGreaterThanOrEqual(11);
    expect(m.stats.cvrmseMonthly!).toBeLessThan(15);
    // The weather model beats the models without temperature on this hotel.
    const others = res.candidates.filter((c) => c.kind !== "weather");
    for (const c of others) expect(m.stats.cvrmseDaily).toBeLessThan(c.cvrmseDaily);
    expect(m.fallback).not.toBeNull();
  });

  it("says 'insufficient data' under 90 days, and the gate needs 3 full months", () => {
    const short = fitEnergyModel(hotel(MIN_MODEL_DAYS - 1));
    expect(short).toEqual({ ok: false, reason: "insufficient_data", have: MIN_MODEL_DAYS - 1, need: MIN_MODEL_DAYS });
    const res = fitEnergyModel(hotel(MIN_MODEL_DAYS));
    expect(res.ok).toBe(true);
    if (res.ok && res.model.stats.months < 3) {
      expect(res.model.valid).toBe(false);
      expect(res.model.reason).toMatch(/^insufficient_months/);
    }
  });

  it("without any temperature, falls back to a model without weather", () => {
    const res = fitEnergyModel(hotel(365).map((d) => ({ ...d, tMean: null })));
    expect(res.ok && res.model.kind).not.toBe("weather");
  });

  it("uses the no-weather fallback on a day whose temperature is missing", () => {
    const res = fitEnergyModel(hotel(365));
    if (!res.ok) throw new Error("fit failed");
    const day = { day: shiftDay(START, 365), consumption: 20000, occupied: 300, tMean: null };
    const p = predictDay(res.model, day)!;
    expect(p.usedWeather).toBe(false);
    expect(p.kind).toBe(res.model.fallback!.kind);
  });

  it("a heat wave alarms a model without weather but not the weather model", () => {
    const wave: [string, number] = [shiftDay(START, 560), 8]; // mid-July of the second year
    const all = hotel(600, { heatWave: wave });
    const train = all.slice(0, 365 + 150);
    const test = all.slice(365 + 150);
    const withWeather = fitEnergyModel(train);
    const without = fitEnergyModel(train.map((d) => ({ ...d, tMean: null })));
    if (!withWeather.ok || !without.ok) throw new Error("fit failed");
    const inWave = (d: string) => d >= wave[0] && d < shiftDay(wave[0], wave[1]);
    expect(alarms(withWeather.model, test).filter(inWave)).toEqual([]);
    expect(alarms(without.model, test).filter(inWave).length).toBeGreaterThan(0);
  });

  it("detects a sustained 20 % fault within 3 days", () => {
    for (const offset of [380, 470, 560, 650]) { // one per season of the second year
      const start = shiftDay(START, offset);
      const all = hotel(offset + 30, { fault: [start, 30, 0.2], seed: offset });
      const model = fitEnergyModel(all.slice(offset - 365, offset));
      if (!model.ok) throw new Error("fit failed");
      const first = alarms(model.model, all.slice(offset))[0];
      expect(first, start).toBeDefined();
      expect(Date.parse(first) - Date.parse(start), start).toBeLessThanOrEqual(2 * 864e5); // day 1, 2 or 3
    }
  });

  it("excluding fault days within the cap cannot hide a sustained 20 % fault", () => {
    // Worst case: the model is refitted after a 40-day fault, so the fault sits
    // inside its training window, and the maximum allowed days are excluded.
    const offset = 470;
    const start = shiftDay(START, offset);
    const all = hotel(offset + 40, { fault: [start, 40, 0.2], seed: 11 });
    const faultDays = all.slice(offset).map((d) => d.day);
    const perMonth: Record<string, number> = {};
    const excluded = faultDays.filter((d) => {
      const k = exclusionMonth(d);
      perMonth[k] = (perMonth[k] || 0) + 1;
      return perMonth[k] <= MAX_EXCLUDED_DAYS_PER_MONTH;
    });
    const allowed = Object.keys(perMonth).reduce((n, k) => n + Math.min(perMonth[k], MAX_EXCLUDED_DAYS_PER_MONTH), 0);
    expect(excluded.length).toBe(allowed);
    expect(excluded.length).toBeLessThan(faultDays.length / 2);
    const res = fitEnergyModel(all.slice(offset + 40 - 365), excluded);
    if (!res.ok) throw new Error("fit failed");
    expect(res.model.stats.excluded).toBe(excluded.length);
    // Exclusion only keeps days out of the fit: the fault days are still scored and still alarm.
    const flagged = alarms(res.model, all.slice(offset));
    expect(flagged.length).toBeGreaterThan(0);
    expect(Date.parse(flagged[0]) - Date.parse(start)).toBeLessThanOrEqual(2 * 864e5);
    // And the fault is still visible in the residuals: at least ~10 % above expected on average.
    const dev = all.slice(offset).map((d) => scoreDay(res.model, d, 0, 15)!.deviationPct);
    expect(dev.reduce((s, v) => s + v, 0) / dev.length).toBeGreaterThan(10);
  });

  it("labels days of a season the model has not seen as low-confidence", () => {
    const all = hotel(240); // January to August of the first year
    const res = fitEnergyModel(all.slice(0, 150)); // trained on January–May only
    if (!res.ok) throw new Error("fit failed");
    expect(res.model.stats.coveredMonths.length).toBeGreaterThan(3);
    const may = scoreDay(res.model, all[140], 0, 15)!;
    const august = scoreDay(res.model, all[230], 0, 15)!;
    expect(may.seasonCovered).toBe(true);
    expect(august.seasonCovered).toBe(false);
  });

  it("stays quiet on a healthy year (≤ 2 alarms a month)", () => {
    const all = hotel(365 + 180, { seed: 3 });
    const res = fitEnergyModel(all.slice(0, 365));
    if (!res.ok) throw new Error("fit failed");
    const byMonth: Record<string, number> = {};
    for (const d of alarms(res.model, all.slice(365))) byMonth[exclusionMonth(d)] = (byMonth[exclusionMonth(d)] || 0) + 1;
    for (const k of Object.keys(byMonth)) expect(byMonth[k], k).toBeLessThanOrEqual(2);
  });
});
