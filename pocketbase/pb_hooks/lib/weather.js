/// <reference path="../../pb_data/types.d.ts" />
/**
 * Daily temperature for the energy models (AI phase 1, F2), behind one
 * adapter so the source can change without touching the model:
 *
 *   ZH_WEATHER_PROVIDER = none (default) | open_meteo | nasa_power
 *   ZH_WEATHER_BASE_URL   optional base URL override (tests, a mirror)
 *
 * Every provider returns the same shape: [{day, tMean, tMin, tMax}] for the
 * hotel's coordinates (hotels.settings.location = {lat, lon}). The nightly
 * cron fetches the last week (and back-fills a year the first time); the
 * signed route POST /v1/hotels/{id}/weather is a second path, e.g. when n8n
 * can reach a source that PocketBase cannot. Rows imported from the test
 * dataset (source "import", trial hotels only) are never overwritten.
 *
 * Neither provider's response format has been checked against the live API
 * from this repository (the build environment blocks outbound calls); the
 * parsers follow the providers' documented JSON and are unit-tested on
 * hand-written samples. Run ai-worker/tools/weather-probe.sh on Liara first.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const PROVIDERS = ["none", "open_meteo", "nasa_power"];
const BACKFILL_DAYS = 365;
const RECENT_DAYS = 7;

function providerName() {
  const p = String($os.getenv("ZH_WEATHER_PROVIDER") || "none").toLowerCase();
  return PROVIDERS.indexOf(p) >= 0 ? p : "none";
}

/** {lat, lon} from the hotel settings, or null. */
function location(app, hotelId) {
  const s = z.jsonOf(z.find(app, "hotels", hotelId), "settings") || {};
  const loc = s.location || {};
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const num = (v) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));

/** One validated day, or null. */
function clean(d) {
  const day = String(d && d.day || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  let tMin = num(d.tMin);
  let tMax = num(d.tMax);
  let tMean = num(d.tMean);
  if (tMean === null && tMin !== null && tMax !== null) tMean = (tMin + tMax) / 2;
  const ok = (v) => v === null || (v >= -60 && v <= 60);
  if (tMean === null || !ok(tMean) || !ok(tMin) || !ok(tMax)) return null;
  if (tMin !== null && tMax !== null && tMin > tMax) return null;
  return { day, tMean: Math.round(tMean * 100) / 100, tMin, tMax };
}

/** Open-Meteo: {daily: {time: [...], temperature_2m_mean: [...], …_max, …_min}}. */
function parseOpenMeteo(json) {
  const d = (json && json.daily) || {};
  const time = d.time || [];
  const out = [];
  for (let i = 0; i < time.length; i++) {
    const c = clean({ day: time[i], tMean: (d.temperature_2m_mean || [])[i], tMin: (d.temperature_2m_min || [])[i], tMax: (d.temperature_2m_max || [])[i] });
    if (c) out.push(c);
  }
  return out;
}

/** NASA POWER daily point: {properties: {parameter: {T2M: {YYYYMMDD: v}, T2M_MAX, T2M_MIN}}}; -999 = missing. */
function parseNasaPower(json) {
  const p = (json && json.properties && json.properties.parameter) || {};
  const miss = (v) => (v === -999 || v === -999.0 ? null : v);
  const out = [];
  for (const k of Object.keys(p.T2M || {}).sort()) {
    if (!/^\d{8}$/.test(k)) continue;
    const day = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
    const c = clean({ day, tMean: miss(p.T2M[k]), tMax: miss((p.T2M_MAX || {})[k]), tMin: miss((p.T2M_MIN || {})[k]) });
    if (c) out.push(c);
  }
  return out;
}

function urlFor(provider, loc, from, to, today) {
  const base = $os.getenv("ZH_WEATHER_BASE_URL");
  const ll = `latitude=${loc.lat}&longitude=${loc.lon}`;
  if (provider === "open_meteo") {
    const daily = "daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTehran";
    // The forecast API serves the last 92 days; older days come from the archive.
    if (core.daysBetween(from, today) <= 92) {
      return `${base || "https://api.open-meteo.com"}/v1/forecast?${ll}&${daily}&start_date=${from}&end_date=${to}`;
    }
    return `${base || "https://archive-api.open-meteo.com"}/v1/archive?${ll}&${daily}&start_date=${from}&end_date=${to}`;
  }
  if (provider === "nasa_power") {
    const ymd = (d) => d.replace(/-/g, "");
    return `${base || "https://power.larc.nasa.gov"}/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN&community=RE&${ll}&start=${ymd(from)}&end=${ymd(to)}&format=JSON`;
  }
  return null;
}

/** Fetches [from, to] from the configured provider; [] when the provider is none. */
function fetchDays(provider, loc, from, to, today) {
  const url = urlFor(provider, loc, from, to, today);
  if (!url) return [];
  const res = $http.send({ url, method: "GET", timeout: 20 });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`weather ${provider} HTTP ${res.statusCode}`);
  const json = res.json;
  return provider === "open_meteo" ? parseOpenMeteo(json) : parseNasaPower(json);
}

