// AI core on a live server: forecasts, model-based energy alerts, energy
// analysis, recommendation decisions, auto-close and evaluation, calendar.
import { describe, expect, it } from "vitest";

import { client, errorOf, hotelId, login, NID, post, superuser } from "./helpers.mjs";

const importRecords = (pb, body) => pb.send("/api/zarin/admin/import", { method: "POST", body });
const analytics = (pb, id, body) => pb.send(`/api/zarin/admin/hotels/${id}/analytics`, { method: "POST", body });
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Trial hotel with [days] days of operations and electricity (1500 + 18·occupied ± noise), imported quietly. */
async function trialHotel(su, { days = 70, start = "2026-01-01", factor = () => 1 } = {}) {
  const hotel = await su.collection("hotels").create({
    name: `AI core ${Math.random().toString(36).slice(2, 8)}`, status: "trial",
    settings: { energyDailyBaseline: { electricity: 2000 }, energyTariff: { electricity: 3000 }, energyAlertThresholdPct: 15 },
  });
  const ops = [];
  const energy = [];
  let s = 17;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const occupied = 30 + ((i * 7) % 20);
    ops.push({ fields: { day, roomsAvailable: 60, roomsOccupied: occupied, roomRevenue: occupied * 9e7, source: "import" } });
    energy.push({ fields: { day, type: "electricity", unit: "kWh", consumption: (1500 + 18 * occupied + rnd() * 40) * factor(i), source: "import" } });
  }
  await importRecords(su, { hotel: hotel.id, collection: "dailyOperations", records: ops });
  await importRecords(su, { hotel: hotel.id, collection: "energyReadings", records: energy });
  return { id: hotel.id, start, days, last: addDays(start, days - 1) };
}

describe("forecasts", () => {
  it("are computed with backtest scores, stored per day and readable by managers only", async () => {
    const su = await superuser();
    const h = await trialHotel(su);
    const res = await analytics(su, h.id, { forecasts: true, now: `${addDays(h.last, 1)}T06:00:00Z` });
    expect(res.forecasts.occupancy).toMatch(/seasonalNaive|holtWinters|calendarRegression/);
    expect(res.forecasts.water).toBe("skipped: no_data");
    const runs = await su.collection("forecastRuns").getFullList({ filter: `hotel = "${h.id}"` });
    expect(runs).toHaveLength(6);
    const occ = runs.find((r) => r.series === "occupancy");
    expect(occ.ok).toBe(true);
    expect(occ.trainedTo).toBe(h.last);
    const naive = occ.scores.find((x) => x.model === "seasonalNaive");
    expect(occ.scores.find((x) => x.model === occ.model).mae).toBeLessThanOrEqual(naive.mae);
    const points = await su.collection("forecasts").getFullList({ filter: `hotel = "${h.id}" && series = "occupancy"`, sort: "day" });
    expect(points).toHaveLength(28);
    expect(points[0].day).toBe(addDays(h.last, 1));
    expect(points.every((p) => p.lower <= p.value && p.value <= p.upper && p.upper <= 100)).toBe(true);

    // Run again a week later with the actuals in: next-day accuracy of the stored forecasts.
    const more = Array.from({ length: 7 }, (_, i) => ({ fields: { day: addDays(h.last, i + 1), roomsAvailable: 60, roomsOccupied: 40, roomRevenue: 40 * 9e7, source: "import" } }));
    await importRecords(su, { hotel: h.id, collection: "dailyOperations", records: more });
    await analytics(su, h.id, { forecasts: true, now: `${addDays(h.last, 8)}T06:00:00Z` });
    const again = await su.collection("forecastRuns").getFirstListItem(`hotel = "${h.id}" && series = "occupancy"`);
    expect(again.live.days).toBe(7);
    expect(again.live.mae).toBeGreaterThanOrEqual(0);
  });

  it("are not published from stale data", async () => {
    const su = await superuser();
    const h = await trialHotel(su, { days: 40 });
    await analytics(su, h.id, { forecasts: true, now: `${addDays(h.last, 20)}T06:00:00Z` });
    const occ = await su.collection("forecastRuns").getFirstListItem(`hotel = "${h.id}" && series = "occupancy"`);
    expect(occ.ok).toBe(false);
    expect(occ.reason).toBe("stale_data");
  });

  it("can be refreshed by executives, not by staff or other hotels", async () => {
    const gm = await login(NID.gm);
    const res = await post(gm, `/api/zarin/hotels/${hotelId()}/forecasts/run`, {});
    expect(Object.keys(res.series).sort()).toEqual(["electricity", "gas", "occupancy", "roomRevenue", "totalRevenue", "water"]);
    expect((await gm.collection("forecasts").getList(1, 1, { filter: `hotel = "${hotelId()}"` })).totalItems).toBeGreaterThan(0);
    const housekeeper = await login(NID.housekeeper);
    expect((await errorOf(post(housekeeper, `/api/zarin/hotels/${hotelId()}/forecasts/run`, {}))).code).toBe("missing_permission");
    expect((await housekeeper.collection("forecasts").getList(1, 1)).totalItems).toBe(0);
    const su = await superuser();
    const other = await trialHotel(su, { days: 10 });
    expect((await errorOf(post(gm, `/api/zarin/hotels/${other.id}/forecasts/run`, {}))).code).toBe("not_hotel_member");
  });
});

