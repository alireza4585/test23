// AI phase 1, F2: weather-normalised energy models on the server — weather
// back-fill through the adapter, fit and quality gate, scoring into
// energyExpected, alerts, the insight, the signed weather route and the
// "insufficient data" path. All data is synthetic, in trial hotels.
import { describe, expect, it } from "vitest";

import { NID, errorOf, hotelId, login, signed, superuser } from "./helpers.mjs";
import { addDays, temperature } from "./weather-fixture.mjs";

const NOW = "2026-10-07T06:00:00Z"; // 09:30 Tehran
const TODAY = "2026-10-07";
const FIRST = "2025-09-01";
const FAULT_FROM = "2026-10-03";

const importRecords = (pb, body) => pb.send("/api/zarin/admin/import", { method: "POST", body });
const analytics = (pb, id, body) => pb.send(`/api/zarin/admin/hotels/${id}/analytics`, { method: "POST", body });

function wobble(day, salt) {
  let h = 2166136261 ^ salt;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1;
}

/** Synthetic day: occupancy, and electricity driven by occupancy and the fixture temperature. */
function synthetic(day) {
  const occupied = Math.round(300 + 40 * wobble(day, 1));
  const t = temperature(day);
  const cool = Math.max(0, t - 18);
  const heat = Math.max(0, 12 - t);
  let kwh = (9000 + 18 * occupied + 260 * cool + 180 * cool * (occupied / 340) + 220 * heat) * (1 + 0.015 * wobble(day, 2));
  if (day >= FAULT_FROM) kwh *= 1.25;
  return { occupied, kwh: Math.round(kwh) };
}

async function trialHotel(su, name, { days, location = { lat: 35.75, lon: 51.33 }, flag = true } = {}) {
  const hotel = await su.collection("hotels").create({
    name, status: "trial", settings: { location, features: { energyBaseline: flag } },
  });
  const ops = [];
  const energy = [];
  for (let d = addDays(TODAY, -days); d < TODAY; d = addDays(d, 1)) {
    const s = synthetic(d);
    ops.push({ fields: { day: d, roomsAvailable: 400, roomsOccupied: s.occupied, guests: s.occupied + 50, source: "import" } });
    energy.push({ fields: { type: "electricity", day: d, consumption: s.kwh, unit: "kWh", source: "smartMeter" } });
  }
  for (let i = 0; i < ops.length; i += 500) await importRecords(su, { hotel: hotel.id, collection: "dailyOperations", records: ops.slice(i, i + 500) });
  for (let i = 0; i < energy.length; i += 500) await importRecords(su, { hotel: hotel.id, collection: "energyReadings", records: energy.slice(i, i + 500) });
  return hotel.id;
}

