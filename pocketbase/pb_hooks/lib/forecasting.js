/// <reference path="../../pb_data/types.d.ts" />
/**
 * Forecasts and energy baselines on PocketBase (data loading and storage;
 * the maths is in core.js: forecast.ts, energy-baseline.ts, calendar.ts).
 *
 * - runForecasts: nightly 28-day forecasts of occupancy, revenue and energy
 *   per hotel, with backtest scores (forecastRuns) and next-day accuracy of
 *   earlier forecasts against what actually happened ("live").
 * - energyModel / modelCheck: occupancy-normalised baseline per meter type,
 *   used by the energy alert hook and by the analysis route.
 * - analyzeEnergy: expected vs actual, CUSUM, savings, cost and carbon.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const HORIZON = 28;
const HISTORY_DAYS = 730;
const BASELINE_DAYS = 365;
const STALE_AFTER_DAYS = 7;
const SERIES = {
  occupancy: { min: 0, max: 100 },
  roomRevenue: { min: 0 },
  totalRevenue: { min: 0 },
  electricity: { min: 0 },
  water: { min: 0 },
  gas: { min: 0 },
};
const ENERGY_TYPES = ["electricity", "water", "gas"];
// Iran's grid average (Ember, 2022 data). Hotels can set their own factor in
// settings.gridEmissionFactorKgPerKwh; the source is shown with the figure.
const DEFAULT_GRID_FACTOR = 0.494;
const DEFAULT_GRID_FACTOR_SOURCE = "Ember: Iran grid average 2022 (494 gCO2/kWh)";

/** Fixed public holidays plus the hotel's calendar events, as a set of day keys. */
function specialDays(app, hotelId, from, to) {
  const events = core.iranFixedHolidays(from, to);
  for (const r of z.findMany(app, "calendarEvents", "hotel = {:h} && day <= {:to} && (day >= {:from} || endDay >= {:from})", { h: hotelId, from, to })) {
    events.push({ day: r.getString("day"), endDay: r.getString("endDay"), kind: r.getString("kind"), title: r.getString("title") });
  }
  return core.daySet(events);
}

function operationsByDay(app, hotelId, from, to) {
  const out = {};
  for (const r of z.findMany(app, "dailyOperations", "hotel = {:h} && day >= {:f} && day <= {:t}", { h: hotelId, f: from, t: to }, "day")) {
    out[r.getString("day")] = {
      available: r.getInt("roomsAvailable"),
      occupied: r.getInt("roomsOccupied"),
      room: r.getFloat("roomRevenue"),
      total: r.getFloat("roomRevenue") + r.getFloat("fnbRevenue") + r.getFloat("otherRevenue"),
    };
  }
  return out;
}

function energyByDay(app, hotelId, from, to, type) {
  const out = {};
  const filter = type ? "hotel = {:h} && day >= {:f} && day <= {:t} && type = {:ty}" : "hotel = {:h} && day >= {:f} && day <= {:t}";
  for (const r of z.findMany(app, "energyReadings", filter, { h: hotelId, f: from, t: to, ty: type || "" }, "day")) {
    const key = r.getString("type");
    if (!out[key]) out[key] = {};
    const d = r.getString("day");
    out[key][d] = (out[key][d] || 0) + r.getFloat("consumption");
  }
  return out;
}

/** Daily points of every series between [from] and [to]. */
function seriesData(app, hotelId, from, to) {
  const ops = operationsByDay(app, hotelId, from, to);
  const energy = energyByDay(app, hotelId, from, to);
  const out = { occupancy: [], roomRevenue: [], totalRevenue: [], electricity: [], water: [], gas: [] };
  for (const day of Object.keys(ops).sort()) {
    const o = ops[day];
    if (o.available > 0) out.occupancy.push({ day, value: (o.occupied / o.available) * 100 });
    out.roomRevenue.push({ day, value: o.room });
    out.totalRevenue.push({ day, value: o.total });
  }
  for (const type of ENERGY_TYPES) {
    const days = energy[type] || {};
    for (const day of Object.keys(days).sort()) out[type].push({ day, value: days[day] });
  }
  return out;
}