describe("energy", () => {
  it("alerts against the occupancy-normalised baseline, and falls back to the static one", async () => {
    const su = await superuser();
    const h = await trialHotel(su, { days: 60 });
    const d1 = addDays(h.last, 1);
    const d2 = addDays(h.last, 2);
    const d3 = addDays(h.last, 3);
    await importRecords(su, { hotel: h.id, collection: "dailyOperations", records: [d1, d2].map((day) => ({ fields: { day, roomsAvailable: 60, roomsOccupied: 55, roomRevenue: 1, source: "import" } })) });
    // 55 rooms: 1500 + 18·55 = 2490 kWh is normal, although it is 24 % above the static baseline of 2000.
    await su.collection("energyReadings").create({ hotel: h.id, type: "electricity", day: d1, consumption: 2500 });
    const alerts = () => su.collection("alerts").getFullList({ filter: `hotel = "${h.id}" && type = "energySpike"` });
    expect(await alerts()).toHaveLength(0);
    await su.collection("energyReadings").create({ hotel: h.id, type: "electricity", day: d2, consumption: 3400 });
    let list = await alerts();
    expect(list).toHaveLength(1);
    expect(list[0].data.method).toBe("baseline");
    expect(Math.abs(list[0].data.expected - 2490)).toBeLessThan(30);
    expect(list[0].severity).toBe("critical"); // about +36 %: more than twice the 15 % threshold
    // No occupancy for d3 → static baseline rule.
    await su.collection("energyReadings").create({ hotel: h.id, type: "electricity", day: d3, consumption: 2700 });
    list = await alerts();
    expect(list.find((a) => a.dedupeKey === `energy_${d3}_electricity`).data.method).toBe("static");
  });

  it("analyses expected vs actual with Guideline 14 statistics, cost and carbon", async () => {
    const gm = await login(NID.gm);
    const to = addDays(new Date(Date.now() + 210 * 60e3).toISOString().slice(0, 10), -1);
    const from = addDays(to, -6);
    const a = await gm.send(`/api/zarin/energy/analysis?hotelId=${hotelId()}&type=electricity&from=${from}&to=${to}`, {});
    expect(a.baseline.valid).toBe(true);
    expect(a.baseline.cvrmse).toBeLessThan(25);
    expect(a.measurement.days).toHaveLength(7);
    expect(a.kpis.emissionFactor).toMatchObject({ kind: "assumption", isDefault: true, kgPerKwh: 0.494 });
    expect(a.kpis.carbonKg).toBeCloseTo(a.kpis.total * 0.494, 0);
    // The seed's last 4 days run 22 % hot: the CUSUM ends above zero.
    expect(a.measurement.days[6].cusum).toBeGreaterThan(0);
    const water = await gm.send(`/api/zarin/energy/analysis?hotelId=${hotelId()}&type=water&from=${from}&to=${to}`, {});
    expect(water.kpis.carbonKg).toBeNull();
    const housekeeper = await login(NID.housekeeper);
    expect((await errorOf(housekeeper.send(`/api/zarin/energy/analysis?hotelId=${hotelId()}`, {}))).code).toBe("missing_permission");
    expect((await errorOf(gm.send(`/api/zarin/energy/analysis?hotelId=${hotelId()}&from=2024-01-01&to=2026-01-01`, {}))).code).toBe("range_too_long");
  });
});

