/// <reference path="../../pb_data/types.d.ts" />
/**
 * Integration API v1 for n8n / IoT gateways (same contract as the Firebase
 * `api` function) and the outbox that delivers events to n8n.
 *
 * Signing (both directions):
 *   x-zarin-timestamp: <unix seconds>
 *   x-zarin-signature: hex(HMAC_SHA256(ZH_INTEGRATION_SECRET, `${timestamp}.${rawBody}`))
 */
const z = require(`${__hooks}/lib/zarin.js`);
const analytics = require(`${__hooks}/lib/analytics.js`);
const ai = require(`${__hooks}/lib/ai.js`);
const core = z.core;

const MAX_SKEW_SECONDS = 300;

function sign(secret, timestamp, raw) {
  return $security.hs256(`${timestamp}.${raw}`, secret);
}

/** Verifies the request signature and returns the parsed JSON body. */
function verified(e) {
  const secret = $os.getenv("ZH_INTEGRATION_SECRET");
  const raw = e.request.body ? toString(e.request.body) : "";
  const ts = Number(e.request.header.get("x-zarin-timestamp"));
  const sig = String(e.request.header.get("x-zarin-signature") || "");
  const fresh = isFinite(ts) && Math.abs(Date.now() / 1000 - ts) <= MAX_SKEW_SECONDS;
  if (!secret || !fresh || !sig || !$security.equal(sig, sign(secret, ts, raw))) {
    throw new UnauthorizedError("invalid_signature", z.details("invalid_signature"));
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw z.bad("invalid_body");
  }
}

function hotelOf(e) {
  const id = e.request.pathValue("hotelId");
  z.find(e.app, "hotels", id);
  return id;
}

function oneOf(value, allowed, fallback) {
  return allowed.indexOf(value) >= 0 ? value : fallback;
}

function health(e) {
  return e.json(200, { ok: true, service: "zarin-hooshmand", backend: "pocketbase", version: 1 });
}

function summary(e) {
  verified(e);
  const hotelId = hotelOf(e);
  const result = analytics.summary(e.app, hotelId, e.request.url.query().get("day"), new Date());
  const locale = e.request.url.query().get("narrative");
  if (locale === "fa" || locale === "en") result.narrative = ai.narrate(result, locale);
  return e.json(200, result);
}

function overdue(e) {
  verified(e);
  return e.json(200, analytics.overdue(e.app, hotelOf(e), new Date()));
}

function postNotification(e) {
  const b = verified(e);
  const hotelId = hotelOf(e);
  const roles = (Array.isArray(b.roles) ? b.roles : []).filter(core.isRole).slice(0, 15);
  const userIds = (Array.isArray(b.userIds) ? b.userIds : []).map(String).slice(0, 200);
  const title = String(b.title || "").slice(0, 120);
  const body = String(b.body || "").slice(0, 500);
  if (!title || !body) throw z.bad("invalid_body");
  const recipients = z.notify(e.app, {
    hotelId, roles, userIds, title, body,
    severity: oneOf(b.severity, ["info", "warning", "critical"], "info"),
    category: oneOf(b.category, ["alert", "task", "maintenance", "inventory", "report", "ai", "system"], "system"),
    route: typeof b.route === "string" && b.route.charAt(0) === "/" ? b.route.slice(0, 200) : "",
    createdBy: "n8n",
  });
  return e.json(200, { recipients });
}

function postInsight(e) {
  const b = verified(e);
  const hotelId = hotelOf(e);
  if (!/^[\w-]{3,80}$/.test(String(b.id || "")) || !b.title || !b.recommendation) throw z.bad("invalid_body");
  const key = `llm_${b.id}`;
  let rec = z.findFirst(e.app, "aiInsights", "hotel = {:h} && key = {:k}", { h: hotelId, k: key });
  if (!rec) rec = new Record(z.col(e.app, "aiInsights"), { hotel: hotelId, key });
  rec.load({
    rule: "external",
    category: oneOf(b.category, ["energy", "maintenance", "housekeeping", "inventory", "revenue", "staffing"], "energy"),
    title: String(b.title).slice(0, 160),
    summary: String(b.summary || "").slice(0, 1200),
    recommendation: String(b.recommendation).slice(0, 800),
    confidence: Math.max(0, Math.min(1, Number(b.confidence) || 0)),
    evidence: (Array.isArray(b.evidence) ? b.evidence : []).slice(0, 10).map((s) => String(s).slice(0, 200)),
    estimatedMonthlySaving: Math.max(0, Number(b.estimatedMonthlySaving) || 0),
    route: typeof b.route === "string" ? b.route.slice(0, 200) : "",
    priority: "medium",
    status: "active",
    source: "external",
    model: String(b.model || "").slice(0, 80),
  });
  e.app.save(rec);
  return e.json(200, { id: rec.id });
}