/** Accuracy of the forecasts already stored for days that now have actuals. */
function liveAccuracy(app, hotelId, series, actual, from, to) {
  const byDay = {};
  for (const p of actual) byDay[p.day] = p.value;
  const abs = [];
  const pct = [];
  for (const r of z.findMany(app, "forecasts", "hotel = {:h} && series = {:s} && day >= {:f} && day <= {:t}", { h: hotelId, s: series, f: from, t: to })) {
    const a = byDay[r.getString("day")];
    if (a === undefined) continue;
    const e = Math.abs(a - r.getFloat("value"));
    abs.push(e);
    if (a !== 0) pct.push(e / Math.abs(a));
  }
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    days: abs.length, from, to,
    mae: abs.length ? Math.round(avg(abs) * 1000) / 1000 : null,
    mape: pct.length ? Math.round(avg(pct) * 10000) / 100 : null,
  };
}

function upsert(app, collection, filter, params, fields) {
  let rec = z.findFirst(app, collection, filter, params);
  if (!rec) rec = new Record(z.col(app, collection));
  rec.load(fields);
  app.save(rec);
  return rec;
}

/**
 * Forecasts every series [HORIZON] days past the last day with data, using
 * data up to yesterday (as of [now]). A series whose latest data is older
 * than a week is not forecast (reason "stale_data") rather than projected
 * from an outdated position.
 */
function runForecasts(app, hotelId, now) {
  const yesterday = z.addDays(z.dayKey(now), -1);
  const from = z.addDays(yesterday, -(HISTORY_DAYS - 1));
  const data = seriesData(app, hotelId, from, yesterday);
  const special = specialDays(app, hotelId, from, z.addDays(yesterday, HORIZON + 1));
  const runId = now.toISOString();
  const summary = {};
  for (const series of Object.keys(SERIES)) {
    const opts = Object.assign({ horizon: HORIZON, special }, SERIES[series]);
    let res = core.forecastSeries(data[series], opts);
    const last = data[series].length ? data[series][data[series].length - 1].day : "";
    if (res.ok && core.daysBetween(last, yesterday) > STALE_AFTER_DAYS) {
      res = Object.assign({}, res, { ok: false, reason: "stale_data", points: [] });
    }
    const live = liveAccuracy(app, hotelId, series, data[series], z.addDays(yesterday, -27), yesterday);
    app.runInTransaction((tx) => {
      upsert(tx, "forecastRuns", "hotel = {:h} && series = {:s}", { h: hotelId, s: series }, {
        hotel: hotelId, series, ok: res.ok, reason: res.reason || "", model: res.model || "",
        scores: res.scores, live, trainedFrom: res.trainedFrom || "", trainedTo: res.trainedTo || last,
        history: res.history, missing: res.missing, horizon: HORIZON, backtestHorizon: res.backtestHorizon,
        interval: res.interval, runId, generatedAt: z.pbDate(now),
      });
      for (const p of res.points) {
        upsert(tx, "forecasts", "hotel = {:h} && series = {:s} && day = {:d}", { h: hotelId, s: series, d: p.day }, {
          hotel: hotelId, series, day: p.day, value: p.value, lower: p.lower, upper: p.upper, model: res.model, runId,
        });
      }
    });
    summary[series] = res.ok ? res.model : `skipped: ${res.reason}`;
  }
  return summary;
}

// --------------------------------------------------------------- energy
/** Joined daily rows {day, consumption, occupied} for one meter type. */
function energyRows(app, hotelId, type, from, to) {
  const ops = operationsByDay(app, hotelId, from, to);
  const energy = (energyByDay(app, hotelId, from, to, type)[type]) || {};
  const rows = [];
  for (const day of Object.keys(energy).sort()) {
    const o = ops[day];
    if (!o) continue;
    rows.push({ day, consumption: energy[day], occupied: o.occupied });
  }
  return rows;
}

