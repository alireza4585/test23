/// <reference path="../../pb_data/types.d.ts" />
/**
 * Weather-normalised energy models on PocketBase (AI phase 1, F2; flag
 * energyBaseline). The maths is in core.js (energy-model.ts); this file loads
 * data, stores models and scores, and raises alerts.
 *
 * Nightly (cron zarin_energy, 01:40 Tehran), per hotel and meter type:
 *   1. weather.refresh: yesterday's temperature from the configured provider;
 *   2. refit when there is no model, the model is older than REFIT_DAYS, or
 *      the excluded days in its window changed (adjustBaseline);
 *   3. score each day with a reading since the last scored day into
 *      energyExpected (expected, band, residual, z, CUSUM, flags);
 *   4. a spike or drift on one of the last 3 days raises an energy alert.
 * A new reading (afterEnergyWritten) is scored at once against the stored
 * model; without a valid stored model the Batch 1 on-the-fly baseline and
 * then the static baseline take over, as before.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;
const weather = require(`${__hooks}/lib/weather.js`);

const TYPES = ["electricity", "water", "gas"];
const UNIT = { electricity: "kWh", water: "m³", gas: "m³" };
const LABEL = { electricity: "برق", water: "آب", gas: "گاز" };
const TRAIN_DAYS = 365;
const SCORE_BACK_DAYS = 35;
const ALERT_RECENT_DAYS = 3;

/** First record by [sort] (z.findFirst has no ordering). */
function first(app, collection, filter, params, sort) {
  return z.findMany(app, collection, filter, params, sort, 1)[0] || null;
}

function readings(app, hotelId, type, from, to) {
  const out = {};
  for (const r of z.findMany(app, "energyReadings", "hotel = {:h} && type = {:t} && day >= {:f} && day <= {:to}", { h: hotelId, t: type, f: from, to }, "day")) {
    const d = r.getString("day");
    out[d] = (out[d] || 0) + r.getFloat("consumption");
  }
  return out;
}

function occupancy(app, hotelId, from, to) {
  const out = {};
  for (const r of z.findMany(app, "dailyOperations", "hotel = {:h} && day >= {:f} && day <= {:t}", { h: hotelId, f: from, t: to }, "day")) {
    out[r.getString("day")] = r.getInt("roomsOccupied");
  }
  return out;
}

/** Model rows {day, consumption, occupied, tMean} for days with a reading and occupancy. */
function modelDays(app, hotelId, type, from, to) {
  const energy = readings(app, hotelId, type, from, to);
  const occ = occupancy(app, hotelId, from, to);
  const temp = weather.temperatures(app, hotelId, from, to);
  const out = [];
  for (const day of Object.keys(energy).sort()) {
    if (occ[day] === undefined) continue;
    out.push({ day, consumption: energy[day], occupied: occ[day], tMean: temp[day] === undefined ? null : temp[day] });
  }
  return out;
}

function exclusions(app, hotelId, type, from, to) {
  return z.findMany(app, "energyExclusions", "hotel = {:h} && type = {:t} && day >= {:f} && day <= {:to}", { h: hotelId, t: type, f: from, to }, "day")
    .map((r) => r.getString("day"));
}

/** The newest active (or, failing that, rejected) model record. */
function modelRecord(app, hotelId, type) {
  return first(app, "energyModels", "hotel = {:h} && type = {:t} && status = 'active'", { h: hotelId, t: type }, "-fittedAt,-created")
    || first(app, "energyModels", "hotel = {:h} && type = {:t} && status = 'rejected'", { h: hotelId, t: type }, "-fittedAt,-created");
}

/** core EnergyModel from a stored record; null for a rejected record. */
function modelOf(rec) {
  if (!rec || rec.getString("status") !== "active") return null;
  const spec = z.jsonOf(rec, "spec") || {};
  const stats = z.jsonOf(rec, "stats") || {};
  return {
    kind: spec.kind, coef: spec.coef, features: spec.features, tbCool: spec.tbCool, tbHeat: spec.tbHeat, occScale: spec.occScale,
    stats: stats.model, valid: rec.getBool("valid"), reason: rec.getString("reason") || null, fallback: spec.fallback || null,
  };
}

function weatherSource(app, hotelId, from, to) {
  const count = {};
  for (const r of z.findMany(app, "weatherDaily", "hotel = {:h} && day >= {:f} && day <= {:t}", { h: hotelId, f: from, t: to })) {
    const s = r.getString("source");
    count[s] = (count[s] || 0) + 1;
  }
  const keys = Object.keys(count).sort((a, b) => count[b] - count[a]);
  return keys.length ? keys[0] : "none";
}