/** Smart-meter / IoT readings: same record shape as manual entry. */
function postReading(e) {
  const b = verified(e);
  const hotelId = hotelOf(e);
  const unit = { electricity: "kWh", water: "m³", gas: "m³" }[b.type];
  const consumption = Number(b.consumption);
  if (!unit || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.day)) || !(consumption >= 0) || consumption > 1e7) {
    throw z.bad("invalid_body");
  }
  let rec = z.findFirst(e.app, "energyReadings", "hotel = {:h} && day = {:d} && type = {:t}", { h: hotelId, d: b.day, t: b.type });
  if (!rec) rec = new Record(z.col(e.app, "energyReadings"), { hotel: hotelId, day: b.day, type: b.type });
  rec.load({
    unit, consumption,
    meterId: b.meterId ? String(b.meterId).slice(0, 60) : "",
    meterValue: Number(b.meterValue) || 0,
    source: oneOf(b.source, ["iot", "smartMeter", "import"], "iot"),
    recordedBy: "",
    recordedByName: "IoT Gateway",
  });
  e.app.save(rec);
  z.audit(e.app, hotelId, {
    action: "energyReadings.ingest", collection: "energyReadings", id: rec.id,
    actor: { uid: "integration", type: "integration" }, source: "iot",
  });
  return e.json(200, { id: rec.id });
}

/** Recomputes dailyMetrics for ?day= (default yesterday) — backfills and re-runs. */
function rollup(e) {
  verified(e);
  const hotelId = hotelOf(e);
  const now = new Date();
  const q = e.request.url.query().get("day");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q || "") ? q : z.addDays(z.dayKey(now), -1);
  return e.json(200, { day, metrics: analytics.rollup(e.app, hotelId, day, now) });
}

function runInsights(e) {
  verified(e);
  return e.json(200, { created: analytics.runInsights(e.app, hotelOf(e), new Date()) });
}

/** Cron: delivers queued events to n8n with retries (max 8 attempts). */
function flushOutbox(app) {
  const url = $os.getenv("ZH_N8N_WEBHOOK_URL");
  const secret = $os.getenv("ZH_INTEGRATION_SECRET");
  let delivered = 0;
  if (!url || !secret) return delivered;
  for (const rec of z.findMany(app, "outbox", "deliveredAt = '' && attempts < 8", {}, "created", 50)) {
    const body = JSON.stringify(z.jsonOf(rec, "payload") || {});
    const ts = Math.floor(Date.now() / 1000);
    try {
      const res = $http.send({
        url, method: "POST", timeout: 10, body,
        headers: { "content-type": "application/json", "x-zarin-timestamp": String(ts), "x-zarin-signature": sign(secret, ts, body) },
      });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        rec.set("deliveredAt", z.pbDate(new Date()));
        rec.set("lastError", "");
        delivered++;
      } else {
        rec.set("lastError", `HTTP ${res.statusCode}`);
      }
    } catch (err) {
      rec.set("lastError", String(err).slice(0, 500));
    }
    rec.set("attempts", rec.getInt("attempts") + 1);
    app.save(rec);
  }
  return delivered;
}

/** POST /v1/outbox/flush — deliver queued events now (ops / tests). */
function flushNow(e) {
  verified(e);
  return e.json(200, { delivered: flushOutbox(e.app) });
}

module.exports = { sign, health, summary, overdue, postNotification, postInsight, postReading, rollup, runInsights, flushOutbox, flushNow };