/** Baseline fitted on up to a year of days strictly before [beforeDay]. */
function energyModel(app, hotelId, type, beforeDay) {
  const rows = energyRows(app, hotelId, type, z.addDays(beforeDay, -BASELINE_DAYS), z.addDays(beforeDay, -1));
  const model = core.fitBaseline(rows);
  if (model) model.type = type;
  return model;
}

/**
 * Model-based check of one reading (used by the alert hook). Returns null
 * when the day has no occupancy or no usable model, so the caller can fall
 * back to the static baseline rule.
 */
function modelCheck(app, hotelId, type, day, consumption, thresholdPct) {
  const ops = operationsByDay(app, hotelId, day, day)[day];
  if (!ops) return null;
  const model = energyModel(app, hotelId, type, day);
  if (!model || !model.valid) return null;
  return Object.assign(core.checkReading(model, day, ops.occupied, consumption, thresholdPct), { occupied: ops.occupied, model });
}

function emissionFactor(app, hotelId) {
  const s = z.jsonOf(z.find(app, "hotels", hotelId), "settings") || {};
  const f = Number(s.gridEmissionFactorKgPerKwh);
  return f > 0
    ? { kgPerKwh: f, source: "hotel setting", isDefault: false }
    : { kgPerKwh: DEFAULT_GRID_FACTOR, source: DEFAULT_GRID_FACTOR_SOURCE, isDefault: true };
}

/**
 * Expected vs actual for [type] between [from] and [to] (inclusive), against
 * a baseline fitted on the year before [from]; plus intensity, cost and (for
 * electricity) carbon. Every block says what kind of figure it is.
 */
function analyzeEnergy(app, hotelId, type, from, to) {
  const settings = z.hotelSettings(app, hotelId);
  const model = energyModel(app, hotelId, type, from);
  const period = energyRows(app, hotelId, type, from, to);
  const readings = (energyByDay(app, hotelId, from, to, type)[type]) || {};
  const total = Object.keys(readings).reduce((s, d) => s + readings[d], 0);
  const occupied = period.reduce((s, r) => s + r.occupied, 0);
  const tariff = settings.energyTariff[type] || 0;
  const factor = type === "electricity" ? emissionFactor(app, hotelId) : null;
  const round = (v, d) => (v === null || !isFinite(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
  return {
    type, from, to,
    days: Object.keys(readings).length,
    baseline: model ? {
      kind: "metric", from: model.from, to: model.to, n: model.n, annual: model.annual, valid: model.valid,
      cvrmse: model.cvrmse, nmbe: model.nmbe, r2: model.r2, rmse: model.rmse, dropped: model.dropped,
      perOccupiedRoom: model.coef[1], fixedPerDay: model.coef[0], maxCvrmse: core.MAX_CVRMSE,
    } : null,
    measurement: model ? Object.assign({ kind: "metric" }, core.measureEnergy(model, period)) : null,
    kpis: {
      kind: "metric",
      total: round(total, 2),
      occupiedRoomNights: occupied,
      perOccupiedRoom: occupied > 0 ? round(period.reduce((s, r) => s + r.consumption, 0) / occupied, 3) : null,
      cost: round(total * tariff, 0),
      tariff,
      costPerOccupiedRoom: occupied > 0 ? round((period.reduce((s, r) => s + r.consumption, 0) * tariff) / occupied, 0) : null,
      carbonKg: factor ? round(total * factor.kgPerKwh, 1) : null,
      carbonPerOccupiedRoomKg: factor && occupied > 0 ? round((period.reduce((s, r) => s + r.consumption, 0) * factor.kgPerKwh) / occupied, 3) : null,
      emissionFactor: factor ? Object.assign({ kind: "assumption" }, factor) : null,
    },
    reason: model ? null : "insufficient_baseline",
  };
}

module.exports = { HORIZON, SERIES, runForecasts, specialDays, energyModel, energyRows, modelCheck, analyzeEnergy, operationsByDay };