/** Fits on the TRAIN_DAYS before [today] and stores the result. */
function fitAndStore(app, hotelId, type, today, nowDate) {
  const to = z.addDays(today, -1);
  const from = z.addDays(today, -TRAIN_DAYS);
  const rows = modelDays(app, hotelId, type, from, to);
  const ex = exclusions(app, hotelId, type, from, to);
  const res = core.fitEnergyModel(rows, ex);
  const now = z.pbDate(nowDate || new Date());
  if (!res.ok) {
    // One rejected record per hotel and type, refreshed each night.
    let rec = z.findFirst(app, "energyModels", "hotel = {:h} && type = {:t} && status = 'rejected'", { h: hotelId, t: type });
    if (!rec) rec = new Record(z.col(app, "energyModels"), { hotel: hotelId, type, status: "rejected" });
    rec.load({
      kind: "occupancy", valid: false, reason: `insufficient_data: ${res.have} of ${res.need} days`,
      spec: null, stats: { have: res.have, need: res.need }, weatherSource: "", trainFrom: from, trainTo: to,
      excludedDays: ex.length, fittedAt: now,
    });
    app.save(rec);
    return { ok: false, reason: res.reason, have: res.have, need: res.need };
  }
  const m = res.model;
  for (const old of z.findMany(app, "energyModels", "hotel = {:h} && type = {:t} && (status = 'active' || status = 'rejected')", { h: hotelId, t: type })) {
    if (old.getString("status") === "rejected") {
      app.delete(old);
    } else {
      old.set("status", "superseded");
      app.save(old);
    }
  }
  const rec = new Record(z.col(app, "energyModels"), {
    hotel: hotelId, type, kind: m.kind, status: "active", valid: m.valid, reason: m.reason || "",
    spec: { kind: m.kind, coef: m.coef, features: m.features, tbCool: m.tbCool, tbHeat: m.tbHeat, occScale: m.occScale, fallback: m.fallback },
    stats: { model: m.stats, candidates: res.candidates },
    weatherSource: m.kind === "weather" ? weatherSource(app, hotelId, m.stats.from, m.stats.to) : "",
    trainFrom: m.stats.from, trainTo: m.stats.to, excludedDays: ex.length, fittedAt: now,
  });
  app.save(rec);
  return { ok: true, id: rec.id, kind: m.kind, valid: m.valid, reason: m.reason, stats: m.stats };
}

function needsRefit(app, rec, hotelId, type, today, nowMs) {
  if (!rec) return true;
  const fitted = z.parseDate(rec.getString("fittedAt"));
  if (!fitted) return true;
  if (rec.getString("status") === "rejected") return z.dayKey(fitted) < today;
  if (nowMs - fitted.getTime() >= core.REFIT_DAYS * 864e5) return true;
  const from = rec.getString("trainFrom");
  const to = rec.getString("trainTo");
  return exclusions(app, hotelId, type, from, to).length !== rec.getInt("excludedDays");
}

function expectedRow(app, hotelId, type, day) {
  return z.findFirst(app, "energyExpected", "hotel = {:h} && type = {:t} && day = {:d}", { h: hotelId, t: type, d: day });
}

function raise(app, hotelId, type, s) {
  const label = LABEL[type] || type;
  const unit = UNIT[type];
  const drift = s.drift;
  z.raiseAlert(app, {
    // A season the model has not seen yet never escalates to critical.
    hotelId, type: "energySpike", severity: s.deviationPct > 30 && s.seasonCovered ? "critical" : "warning",
    title: drift ? `انحراف پایدار مصرف ${label} از مقدار موردانتظار` : `مصرف ${label} بالاتر از مقدار موردانتظار`,
    message: `${Math.round(s.actual)} ${unit} در ${s.day}؛ ${Math.round(s.deviationPct)}٪ بیش از ${Math.round(s.expected)} ${unit} موردانتظار` +
      (s.usedWeather ? " (با دما و اشغال)" : " (با اشغال، بدون دادهٔ دما)") +
      (s.seasonCovered ? "" : "؛ اطمینان پایین: مدل هنوز دادهٔ این ماه از سال را ندیده است"),
    route: "/energy", audienceRoles: ["energyManager", "operationsManager", "hotelOwner"],
    dedupeKey: drift ? `energy_drift_${type}_${s.day}` : `energy_${s.day}_${type}`,
    data: {
      day: s.day, type, consumption: s.actual, expected: s.expected, lower: s.lower, upper: s.upper, deviation: s.deviationPct,
      z: s.z, cusum: s.cusum, kind: drift ? "drift" : "spike", method: "model", usedWeather: s.usedWeather, seasonCovered: s.seasonCovered,
    },
  });
  z.emit(app, "energy.anomaly", hotelId, { day: s.day, type, kind: drift ? "drift" : "spike", deviation: s.deviationPct });
}

/**
 * Scores one day against [model] and stores it; CUSUM continues from the
 * previous day's row. Raises an alert for a flagged day when [alert].
 */
