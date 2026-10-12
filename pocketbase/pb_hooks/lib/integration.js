/// <reference path="../../pb_data/types.d.ts" />
/**
 * Integration API v1 for n8n / IoT gateways / the AI worker (same contract
 * as the Firebase `api` function) and the outbox that delivers events to n8n.
 *
 * Signing, two schemes:
 *   v1 (shared secret, all routes; kept for the existing n8n workflows and
 *   switched off with ZH_ALLOW_SHARED_SECRET=false):
 *     x-zarin-timestamp: <unix seconds>
 *     x-zarin-signature: hex(HMAC_SHA256(ZH_INTEGRATION_SECRET, `${timestamp}.${rawBody}`))
 *   v2 (scoped key from integrationKeys, /v1/hotels/{id}/… only, and only
 *   for the hotels in the key's scope; every nonce is accepted once):
 *     x-zarin-key-id: <keyId>
 *     x-zarin-timestamp: <unix seconds>
 *     x-zarin-nonce: <16–64 chars [A-Za-z0-9_-]>
 *     x-zarin-signature: hex(HMAC_SHA256(keySecret, `${timestamp}.${nonce}.${rawBody}`))
 * Key secrets are stored encrypted with ZH_SECRETS_KEY (32 characters).
 */
const z = require(`${__hooks}/lib/zarin.js`);
const analytics = require(`${__hooks}/lib/analytics.js`);
const ai = require(`${__hooks}/lib/ai.js`);
const core = z.core;

const MAX_SKEW_SECONDS = 300;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

function sign(secret, timestamp, raw) {
  return $security.hs256(`${timestamp}.${raw}`, secret);
}

function denied(code) {
  return new UnauthorizedError(code || "invalid_signature", z.details(code || "invalid_signature"));
}

function sharedSecretAllowed() {
  return ($os.getenv("ZH_ALLOW_SHARED_SECRET") || "true").toLowerCase() !== "false";
}

/** ZH_SECRETS_KEY, or null when it is not a 32-character key. */
function secretsKey() {
  const k = $os.getenv("ZH_SECRETS_KEY") || "";
  return k.length === 32 ? k : null;
}

/** v2: scoped key + nonce. Returns nothing; throws when the request is not valid. */
function verifyKey(e, keyId, ts, sig, raw, fresh) {
  const nonce = String(e.request.header.get("x-zarin-nonce") || "");
  const master = secretsKey();
  if (!fresh || !sig || !NONCE_RE.test(nonce) || !master) throw denied();
  const key = z.findFirst(e.app, "integrationKeys", "keyId = {:k} && active = true", { k: keyId });
  if (!key) throw denied();
  let secret = "";
  try {
    secret = $security.decrypt(key.getString("secretEnc"), master);
  } catch (_) {
    throw denied();
  }
  if (!secret || !$security.equal(sig, sign(secret, ts, `${nonce}.${raw}`))) throw denied();
  const hotelId = e.request.pathValue("hotelId");
  if (!hotelId || z.arr(key.getStringSlice("hotels")).indexOf(hotelId) < 0) {
    throw z.forbidden("key_not_allowed_for_hotel");
  }
  try {
    e.app.save(new Record(z.col(e.app, "integrationNonces"), { keyId, nonce }));
  } catch (_) {
    throw denied("replayed_request");
  }
  const last = z.parseDate(key.getString("lastUsedAt"));
  if (!last || Date.now() - last.getTime() > 60 * 1000) {
    key.set("lastUsedAt", z.pbDate(new Date()));
    e.app.save(key);
  }
}