describe("recommendations", () => {
  it("record decisions, open one linked ticket and start an evaluation", async () => {
    const su = await superuser();
    await analytics(su, hotelId(), { insights: true });
    const gm = await login(NID.gm);
    const insight = await gm.collection("aiInsights").getFirstListItem(`hotel = "${hotelId()}" && rule = "energyIntensity"`);
    expect(insight.expectedImpact.method).toBe("energyBaseline");

    const housekeeper = await login(NID.housekeeper);
    expect((await errorOf(post(housekeeper, `/api/zarin/insights/${insight.id}/decide`, { decision: "accepted" }))).status).toBeGreaterThanOrEqual(403);
    expect((await errorOf(post(gm, `/api/zarin/insights/${insight.id}/decide`, { decision: "maybe" }))).code).toBe("invalid_decision");

    const decided = await post(gm, `/api/zarin/insights/${insight.id}/decide`, {
      decision: "accepted", note: "سرویس چیلر این هفته", ticket: { priority: "high" },
    });
    expect(decided.status).toBe("accepted");
    expect(decided.decisionNote).toBe("سرویس چیلر این هفته");
    expect(decided.decidedBy).toBe(gm.authStore.record.id);
    expect(decided.evaluation).toMatchObject({ status: "pending", method: "energyBaseline", windowDays: 14 });
    const ticket = await gm.collection("maintenanceTickets").getOne(decided.linkedTicket);
    expect(ticket).toMatchObject({ category: "hvac", priority: "high", status: "open", reportedBy: gm.authStore.record.id });
    expect(ticket.slaDueAt).not.toBe("");

    const again = await post(gm, `/api/zarin/insights/${insight.id}/decide`, { decision: "implemented", ticket: {} });
    expect(again.linkedTicket).toBe(decided.linkedTicket);
    expect(again.evaluation.dueAt).toBe(decided.evaluation.dueAt);
    const log = await gm.collection("auditLogs").getFullList({ filter: `resourceId = "${insight.id}" && action = "insights.decide"` });
    expect(log).toHaveLength(2);

    const other = await gm.collection("aiInsights").getFirstListItem(`hotel = "${hotelId()}" && rule = "weekdayOccupancy"`);
    const dismissed = await post(gm, `/api/zarin/insights/${other.id}/decide`, { decision: "dismissed", note: "فصل کم‌سفر", ticket: {} });
    expect(dismissed.evaluation).toBeNull();
    expect(dismissed.linkedTicket).toBe("");
  });

  it("are resolved when their condition is no longer detected", async () => {
    const su = await superuser();
    const h = await trialHotel(su, { days: 40 });
    const stale = await su.collection("aiInsights").create({ hotel: h.id, key: "repeatFailure_old", rule: "repeatFailure", title: "قدیمی", status: "active", source: "rules" });
    const external = await su.collection("aiInsights").create({ hotel: h.id, key: "llm_x", rule: "external", title: "بیرونی", status: "active", source: "external" });
    await analytics(su, h.id, { insights: true, now: `${addDays(h.last, 1)}T06:00:00Z` });
    expect(await su.collection("aiInsights").getOne(stale.id)).toMatchObject({ status: "resolved", closedReason: "not_detected_in_latest_run" });
    expect((await su.collection("aiInsights").getOne(external.id)).status).toBe("active");
  });

  it("are evaluated after their window: energy savings against the pre-decision baseline", async () => {
    const su = await superuser();
    // 60 days normal, then 10 % less from day 61 on.
    const h = await trialHotel(su, { days: 80, factor: (i) => (i >= 61 ? 0.9 : 1) });
    const decidedAt = `${addDays(h.start, 60)} 06:00:00.000Z`;
    const rec = await su.collection("aiInsights").create({
      hotel: h.id, key: "energyIntensity_electricity", rule: "energyIntensity", title: "t", status: "accepted", source: "rules",
      expectedImpact: { method: "energyBaseline", metric: "electricityPerOccupiedRoom", unit: "kWh", baseline: 50, expected: 45, subject: { type: "electricity" } },
      decidedAt, evaluation: { status: "pending", method: "energyBaseline", windowDays: 14, dueAt: `${addDays(h.start, 75)} 06:00:00.000Z` },
    });
    await analytics(su, h.id, { insights: true, now: `${addDays(h.start, 76)}T07:00:00Z` });
    const ev = (await su.collection("aiInsights").getOne(rec.id)).evaluation;
    expect(ev.status).toBe("evaluated");
    expect(ev.improved).toBe(true);
    expect(ev.delta).toBeGreaterThan(0);
    expect(ev.monthlyIrr).toBeGreaterThan(0);
    expect(ev.window.afterFrom).toBe(addDays(h.start, 61));
  });

  it("cannot be re-opened through the plain update once resolved", async () => {
    const su = await superuser();
    const gm = await login(NID.gm);
    const rec = await su.collection("aiInsights").create({ hotel: hotelId(), key: "test_resolved", rule: "x", title: "t", status: "resolved", source: "rules" });
    expect((await errorOf(gm.collection("aiInsights").update(rec.id, { status: "accepted" }))).code).toBe("insight_resolved");
    expect((await errorOf(post(gm, `/api/zarin/insights/${rec.id}/decide`, { decision: "accepted" }))).code).toBe("insight_resolved");
  });
});

describe("calendar events", () => {
  it("are managed with hotel.settings and visible to every member", async () => {
    const gm = await login(NID.gm);
    const ev = await gm.collection("calendarEvents").create({ hotel: hotelId(), day: "2026-03-19", endDay: "2026-03-20", kind: "religious", title: "تعطیلات" });
    expect(ev.kind).toBe("religious");
    const housekeeper = await login(NID.housekeeper);
    expect((await housekeeper.collection("calendarEvents").getOne(ev.id)).title).toBe("تعطیلات");
    expect((await errorOf(housekeeper.collection("calendarEvents").create({ hotel: hotelId(), day: "2026-03-19", kind: "other", title: "x" }))).status).toBe(400);
    expect((await errorOf(client().collection("calendarEvents").getOne(ev.id))).status).toBe(404);
    await gm.collection("calendarEvents").delete(ev.id);
  });
});