function scoreAndStore(app, hotelId, type, row, model, modelId, thresholdPct, alert) {
  const prev = expectedRow(app, hotelId, type, z.addDays(row.day, -1));
  const s = core.scoreDay(model, row, prev ? prev.getFloat("cusum") : 0, thresholdPct);
  if (!s) return null;
  const excluded = !!z.findFirst(app, "energyExclusions", "hotel = {:h} && type = {:t} && day = {:d}", { h: hotelId, t: type, d: row.day });
  let rec = expectedRow(app, hotelId, type, row.day);
  if (!rec) rec = new Record(z.col(app, "energyExpected"), { hotel: hotelId, type, day: row.day });
  rec.load({
    model: modelId, expected: s.expected, lower: s.lower, upper: s.upper, hasActual: true, actual: s.actual,
    residual: s.residual, z: s.z, cusum: s.cusum, occupied: row.occupied,
    tMean: row.tMean === null || row.tMean === undefined ? 0 : row.tMean, hasWeather: s.usedWeather,
    // An excluded day is still scored and flagged: exclusion only keeps it out of the fit.
    flags: { spike: s.spike, drift: s.drift, excluded, valid: s.valid, seasonCovered: s.seasonCovered },
  });
  app.save(rec);
  if (alert && (s.spike || s.drift)) raise(app, hotelId, type, s);
  return s;
}

/**
 * Hook path: score a fresh reading against the stored valid model. Returns
 * false when there is no valid stored model (the caller falls back).
 */
function checkReading(app, hotelId, type, day, thresholdPct) {
  const rec = modelRecord(app, hotelId, type);
  const model = modelOf(rec);
  if (!model || !model.valid) return false;
  const rows = modelDays(app, hotelId, type, day, day);
  if (!rows.length) return false;
  const s = scoreAndStore(app, hotelId, type, rows[0], model, rec.id, thresholdPct, true);
  return !!s;
}

/** Nightly run for one hotel (flag energyBaseline). */
function run(app, hotelId, now) {
  if (!z.feature(app, hotelId, "energyBaseline")) return { skipped: "feature_disabled" };
  const today = z.dayKey(now);
  const out = { weather: null, types: {} };
  try {
    out.weather = weather.refresh(app, hotelId, now);
  } catch (err) {
    out.weather = { error: String(err) };
    console.log("weather refresh failed", hotelId, String(err));
  }
  const threshold = z.hotelSettings(app, hotelId).energyAlertThresholdPct;
  for (const type of TYPES) {
    const any = z.findFirst(app, "energyReadings", "hotel = {:h} && type = {:t} && day >= {:f}", { h: hotelId, t: type, f: z.addDays(today, -TRAIN_DAYS) });
    if (!any) continue;
    let rec = modelRecord(app, hotelId, type);
    const result = { refit: null, scored: 0, flagged: [] };
    if (needsRefit(app, rec, hotelId, type, today, now.getTime())) {
      result.refit = fitAndStore(app, hotelId, type, today, now);
      rec = modelRecord(app, hotelId, type);
    }
    const model = modelOf(rec);
    if (model && model.valid) {
      const last = first(app, "energyExpected", "hotel = {:h} && type = {:t} && model = {:m}", { h: hotelId, t: type, m: rec.id }, "-day");
      const from = last ? z.addDays(last.getString("day"), 1) : z.addDays(today, -SCORE_BACK_DAYS);
      const to = z.addDays(today, -1);
      if (from <= to) {
        for (const row of modelDays(app, hotelId, type, from, to)) {
          const s = scoreAndStore(app, hotelId, type, row, model, rec.id, threshold, row.day >= z.addDays(today, -ALERT_RECENT_DAYS));
          if (!s) continue;
          result.scored++;
          if (s.spike || s.drift) result.flagged.push({ day: s.day, spike: s.spike, drift: s.drift });
        }
      }
    }
    result.model = rec ? { id: rec.id, status: rec.getString("status"), kind: rec.getString("kind"), valid: rec.getBool("valid"), reason: rec.getString("reason") } : null;
    out.types[type] = result;
  }
  return out;
}

/** Recent model scores per meter type, for the rule engine (EngineInput.energyModel). */
function stateForRules(app, hotelId, today) {
  const out = [];
  for (const type of TYPES) {
    const rec = modelRecord(app, hotelId, type);
    const model = modelOf(rec);
    if (!model) continue;
    const rows = z.findMany(app, "energyExpected", "hotel = {:h} && type = {:t} && model = {:m} && day >= {:f} && day < {:to} && hasActual = true",
      { h: hotelId, t: type, m: rec.id, f: z.addDays(today, -10), to: today }, "day");
    if (!rows.length) continue;
    out.push({
      type, valid: model.valid, kind: model.kind, unit: UNIT[type],
      cvrmseMonthly: model.stats ? model.stats.cvrmseMonthly : null,
      days: rows.map((r) => {
        const f = z.jsonOf(r, "flags") || {};
        const expected = r.getFloat("expected");
        const actual = r.getFloat("actual");
        return {
          day: r.getString("day"), expected, actual, deviationPct: expected > 0 ? Math.round(((actual - expected) / expected) * 1000) / 10 : 0,
          spike: f.spike === true, drift: f.drift === true, usedWeather: r.getBool("hasWeather"), seasonCovered: f.seasonCovered !== false,
        };
      }),
    });
  }
  return out;
}

module.exports = { TYPES, UNIT, modelDays, exclusions, modelRecord, modelOf, fitAndStore, needsRefit, scoreAndStore, checkReading, run, stateForRules };