/** Upserts days for a hotel. Imported dataset rows are kept. Returns the number written. */
function upsertDays(app, hotelId, days, source) {
  let n = 0;
  for (const raw of days) {
    const d = clean(raw);
    if (!d) continue;
    let rec = z.findFirst(app, "weatherDaily", "hotel = {:h} && day = {:d}", { h: hotelId, d: d.day });
    if (rec && rec.getString("source") === "import") continue;
    if (!rec) rec = new Record(z.col(app, "weatherDaily"), { hotel: hotelId, day: d.day });
    // tMin/tMax are informational; hasRange says whether they were supplied (number fields cannot be null).
    const hasRange = d.tMin !== null && d.tMax !== null;
    rec.load({ tMean: d.tMean, tMin: hasRange ? d.tMin : 0, tMax: hasRange ? d.tMax : 0, hasRange, source });
    app.save(rec);
    n++;
  }
  return n;
}

/** {day: tMean} for [from, to]. */
function temperatures(app, hotelId, from, to) {
  const out = {};
  for (const r of z.findMany(app, "weatherDaily", "hotel = {:h} && day >= {:f} && day <= {:t}", { h: hotelId, f: from, t: to })) {
    out[r.getString("day")] = r.getFloat("tMean");
  }
  return out;
}

/**
 * Nightly fetch for one hotel: the last RECENT_DAYS days, or a full year the
 * first time (fewer than 300 days stored for the past year).
 */
function refresh(app, hotelId, now) {
  const provider = providerName();
  if (provider === "none") return { provider, skipped: "provider_none" };
  const loc = location(app, hotelId);
  if (!loc) return { provider, skipped: "no_location" };
  const today = z.dayKey(now);
  const to = z.addDays(today, -1);
  const have = Object.keys(temperatures(app, hotelId, z.addDays(today, -BACKFILL_DAYS), to)).length;
  const from = z.addDays(today, have < 300 ? -BACKFILL_DAYS : -RECENT_DAYS);
  const days = fetchDays(provider, loc, from, to, today);
  return { provider, from, to, fetched: days.length, written: upsertDays(app, hotelId, days, provider) };
}

/** POST /v1/hotels/{id}/weather {source, days: [{day, tMean, tMin?, tMax?}]} (signed; ≤ 400 days). */
function push(e, verified, hotelId) {
  const b = verified;
  const days = Array.isArray(b.days) ? b.days : [];
  if (!days.length || days.length > 400) throw z.bad("invalid_body", { max: 400 });
  const label = String(b.source || "external").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "external";
  const valid = days.map(clean).filter(Boolean);
  if (valid.length !== days.length) throw z.bad("invalid_weather_day");
  const written = upsertDays(e.app, hotelId, valid, `push:${label}`);
  z.audit(e.app, hotelId, {
    action: "weatherDaily.ingest", collection: "weatherDaily", actor: { uid: "integration", type: "integration" },
    changes: { days: valid.length, source: label }, source: "n8n",
  });
  return e.json(200, { written, skipped: valid.length - written });
}

module.exports = { PROVIDERS, providerName, location, clean, parseOpenMeteo, parseNasaPower, urlFor, upsertDays, temperatures, refresh, push };