/** Verifies the request signature (v1 or v2) and returns the parsed JSON body. */
function verified(e) {
  const raw = e.request.body ? toString(e.request.body) : "";
  const ts = Number(e.request.header.get("x-zarin-timestamp"));
  const sig = String(e.request.header.get("x-zarin-signature") || "");
  const fresh = isFinite(ts) && Math.abs(Date.now() / 1000 - ts) <= MAX_SKEW_SECONDS;
  const keyId = String(e.request.header.get("x-zarin-key-id") || "");
  if (keyId) {
    verifyKey(e, keyId, ts, sig, raw, fresh);
  } else {
    const secret = $os.getenv("ZH_INTEGRATION_SECRET");
    if (!sharedSecretAllowed() || !secret || !fresh || !sig || !$security.equal(sig, sign(secret, ts, raw))) {
      throw denied();
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw z.bad("invalid_body");
  }
}

/** An in-app route such as "/energy" or "/inventory/abc123?tab=moves"; "" when invalid. */
function appRoute(value) {
  const v = typeof value === "string" ? value.trim() : "";
  return /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*(\?[A-Za-z0-9_=&-]*)?$/.test(v) && v.length <= 200 ? v : "";
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
  if (locale === "fa" || locale === "en") result.narrative = ai.narrate(result, locale, e.app);
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
  // Optional dedupe: the same key within `dedupeHours` (default 4, 1–72) is skipped.
  const dedupeKey = typeof b.dedupeKey === "string" ? b.dedupeKey.slice(0, 160) : "";
  if (dedupeKey) {
    const hours = Math.min(72, Math.max(1, Number(b.dedupeHours) || 4));
    const since = z.pbDate(new Date(Date.now() - hours * 3600 * 1000));
    if (z.findFirst(e.app, "notifications", "hotel = {:h} && dedupeKey = {:k} && created >= {:s}", { h: hotelId, k: dedupeKey, s: since })) {
      return e.json(200, { recipients: 0, skipped: true });
    }
  }
  const recipients = z.notify(e.app, {
    hotelId, roles, userIds, title, body,
    severity: oneOf(b.severity, ["info", "warning", "critical"], "info"),
    category: oneOf(b.category, ["alert", "task", "maintenance", "inventory", "report", "ai", "system"], "system"),
    route: appRoute(b.route),
    createdBy: "n8n",
    dedupeKey,
  });
  return e.json(200, { recipients, skipped: false });
}

function postInsight(e) {
  const b = verified(e);
  const hotelId = hotelOf(e);
  if (!/^[\w-]{3,80}$/.test(String(b.id || "")) || !b.title || !b.recommendation) throw z.bad("invalid_body");
  if (b.route !== undefined && b.route !== "" && !appRoute(b.route)) throw z.bad("invalid_route");
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
    route: appRoute(b.route),
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

function runForecasts(e) {
  verified(e);
  return e.json(200, { series: require(`${__hooks}/lib/forecasting.js`).runForecasts(e.app, hotelOf(e), new Date()) });
}

const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 8;

/**
 * Takes a short lease on one queued event so that concurrent flushes (the
 * cron and /v1/outbox/flush, or a slow cron run overlapping the next one)
 * never send it twice. Returns the fresh record, or null if another flush
 * holds it or already delivered it. An expired lease (crash mid-send) is
 * taken over, so delivery stays at-least-once.
 */
function claim(app, id) {
  const now = new Date();
  const res = app.db().newQuery(
    "UPDATE outbox SET lockedUntil = {:until} WHERE id = {:id} AND deliveredAt = '' AND attempts < {:max}" +
      " AND (lockedUntil = '' OR lockedUntil < {:now})",
  ).bind({ id, max: MAX_ATTEMPTS, now: z.pbDate(now), until: z.pbDate(new Date(now.getTime() + LEASE_SECONDS * 1000)) }).execute();
  return res.rowsAffected() === 1 ? app.findRecordById("outbox", id) : null;
}

/** Cron: delivers queued events to n8n with retries (max 8 attempts). */
function flushOutbox(app) {
  const url = $os.getenv("ZH_N8N_WEBHOOK_URL");
  const secret = $os.getenv("ZH_INTEGRATION_SECRET");
  let delivered = 0;
  if (!url || !secret) return delivered;
  for (const pending of z.findMany(app, "outbox", "deliveredAt = '' && attempts < {:max}", { max: MAX_ATTEMPTS }, "created", 50)) {
    const rec = claim(app, pending.id);
    if (!rec) continue;
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
    rec.set("lockedUntil", "");
    app.save(rec);
  }
  return delivered;
}

/** POST /v1/outbox/flush — deliver queued events now (ops / tests). */
function flushNow(e) {
  verified(e);
  return e.json(200, { delivered: flushOutbox(e.app) });
}

/** Cron: forgets nonces once their timestamps can no longer be accepted. */
function purgeNonces(app, now) {
  const cutoff = z.pbDate(new Date(now.getTime() - 2 * MAX_SKEW_SECONDS * 1000));
  return app.db().newQuery("DELETE FROM integrationNonces WHERE created < {:c}").bind({ c: cutoff }).execute().rowsAffected();
}

/** POST /v1/maintenance/purge — retention clean-up now (the crons run it on schedule). */
function purge(e) {
  verified(e);
  const now = new Date();
  return e.json(200, { conversations: ai.purgeConversations(e.app, now), nonces: purgeNonces(e.app, now) });
}

// ------------------------------------------------------ key management
/**
 * POST /api/zarin/admin/integration-keys  {label, hotels: [id…]}  (superuser)
 * Creates a scoped key; the secret is in this response only.
 */
function createKey(e) {
  const b = e.requestInfo().body || {};
  const master = secretsKey();
  if (!master) throw z.bad("secrets_key_not_configured");
  const hotels = z.unique((Array.isArray(b.hotels) ? b.hotels : []).map(String)).slice(0, 200);
  if (!hotels.length) throw z.bad("hotels_required");
  for (const id of hotels) z.find(e.app, "hotels", id);
  const label = String(b.label || "").trim().slice(0, 80);
  const keyId = `zk_${$security.randomStringWithAlphabet(16, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
  const secret = $security.randomStringWithAlphabet(48, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
  const rec = new Record(z.col(e.app, "integrationKeys"), {
    keyId, secretEnc: $security.encrypt(secret, master), hotels, label, active: true,
  });
  e.app.save(rec);
  for (const id of hotels) {
    z.audit(e.app, id, {
      action: "integrationKeys.create", collection: "integrationKeys", id: rec.id,
      actor: { uid: "superuser", type: "superuser" }, source: "server", changes: { keyId, label },
    });
  }
  return e.json(200, { keyId, secret, hotels, label });
}

/** POST /api/zarin/admin/integration-keys/{keyId}/revoke  (superuser) */
function revokeKey(e) {
  const key = z.findFirst(e.app, "integrationKeys", "keyId = {:k}", { k: e.request.pathValue("keyId") });
  if (!key) throw z.notFound("key_not_found");
  key.set("active", false);
  e.app.save(key);
  for (const id of z.arr(key.getStringSlice("hotels"))) {
    z.audit(e.app, id, {
      action: "integrationKeys.revoke", collection: "integrationKeys", id: key.id,
      actor: { uid: "superuser", type: "superuser" }, source: "server", changes: { keyId: key.getString("keyId") },
    });
  }
  return e.json(200, { keyId: key.getString("keyId"), active: false });
}

module.exports = { purge, purgeNonces, createKey, revokeKey, appRoute, verified, sign, health, summary, overdue, postNotification, postInsight, postReading, rollup, runInsights, runForecasts, flushOutbox, flushNow };
