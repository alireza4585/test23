/// <reference path="../../pb_data/types.d.ts" />
/**
 * App routes for the AI core (authorisation and validation; the work is in
 * forecasting.js and core.js).
 *
 * GET  /api/zarin/energy/analysis?hotelId=&type=electricity|water|gas&from=YYYY-MM-DD&to=YYYY-MM-DD
 *      (energy.view) baseline statistics, expected vs actual per day, CUSUM,
 *      savings with uncertainty, intensity, cost and carbon.
 * POST /api/zarin/hotels/{id}/forecasts/run
 *      (dashboard.executive or hotel.settings) recompute forecasts now.
 * Both answer 400 feature_disabled unless the hotel has the feature flag
 * (energyBaseline / forecasts) on.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const forecasting = require(`${__hooks}/lib/forecasting.js`);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ["electricity", "water", "gas"];

function energyAnalysis(e) {
  const c = z.caller(e);
  const q = e.requestInfo().query || {};
  const hotelId = z.requireHotel(c, q.hotelId);
  z.requirePerm(c, "energy.view");
  z.requireFeature(e.app, hotelId, "energyBaseline");
  const type = TYPES.indexOf(q.type) >= 0 ? q.type : "electricity";
  const today = z.dayKey(new Date());
  const to = DAY.test(q.to || "") ? q.to : z.addDays(today, -1);
  const from = DAY.test(q.from || "") ? q.from : z.addDays(to, -29);
  if (from > to) throw z.bad("invalid_range");
  if (z.core.daysBetween(from, to) > 366) throw z.bad("range_too_long", { maxDays: 366 });
  return e.json(200, forecasting.analyzeEnergy(e.app, hotelId, type, from, to));
}

function runForecastsNow(e) {
  const c = z.caller(e);
  const hotelId = z.requireHotel(c, e.request.pathValue("id"));
  if (!z.has(c, "dashboard.executive") && !z.has(c, "hotel.settings")) throw z.forbidden("missing_permission", { permission: "dashboard.executive" });
  z.requireFeature(e.app, hotelId, "forecasts");
  const summary = forecasting.runForecasts(e.app, hotelId, new Date());
  z.audit(e.app, hotelId, { action: "forecasts.run", collection: "forecastRuns", actor: z.actorOf(c), changes: summary });
  return e.json(200, { series: summary });
}

module.exports = { energyAnalysis, runForecastsNow };