describe("F2 energy model (server)", () => {
  it("back-fills weather, fits a valid weather model, scores days and alerts on the fault", async () => {
    const su = await superuser();
    const days = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${FIRST}T00:00:00Z`)) / 864e5);
    const H = await trialHotel(su, "F2 trial", { days });
    // An imported dataset temperature is never overwritten by the provider.
    await importRecords(su, { hotel: H, collection: "weatherDaily", records: [{ fields: { day: "2026-01-15", tMean: 4.2, source: "import" } }] });

    const res = await analytics(su, H, { energy: true, insights: true, now: NOW });
    const e = res.energy;
    expect(e.weather.provider).toBe("open_meteo");
    expect(e.weather.from).toBe(addDays(TODAY, -365));
    expect(e.weather.written).toBe(364); // 365 days minus the imported one
    const elec = e.types.electricity;
    expect(elec.refit.ok).toBe(true);
    expect(elec.refit.kind).toBe("weather");
    expect(elec.refit.valid).toBe(true);
    expect(elec.refit.stats.cvrmseMonthly).toBeLessThan(15);
    expect((await su.collection("weatherDaily").getFirstListItem(`hotel = "${H}" && day = "2026-01-15"`)).tMean).toBe(4.2);

    const model = await su.collection("energyModels").getFirstListItem(`hotel = "${H}" && status = "active"`);
    expect(model).toMatchObject({ type: "electricity", kind: "weather", valid: true, weatherSource: "open_meteo" });
    expect(model.spec.tbCool).toBeGreaterThanOrEqual(16);
    expect(model.spec.tbCool).toBeLessThanOrEqual(20);
    expect(model.stats.candidates.length).toBeGreaterThanOrEqual(2);

    // 35 days scored; the fault days are flagged, the days before are not.
    const rows = await su.collection("energyExpected").getFullList({ filter: `hotel = "${H}"`, sort: "day" });
    expect(rows.length).toBe(35);
    expect(rows.every((r) => r.hasActual && r.hasWeather && r.upper > r.expected && r.lower < r.expected)).toBe(true);
    const flagged = rows.filter((r) => r.flags.spike || r.flags.drift).map((r) => r.day);
    expect(flagged[0]).toBe(FAULT_FROM);
    expect(flagged.every((d) => d >= FAULT_FROM)).toBe(true);
    expect(elec.flagged.map((f) => f.day)).toEqual(flagged);

    // Alerts only for the last 3 days (no flood when back-filling), and the F2 insight.
    const alerts = await su.collection("alerts").getFullList({ filter: `hotel = "${H}" && type = "energySpike"` });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.data.day >= addDays(TODAY, -3) && a.data.method === "model")).toBe(true);
    const insight = await su.collection("aiInsights").getFirstListItem(`hotel = "${H}" && key = "energyModel_electricity"`);
    expect(insight.priority).toBe("high");
    expect(insight.summary).toContain("با در نظر گرفتن دما و اشغال");
    expect(insight.expectedImpact.method).toBe("energyBaseline");
    // The crude intensity rule stays quiet while a valid model covers electricity.
    expect((await su.collection("aiInsights").getList(1, 1, { filter: `hotel = "${H}" && key = "energyIntensity_electricity"` })).totalItems).toBe(0);

    // A live reading is scored at once against the stored model (hook path; it needs the day's occupancy).
    const today = synthetic(TODAY);
    await importRecords(su, { hotel: H, collection: "dailyOperations", records: [{ fields: { day: TODAY, roomsAvailable: 400, roomsOccupied: today.occupied, source: "import" } }] });
    const live = await signed(`/v1/hotels/${H}/energy/readings`, { method: "POST", body: { type: "electricity", day: TODAY, consumption: today.kwh, source: "smartMeter" } });
    expect(live.status).toBe(200);
    const scored = await su.collection("energyExpected").getFirstListItem(`hotel = "${H}" && day = "${TODAY}"`);
    expect(scored.flags.spike || scored.flags.drift).toBe(true);
    const alert = await su.collection("alerts").getFirstListItem(`hotel = "${H}" && (dedupeKey = "energy_${TODAY}_electricity" || dedupeKey = "energy_drift_electricity_${TODAY}")`);
    expect(alert.data.method).toBe("model");
    // Today's temperature is not fetched yet: the no-weather fallback scored it, and says so.
    expect(scored.hasWeather).toBe(false);
    expect(alert.message).toContain("بدون دادهٔ دما");
  });

  it("under 90 days: a rejected model that says how much data is missing, and no scores", async () => {
    const su = await superuser();
    const H = await trialHotel(su, "F2 short", { days: 30 });
    const res = await analytics(su, H, { energy: true, now: NOW });
    expect(res.energy.types.electricity.refit).toEqual({ ok: false, reason: "insufficient_data", have: 30, need: 90 });
    const model = await su.collection("energyModels").getFirstListItem(`hotel = "${H}"`);
    expect(model).toMatchObject({ status: "rejected", valid: false, reason: "insufficient_data: 30 of 90 days" });
    expect((await su.collection("energyExpected").getList(1, 1, { filter: `hotel = "${H}"` })).totalItems).toBe(0);
    // A second night keeps one rejected record, not one per night.
    await analytics(su, H, { energy: true, now: "2026-10-08T06:00:00Z" });
    expect((await su.collection("energyModels").getList(1, 5, { filter: `hotel = "${H}"` })).totalItems).toBe(1);
  });

  it("without a location or with the flag off, nothing is fetched or fitted", async () => {
    const su = await superuser();
    const H = await trialHotel(su, "F2 no location", { days: 10, location: null });
    expect((await analytics(su, H, { energy: true, now: NOW })).energy.weather).toEqual({ provider: "open_meteo", skipped: "no_location" });
    const off = await trialHotel(su, "F2 flag off", { days: 10, flag: false });
    expect((await analytics(su, off, { energy: true, now: NOW })).energy).toEqual({ skipped: "feature_disabled" });
  });

  it("the signed weather route validates, labels the source and keeps imported rows", async () => {
    const su = await superuser();
    const H = (await su.collection("hotels").create({ name: "F2 push", status: "trial", settings: {} })).id;
    await importRecords(su, { hotel: H, collection: "weatherDaily", records: [{ fields: { day: "2026-10-01", tMean: 20, source: "import" } }] });
    const ok = await signed(`/v1/hotels/${H}/weather`, {
      method: "POST", body: { source: "n8n-openmeteo", days: [{ day: "2026-10-01", tMean: 22 }, { day: "2026-10-02", tMin: 14, tMax: 26 }] },
    });
    expect(ok, JSON.stringify(ok.json)).toEqual({ status: 200, json: { written: 1, skipped: 1 } });
    const row = await su.collection("weatherDaily").getFirstListItem(`hotel = "${H}" && day = "2026-10-02"`);
    expect(row).toMatchObject({ tMean: 20, tMin: 14, tMax: 26, hasRange: true, source: "push:n8n-openmeteo" });
    expect((await su.collection("weatherDaily").getFirstListItem(`hotel = "${H}" && day = "2026-10-01"`)).source).toBe("import");
    const bad = await signed(`/v1/hotels/${H}/weather`, { method: "POST", body: { days: [{ day: "2026-10-03", tMean: 99 }] } });
    expect([bad.status, bad.json.data.code.code]).toEqual([400, "invalid_weather_day"]);
    const unsigned = await fetch(`${(await superuser()).baseURL}/v1/hotels/${H}/weather`, { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
  });

  it("energy models and scores are readable only with energy.view", async () => {
    const su = await superuser();
    const model = await su.collection("energyModels").create({ hotel: hotelId(), type: "water", kind: "occupancy", status: "rejected", reason: "test" });
    try {
      expect((await (await login(NID.energy)).collection("energyModels").getList(1, 5, { filter: `id = "${model.id}"` })).totalItems).toBe(1);
      expect((await (await login(NID.housekeeper)).collection("energyModels").getList(1, 5, { filter: `id = "${model.id}"` })).totalItems).toBe(0);
      expect((await errorOf((await login(NID.energy)).collection("energyModels").create({ hotel: hotelId(), type: "gas", kind: "occupancy", status: "active" }))).status).toBeGreaterThanOrEqual(400);
    } finally {
      await su.collection("energyModels").delete(model.id);
    }
  });
});
