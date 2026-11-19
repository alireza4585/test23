/// <reference path="../../pb_data/types.d.ts" />
/**
 * F10 guest reviews, R1 (flag guestReviews; docs/21). No AI in R1: intake,
 * matching, the review queue, listings, the QR survey and retention.
 *
 * Every per-hotel value is data (reviewProfiles); nothing here names a hotel.
 * Every review goes through one pipeline (ingest): sanitise and redact (no
 * phone, e-mail, national ID, handle or link is stored), the rating to 1–5,
 * matching against every hotel's profile with the hotel the review came in for
 * as context, then de-duplication:
 *   - the same platform and review id: the record is completed, never doubled;
 *   - the same review through another channel (±1 day, same rating, text
 *     similarity ≥ 0.85): completed (e.g. a later CSV adds the review id);
 *   - the same guest on another platform (±3 days, similarity ≥ 0.9): saved
 *     with duplicateOf, counted once.
 *   The two similarity checks need texts of 5+ words; a later row with the same
 *   review id and a changed text or rating is the guest's edit (editedAt).
 *
 * Routes (app; reviews.manage unless noted; [flag] needs guestReviews):
 *   GET  /api/zarin/reviews/profile?hotel=          reviews.view: the profile with defaults
 *   POST /api/zarin/reviews/profile                  edit; superAdmin only for llmDailyCap, minN, thresholds;
 *                                                    shorter retention needs confirmPurge; re-matches the queue
 *   POST /api/zarin/review-sources                   add a listing (candidate, or confirmed with confirm: true)
 *   POST /api/zarin/review-sources/{id}/decide       confirm | reject (a rejected listing's reviews are archived)
 *   POST /api/zarin/reviews/import                   CSV, dryRun first [flag for the commit]
 *   POST /api/zarin/reviews                          one review: manual or staff_share (Android share) [flag]
 *   GET  /api/zarin/reviews/queue?hotel=             reviews waiting for a decision [flag]
 *   POST /api/zarin/reviews/{id}/decide              accept | reject [flag]
 *   POST /api/zarin/reviews/dry-run                  onboarding checklist + sample texts through the pipeline, nothing saved
 *   POST /api/zarin/reviews/survey/tokens            create the public and/or room QR tokens [flag]
 *   POST /api/zarin/reviews/survey/tokens/{id}/rotate   a new token now (old QR cards stop working) [flag]
 *   POST /api/zarin/reviews/survey/printed           cards printed (the app lists cards that need printing)
 * Public (no account; needs ZH_REVIEW_SALT or ZH_SECRETS_KEY):
 *   GET  /survey/{token}           the survey page (server-rendered, no script)
 *   POST /survey/{token}           its form; POST /api/zarin/survey/{token} the same as JSON
 * Hooks: a room leaving "occupied" (check-out) rotates its QR token; the old one
 * is accepted 24 h more. Cron: text retention (00:35 UTC).
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const FLAG = "guestReviews";
const PLATFORMS = core.REVIEW_PLATFORMS;
const MAX_TEXT = 8000;
const MAX_TITLE = 300;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const PREVIEW_ROWS = 50;
// Fuzzy de-duplication needs this many words: two short generic reviews ("عالی بود") are different guests.
const FUZZY_MIN_WORDS = 5;
const RETENTION_MAX = 730;
const SURVEY_TEXT_MAX = 2000;
const STAY_MAX_RESPONSES = 3;
const AFTER_CHECKOUT_MS = 24 * 3600 * 1000;
const FORM_MIN_MS = 3000;
const FORM_MAX_MS = 2 * 3600 * 1000;
// Public QR only (guests on the hotel's Wi-Fi share one address; room cards have the per-stay cap).
const IP_DAILY_MAX = 10;
const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY3479";
const ROLES = ["hotelOwner", "generalManager", "operationsManager", "maintenanceManager", "housekeepingManager", "restaurantManager", "inventoryManager", "analyst"];

// -------------------------------------------------------------- profile
const DEFAULTS = {
  aliases: [], cityAliases: [], address: "", negativeKeywords: [],
  schedule: { ingest: "06:00", digest: "06:30", tz: "Asia/Tehran" },
  recipients: { roles: ["hotelOwner", "generalManager", "operationsManager"], baleChatId: "", emails: [] },
  toggles: { summary: true, showEstimated: false },
  retentionDays: 365,
  survey: { languages: ["fa", "en"], brandName: "", publicEnabled: false, roomEnabled: false, publicHourlyCap: 30 },
  llmDailyCap: 50000,
  minN: { rated: 5, estimated: 10, estimatedConfidence: 0.6, daily: 3 },
  thresholds: {
    spike: { days: 7, minNegative: 3, ratio: 2, priorDays: 28, minReviews: 8 },
    persistent: { days: 30, share: 0.25, minReviews: 15, minNegative: 5 },
    outcome: { startAfterDays: 7, windowDays: 30, minPerSide: 10 },
  },
  reportYearStart: "01-01",
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function hotelIdOf(e, c) {
  const b = e.requestInfo().body || {};
  const q = e.request.url.query().get("hotel");
  return z.requireHotel(c, String(b.hotel || q || c.activeHotel || ""));
}

function profileRecord(app, hotelId) {
  return z.findFirst(app, "reviewProfiles", "hotel = {:h}", { h: hotelId });
}

/** The profile with defaults (a hotel without a saved profile gets its name and city). */
function profileOf(app, hotelId) {
  const rec = profileRecord(app, hotelId);
  const hotel = z.find(app, "hotels", hotelId);
  const j = (f) => (rec ? z.jsonOf(rec, f) : null);
  const merge = (f) => Object.assign(clone(DEFAULTS[f]), j(f) || {});
  const names = Object.assign({ fa: hotel.getString("name"), en: "" }, j("names") || {});
  const thresholds = clone(DEFAULTS.thresholds);
  const t = j("thresholds") || {};
  for (const k of Object.keys(thresholds)) Object.assign(thresholds[k], t[k] || {});
  return {
    id: rec ? rec.id : null,
    hotel: hotelId,
    names,
    aliases: j("aliases") || [],
    city: rec && rec.getString("city") ? rec.getString("city") : hotel.getString("city"),
    cityAliases: j("cityAliases") || [],
    address: rec ? rec.getString("address") : "",
    negativeKeywords: j("negativeKeywords") || [],
    schedule: merge("schedule"),
    recipients: merge("recipients"),
    toggles: merge("toggles"),
    retentionDays: rec && rec.getInt("retentionDays") ? rec.getInt("retentionDays") : DEFAULTS.retentionDays,
    survey: merge("survey"),
    // 0 = not set (an unset number field reads 0); the summary toggle turns the LLM off.
    llmDailyCap: rec && rec.getInt("llmDailyCap") > 0 ? rec.getInt("llmDailyCap") : DEFAULTS.llmDailyCap,
    minN: merge("minN"),
    thresholds,
    reportYearStart: (rec && rec.getString("reportYearStart")) || DEFAULTS.reportYearStart,
    onboarding: j("onboarding") || {},
    updated: rec ? rec.getString("updated") : "",
  };
}

function forMatch(p, listings) {
  return {
    hotelId: p.hotel,
    names: [p.names.fa, p.names.en].filter(Boolean),
    aliases: p.aliases,
    cities: [p.city].concat(p.cityAliases).filter(Boolean),
    negativeKeywords: p.negativeKeywords,
    listings,
  };
}

function listingsOf(app, hotelId, status) {
  return z.findMany(app, "reviewSources", "hotel = {:h} && status = {:s}", { h: hotelId, s: status }).map((r) => ({
    id: r.id, platform: r.getString("platform"), url: r.getString("url"), externalId: r.getString("externalId"),
    scaleMin: r.getFloat("scaleMin"), scaleMax: r.getFloat("scaleMax"),
  }));
}

/**
 * Match profiles of every hotel that has one (server-side only: other hotels'
 * names never reach a response), plus [hotelId] even without a saved profile.
 */
function matchProfiles(app, hotelId) {
  const ids = z.unique(z.findMany(app, "reviewProfiles", "id != ''").map((r) => r.getString("hotel")).concat([hotelId]));
  return ids.map((id) => forMatch(profileOf(app, id), listingsOf(app, id, "confirmed")));
}

// ------------------------------------------------------------ validation
function strList(v, field, maxItems, maxLen) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > maxItems) throw z.bad("invalid_field", { field });
  const out = [];
  for (const s of v) {
    const t = core.sanitizeReviewText(String(s === null || s === undefined ? "" : s), maxLen).replace(/\n/g, " ").trim();
    if (t && out.indexOf(t) < 0) out.push(t);
  }
  return out;
}

function str(v, field, max) {
  if (v === undefined) return undefined;
  if (v !== null && typeof v !== "string") throw z.bad("invalid_field", { field });
  return core.sanitizeReviewText(v || "", max).replace(/\n/g, " ").trim();
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function numIn(v, field, min, max) {
  const n = Number(v);
  if (v === null || v === "" || !isFinite(n) || n < min || n > max) throw z.bad("invalid_field", { field });
  return n;
}

/** Only known keys with numbers in range ({key: [min, max]}). */
function numbers(v, field, spec) {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw z.bad("invalid_field", { field });
  const out = {};
  for (const k of Object.keys(v)) {
    if (!spec[k]) throw z.bad("invalid_field", { field: `${field}.${k}` });
    out[k] = numIn(v[k], `${field}.${k}`, spec[k][0], spec[k][1]);
  }
  return out;
}

function countOld(app, hotelId, days, now) {
  const cutoff = z.pbDate(new Date(now.getTime() - days * 864e5));
  return z.findMany(app, "reviews", "hotel = {:h} && text != '' && ((postedAt != '' && postedAt < {:c}) || (postedAt = '' && created < {:c}))",
    { h: hotelId, c: cutoff }).length;
}

/** GET /api/zarin/reviews/profile?hotel= */
function getProfile(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.view");
  const p = profileOf(e.app, hotelId);
  // Recipients and survey settings are for managers.
  if (!z.has(c, "reviews.manage")) { delete p.recipients; delete p.onboarding; }
  p.feature = z.feature(e.app, hotelId, FLAG);
  return e.json(200, p);
}

const MATCH_FIELDS = ["names", "aliases", "city", "cityAliases", "negativeKeywords"];

/** POST /api/zarin/reviews/profile  {hotel, names?, aliases?, …, confirmPurge?} */
function saveProfile(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  const b = e.requestInfo().body || {};
  const allowed = ["hotel", "names", "aliases", "city", "cityAliases", "address", "negativeKeywords", "schedule", "recipients",
    "toggles", "retentionDays", "survey", "reportYearStart", "confirmPurge", "llmDailyCap", "minN", "thresholds"];
  for (const k of Object.keys(b)) if (allowed.indexOf(k) < 0) throw z.bad("field_not_allowed", { field: k });
  for (const k of ["llmDailyCap", "minN", "thresholds"]) {
    if (b[k] !== undefined && !c.isSuperAdmin) throw z.forbidden("superadmin_only", { field: k });
  }
  const before = profileOf(e.app, hotelId);
  const next = {};
  if (b.names !== undefined) {
    if (!b.names || typeof b.names !== "object") throw z.bad("invalid_field", { field: "names" });
    next.names = { fa: str(b.names.fa, "names.fa", 120) || "", en: str(b.names.en, "names.en", 120) || "" };
    if (!next.names.fa && !next.names.en) throw z.bad("name_required");
  }
  const lists = { aliases: [30, 120], cityAliases: [10, 80], negativeKeywords: [30, 120] };
  for (const k of Object.keys(lists)) {
    const v = strList(b[k], k, lists[k][0], lists[k][1]);
    if (v !== undefined) next[k] = v;
  }
  if (b.city !== undefined) next.city = str(b.city, "city", 80);
  if (b.address !== undefined) next.address = str(b.address, "address", 300);
  if (b.schedule !== undefined) {
    const s = b.schedule || {};
    for (const k of ["ingest", "digest"]) if (s[k] !== undefined && !HHMM.test(String(s[k]))) throw z.bad("invalid_field", { field: `schedule.${k}` });
    if (s.tz !== undefined && s.tz !== "Asia/Tehran") throw z.bad("invalid_field", { field: "schedule.tz" });
    next.schedule = Object.assign(clone(before.schedule), { ingest: s.ingest || before.schedule.ingest, digest: s.digest || before.schedule.digest });
  }
  if (b.recipients !== undefined) {
    const r = b.recipients || {};
    const roles = r.roles === undefined ? before.recipients.roles : r.roles;
    if (!Array.isArray(roles) || roles.some((x) => ROLES.indexOf(x) < 0)) throw z.bad("invalid_field", { field: "recipients.roles" });
    const emails = r.emails === undefined ? before.recipients.emails : r.emails;
    if (!Array.isArray(emails) || emails.length > 10 || emails.some((x) => typeof x !== "string" || x.length > 120 || !EMAIL.test(x))) {
      throw z.bad("invalid_field", { field: "recipients.emails" });
    }
    const chat = r.baleChatId === undefined ? before.recipients.baleChatId : String(r.baleChatId || "");
    if (chat && !/^-?[0-9A-Za-z_]{1,40}$/.test(chat)) throw z.bad("invalid_field", { field: "recipients.baleChatId" });
    next.recipients = { roles: z.unique(roles), emails: z.unique(emails), baleChatId: chat };
  }
  if (b.toggles !== undefined) {
    const t = b.toggles || {};
    next.toggles = clone(before.toggles);
    for (const k of ["summary", "showEstimated"]) {
      if (t[k] === undefined) continue;
      if (typeof t[k] !== "boolean") throw z.bad("invalid_field", { field: `toggles.${k}` });
      next.toggles[k] = t[k];
    }
  }
  if (b.survey !== undefined) {
    const s = b.survey || {};
    next.survey = clone(before.survey);
    if (s.languages !== undefined) {
      if (!Array.isArray(s.languages) || !s.languages.length || s.languages.some((l) => l !== "fa" && l !== "en")) {
        throw z.bad("invalid_field", { field: "survey.languages" });
      }
      next.survey.languages = z.unique(s.languages);
    }
    if (s.brandName !== undefined) next.survey.brandName = str(s.brandName, "survey.brandName", 120);
    for (const k of ["publicEnabled", "roomEnabled"]) {
      if (s[k] === undefined) continue;
      if (typeof s[k] !== "boolean") throw z.bad("invalid_field", { field: `survey.${k}` });
      next.survey[k] = s[k];
    }
    if (s.publicHourlyCap !== undefined) next.survey.publicHourlyCap = Math.round(numIn(s.publicHourlyCap, "survey.publicHourlyCap", 1, 500));
  }
  if (b.reportYearStart !== undefined) {
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(b.reportYearStart))) throw z.bad("invalid_field", { field: "reportYearStart" });
    next.reportYearStart = String(b.reportYearStart);
  }
  const now = new Date();
  if (b.retentionDays !== undefined) {
    const d = Math.round(numIn(b.retentionDays, "retentionDays", 1, RETENTION_MAX));
    // Shorter retention removes old texts for good at the next nightly run: confirm first.
    if (d < before.retentionDays && b.confirmPurge !== true) {
      throw z.bad("retention_confirm_required", { affected: countOld(e.app, hotelId, d, now) });
    }
    next.retentionDays = d;
  }
  if (b.llmDailyCap !== undefined) next.llmDailyCap = Math.round(numIn(b.llmDailyCap, "llmDailyCap", 1, 10000000));
  const minN = numbers(b.minN, "minN", { rated: [1, 1000], estimated: [1, 1000], estimatedConfidence: [0, 1], daily: [1, 1000] });
  if (minN) next.minN = Object.assign(clone(before.minN), minN);
  if (b.thresholds !== undefined) {
    const t = b.thresholds || {};
    const spec = {
      spike: { days: [1, 90], minNegative: [1, 1000], ratio: [1, 100], priorDays: [7, 365], minReviews: [1, 10000] },
      persistent: { days: [7, 365], share: [0.01, 1], minReviews: [1, 10000], minNegative: [1, 1000] },
      outcome: { startAfterDays: [0, 90], windowDays: [7, 180], minPerSide: [1, 1000] },
    };
    next.thresholds = clone(before.thresholds);
    for (const k of Object.keys(t)) {
      if (!spec[k]) throw z.bad("invalid_field", { field: `thresholds.${k}` });
      Object.assign(next.thresholds[k], numbers(t[k], `thresholds.${k}`, spec[k]));
    }
  }

  let rematched = { accepted: 0, waiting: 0 };
  e.app.runInTransaction((tx) => {
    let rec = profileRecord(tx, hotelId);
    if (!rec) {
      rec = new Record(z.col(tx, "reviewProfiles"));
      rec.set("hotel", hotelId);
      rec.set("names", before.names);
      rec.set("city", before.city || "");
    }
    for (const k of Object.keys(next)) rec.set(k, next[k]);
    rec.set("onboarding", Object.assign({}, before.onboarding, { profile: z.pbDate(now) }));
    rec.set("updatedBy", c.id);
    tx.save(rec);
    const changes = {};
    for (const k of Object.keys(next)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(next[k])) changes[k] = { from: before[k] === undefined ? null : before[k], to: next[k] };
    }
    z.audit(tx, hotelId, { action: "reviewProfiles.update", collection: "reviewProfiles", id: rec.id, actor: z.actorOf(c), changes, source: "client" });
    if (MATCH_FIELDS.some((k) => changes[k])) rematched = rematchQueue(tx, hotelId);
  });
  const out = profileOf(e.app, hotelId);
  out.rematched = rematched;
  out.feature = z.feature(e.app, hotelId, FLAG);
  return e.json(200, out);
}

/** After a profile or listing change: the waiting reviews are matched again (accepted ones stay). */
function rematchQueue(app, hotelId) {
  const profiles = matchProfiles(app, hotelId);
  let accepted = 0;
  let waiting = 0;
  for (const r of z.findMany(app, "reviews", "hotel = {:h} && status = 'needsReview'", { h: hotelId })) {
    const m = core.matchMention({ text: r.getString("text"), title: r.getString("title"), url: r.getString("url"), platform: r.getString("platform") }, profiles, hotelId);
    if (m.status === "accepted") {
      r.set("status", "active");
      r.set("matchScore", m.score);
      r.set("matchReasons", publicReasons(m.reasons));
      r.set("candidates", m.candidates);
      const l = listingFor(app, hotelId, r.getString("url"), r.getString("platform"));
      if (l) r.set("listing", l.id);
      app.save(r);
      accepted++;
    } else waiting++;
  }
  return { accepted, waiting };
}

/** Reasons the app may show: another hotel's id stays in the hidden candidates. */
function publicReasons(reasons) {
  return z.unique((reasons || []).map((r) => (r.indexOf("other:") === 0 ? "other_hotel" : r)));
}

function listingFor(app, hotelId, url, platform, status) {
  if (!url) return null;
  const u = core.canonicalUrl(url);
  if (!u) return null;
  for (const l of listingsOf(app, hotelId, status || "confirmed")) {
    const lu = core.canonicalUrl(l.url);
    if (lu && (u === lu || u.indexOf(`${lu}/`) === 0) && (!platform || platform === "other" || l.platform === platform)) return l;
  }
  return null;
}

// -------------------------------------------------------------- listings
/** POST /api/zarin/review-sources  {hotel, platform?, url?, externalId?, label?, scaleMin?, scaleMax?, confirm?} */
function addSource(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  const b = e.requestInfo().body || {};
  const url = cleanUrl(b.url);
  if (b.url && !url) throw z.bad("invalid_field", { field: "url" });
  const externalId = str(b.externalId, "externalId", 120) || "";
  if (!url && !externalId) throw z.bad("url_or_id_required");
  const platform = b.platform ? String(b.platform) : core.guessPlatform(url);
  if (PLATFORMS.indexOf(platform) < 0 || platform === "survey") throw z.bad("invalid_field", { field: "platform" });
  const scale = scaleOf(b, platform, null);
  const params = { h: hotelId, p: platform, u: url || "~", x: externalId || "~" };
  if (z.findFirst(e.app, "reviewSources", "hotel = {:h} && platform = {:p} && (url = {:u} || externalId = {:x})", params)) {
    throw z.bad("source_exists");
  }
  const now = new Date();
  const rec = new Record(z.col(e.app, "reviewSources"), {
    hotel: hotelId, platform, url: url || "", externalId, label: str(b.label, "label", 120) || "",
    status: b.confirm === true ? "confirmed" : "candidate", matchScore: b.confirm === true ? 1 : 0,
    scaleMin: scale ? scale.min : null, scaleMax: scale ? scale.max : null,
    decidedBy: b.confirm === true ? c.id : "", decidedByName: b.confirm === true ? c.name : "",
    decidedAt: b.confirm === true ? z.pbDate(now) : "",
  });
  e.app.runInTransaction((tx) => {
    tx.save(rec);
    z.audit(tx, hotelId, { action: "reviewSources.add", collection: "reviewSources", id: rec.id, actor: z.actorOf(c), changes: { status: rec.getString("status"), platform }, source: "client" });
    touchOnboarding(tx, hotelId, "listings", now);
    if (b.confirm === true) rematchQueue(tx, hotelId);
  });
  return e.json(200, z.find(e.app, "reviewSources", rec.id));
}

/** POST /api/zarin/review-sources/{id}/decide  {decision: confirm|reject, note?} */
function decideSource(e) {
  const c = z.caller(e);
  const rec = z.find(e.app, "reviewSources", e.request.pathValue("id"));
  const hotelId = z.requireHotel(c, rec.getString("hotel"));
  z.requirePerm(c, "reviews.manage");
  const b = e.requestInfo().body || {};
  if (b.decision !== "confirm" && b.decision !== "reject") throw z.bad("invalid_decision");
  const from = rec.getString("status");
  const to = b.decision === "confirm" ? "confirmed" : "rejected";
  let archived = 0;
  e.app.runInTransaction((tx) => {
    const r = z.find(tx, "reviewSources", rec.id);
    r.load({ status: to, decidedBy: c.id, decidedByName: c.name, decidedAt: z.pbDate(new Date()), note: str(b.note, "note", 300) || "" });
    tx.save(r);
    if (to === "rejected") {
      // Its reviews leave every count; they stay for the record.
      for (const x of z.findMany(tx, "reviews", "hotel = {:h} && listing = {:l} && status = 'active'", { h: hotelId, l: r.id })) {
        x.set("status", "archived");
        tx.save(x);
        archived++;
      }
    }
    z.audit(tx, hotelId, { action: "reviewSources.decide", collection: "reviewSources", id: r.id, actor: z.actorOf(c), changes: { status: { from, to }, archived }, source: "client" });
    if (to === "confirmed") rematchQueue(tx, hotelId);
  });
  return e.json(200, { id: rec.id, status: to, archived });
}

function touchOnboarding(app, hotelId, key, now) {
  const rec = profileRecord(app, hotelId);
  if (!rec) return;
  rec.set("onboarding", Object.assign({}, z.jsonOf(rec, "onboarding") || {}, { [key]: z.pbDate(now) }));
  app.save(rec);
}

// -------------------------------------------------------------- pipeline
function cleanUrl(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (s.length > 500 || !/^https?:\/\/[^\s<>"']+$/i.test(s)) return null;
  return s;
}

/** A rating scale from the request, the listing, or the platform (never guessed from the value). */
function scaleOf(b, platform, listing) {
  const hasMax = b.scaleMax !== undefined && b.scaleMax !== null && b.scaleMax !== "";
  if (hasMax) {
    const max = Number(b.scaleMax);
    const min = b.scaleMin === undefined || b.scaleMin === null || b.scaleMin === "" ? 1 : Number(b.scaleMin);
    if (!isFinite(max) || !isFinite(min) || max <= min || max > 100) throw z.bad("invalid_field", { field: "scaleMax" });
    return { min, max };
  }
  if (listing && listing.scaleMax > listing.scaleMin) return { min: listing.scaleMin, max: listing.scaleMax };
  return core.REVIEW_PLATFORM_SCALES[platform] || null;
}

function dayOf(rec) {
  const d = z.parseDate(rec.getString("postedAt"));
  return d ? z.dayKey(d) : null;
}

function dayDiff(a, b) {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

/**
 * Prepares one incoming review: {error} or the fields to store.
 * item: {platform?, channel, externalId?, url?, title?, text?, rating?, scaleMin?, scaleMax?, postedAt? (YYYY-MM-DD),
 *        deleted?, hotelName?, listingId?}
 */
function prepare(app, hotelId, item, profiles, listingById) {
  const url = cleanUrl(item.url);
  let listing = item.listingId ? listingById[item.listingId] : null;
  if (item.listingId && !listing) return { error: "unknown_listing" };
  const platform = item.platform ? String(item.platform).toLowerCase() : listing ? listing.platform : core.guessPlatform(url);
  if (PLATFORMS.indexOf(platform) < 0 || (platform === "survey" && item.channel.indexOf("survey") !== 0)) return { error: "bad_platform" };
  if (!listing && url) listing = listingFor(app, hotelId, url, platform);
  const text = core.redactReviewText(core.sanitizeReviewText(String(item.text || ""), MAX_TEXT));
  const title = core.redactReviewText(core.sanitizeReviewText(String(item.title || ""), MAX_TITLE)).replace(/\n/g, " ");
  const hasRating = item.rating !== undefined && item.rating !== null && item.rating !== "";
  if (!text && !hasRating) return { error: "no_text_or_rating" };
  let scale = null;
  let rating5 = null;
  if (hasRating) {
    try { scale = scaleOf(item, platform, listing); } catch (_) { return { error: "bad_scale" }; }
    if (!scale) return { error: "unknown_scale" };
    rating5 = core.ratingTo5(Number(item.rating), scale.min, scale.max);
    if (rating5 === null) return { error: "bad_rating" };
  }
  let day = null;
  if (item.postedAt) {
    day = core.parseReviewDay(String(item.postedAt));
    if (!day) return { error: "bad_date" };
  }
  const externalId = item.externalId ? core.sanitizeReviewText(String(item.externalId), 160).replace(/\s+/g, " ").trim() : "";

  let status = "active";
  let reasons = ["context"];
  let score = 1;
  let candidates = [];
  if (item.channel.indexOf("survey") === 0) {
    reasons = ["survey"];
  } else if (item.listingId) {
    // Exported from the hotel's own confirmed listing.
    reasons = ["listing"];
  } else {
    const m = core.matchMention({ text, title, url, platform, hotelName: item.hotelName || null }, profiles, hotelId);
    status = m.status === "accepted" ? "active" : "needsReview";
    reasons = m.reasons;
    score = m.score;
    candidates = m.candidates;
    if (url && listingFor(app, hotelId, url, platform, "rejected")) {
      status = "archived";
      reasons = ["rejected_listing"];
    }
  }
  if (item.deleted) status = "deleted";
  return {
    fields: {
      hotel: hotelId, platform, channel: item.channel, listing: listing ? listing.id : "", externalId,
      url: url || "", title, text, textKey: core.reviewTextKey(text),
      ratingRaw: hasRating ? Number(item.rating) : null, scaleMin: scale ? scale.min : null, scaleMax: scale ? scale.max : null,
      rating5, lang: item.lang || guessLang(text), postedAt: day ? `${day} 08:30:00.000Z` : "",
      status, matchScore: Math.round(score * 100) / 100, matchReasons: publicReasons(reasons), candidates,
      capturedBy: item.capturedBy || "", authorHash: item.authorHash || "",
      deletedAt: item.deleted ? z.pbDate(new Date()) : "",
    },
    day,
  };
}

function guessLang(text) {
  if (!text) return "";
  const fa = (text.match(/[؀-ۿ]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  return fa >= en ? "fa" : "en";
}

/**
 * The fields an existing record lacks and a new copy has (a later CSV completes
 * an e-mail record). With the same review id ([sameId]) a changed text or rating
 * is an edit by the guest: it replaces the old one and sets editedAt.
 */
function completion(existing, f, sameId) {
  const out = {};
  if (sameId && !existing.textPurgedAt && f.text && existing.textKey !== f.textKey && existing.text) {
    out.text = f.text; out.textKey = f.textKey; out.editedAt = z.pbDate(new Date());
  }
  if (sameId && f.rating5 !== null && existing.rating5 !== null && existing.rating5 !== undefined && existing.rating5 !== 0 && !sameRating(existing.rating5, f.rating5)) {
    out.ratingRaw = f.ratingRaw; out.scaleMin = f.scaleMin; out.scaleMax = f.scaleMax; out.rating5 = f.rating5; out.editedAt = z.pbDate(new Date());
  }
  const empty = (k) => { const v = existing[k]; return v === null || v === undefined || v === "" || v === 0; };
  for (const k of ["externalId", "url", "title", "postedAt", "listing"]) if (empty(k) && f[k]) out[k] = f[k];
  if ((existing.rating5 === null || existing.rating5 === 0 || existing.rating5 === undefined) && f.rating5 !== null) {
    out.ratingRaw = f.ratingRaw; out.scaleMin = f.scaleMin; out.scaleMax = f.scaleMax; out.rating5 = f.rating5;
  }
  if (empty("text") && f.text && !existing.textPurgedAt) { out.text = f.text; out.textKey = f.textKey; }
  if (f.status === "deleted" && existing.status !== "deleted") { out.status = "deleted"; out.deletedAt = f.deletedAt; }
  return out;
}

function plain(r) {
  return {
    id: r.id, platform: r.getString("platform"), externalId: r.getString("externalId"), url: r.getString("url"),
    title: r.getString("title"), text: r.getString("text"), textKey: r.getString("textKey"), rating5: r.get("rating5") === null ? null : r.getFloat("rating5"),
    postedAt: r.getString("postedAt"), listing: r.getString("listing"), status: r.getString("status"),
    textPurgedAt: r.getString("textPurgedAt"), duplicateOf: r.getString("duplicateOf"), day: dayOf(r), created: r.getString("created"),
  };
}

/**
 * The pipeline for a batch of items of one hotel. Nothing is saved with
 * opts.dryRun. Returns counts, errors and (dry run) a preview.
 */
function ingest(app, hotelId, items, opts) {
  const now = new Date();
  const profiles = matchProfiles(app, hotelId);
  const listingById = {};
  for (const l of listingsOf(app, hotelId, "confirmed")) listingById[l.id] = l;
  const result = { created: 0, updated: 0, edited: 0, unchanged: 0, needsReview: 0, crossPosts: 0, archived: 0, errors: [], preview: [], ids: [] };

  // Known reviews near the batch's days, plus what the batch adds (also in a dry run).
  const prepared = items.map((it) => prepare(app, hotelId, it, profiles, listingById));
  const days = prepared.filter((p) => p.day).map((p) => p.day).sort();
  let known = [];
  if (days.length) {
    const from = z.addDays(days[0], -(core.REVIEW_CROSS_POST_DAYS + 1));
    const to = z.addDays(days[days.length - 1], core.REVIEW_CROSS_POST_DAYS + 1);
    known = z.findMany(app, "reviews", "hotel = {:h} && postedAt >= {:f} && postedAt <= {:t}", { h: hotelId, f: `${from} 00:00:00.000Z`, t: `${to} 23:59:59.999Z` }).map(plain);
  }
  const undated = prepared.some((p) => p.fields && !p.day)
    ? z.findMany(app, "reviews", "hotel = {:h} && postedAt = ''", { h: hotelId }).map(plain) : [];
  const byExt = {};
  for (const k of known.concat(undated)) if (k.externalId) byExt[`${k.platform}|${k.externalId}`] = k;

  prepared.forEach((p, i) => {
    const row = items[i].row || i + 1;
    if (p.error) { result.errors.push({ row, reason: p.error }); return; }
    const f = p.fields;
    let existing = null;
    let outcome = "created";
    let sameId = false;
    if (f.externalId) {
      existing = byExt[`${f.platform}|${f.externalId}`] || null;
      if (!existing) {
        const r = z.findFirst(app, "reviews", "hotel = {:h} && platform = {:p} && externalId = {:x}", { h: hotelId, p: f.platform, x: f.externalId });
        if (r) existing = plain(r);
      }
      sameId = !!existing;
    }
    const pool = p.day ? known : undated;
    const fuzzy = f.textKey && f.textKey.split(" ").length >= FUZZY_MIN_WORDS;
    if (!existing && fuzzy) {
      existing = pool.find((k) => k.platform === f.platform && (!k.externalId || !f.externalId) &&
        (p.day ? k.day && dayDiff(k.day, p.day) <= 1 : !k.day) &&
        sameRating(k.rating5, f.rating5) && core.textSimilarity(k.textKey, f.textKey) >= core.REVIEW_SAME_SIMILARITY) || null;
    }
    let duplicateOf = "";
    if (existing) {
      const add = completion(existing, f, sameId);
      if (add.editedAt) result.edited++;
      outcome = Object.keys(add).length ? "updated" : "unchanged";
      if (!opts.dryRun && outcome === "updated") {
        const r = z.find(app, "reviews", existing.id);
        for (const k of Object.keys(add)) r.set(k, add[k]);
        app.save(r);
      }
      Object.assign(existing, add);
      if (add.externalId) byExt[`${existing.platform}|${add.externalId}`] = existing;
      result.ids.push(existing.id);
    } else {
      if (fuzzy && p.day) {
        const twin = known.filter((k) => k.platform !== f.platform && k.day && dayDiff(k.day, p.day) <= core.REVIEW_CROSS_POST_DAYS &&
          k.status !== "rejected" && core.textSimilarity(k.textKey, f.textKey) >= core.REVIEW_CROSS_POST_SIMILARITY)
          .sort((a, b) => (a.postedAt < b.postedAt ? -1 : 1))[0];
        if (twin) duplicateOf = twin.duplicateOf || twin.id;
      }
      let id = `dry${i}`;
      if (!opts.dryRun) {
        const rec = new Record(z.col(app, "reviews"));
        rec.load(f);
        if (duplicateOf) rec.set("duplicateOf", duplicateOf);
        app.save(rec);
        id = rec.id;
      }
      const k = { id, platform: f.platform, externalId: f.externalId, url: f.url, title: f.title, text: f.text, textKey: f.textKey,
        rating5: f.rating5, postedAt: f.postedAt, listing: f.listing, status: f.status, textPurgedAt: "", duplicateOf, day: p.day };
      if (p.day) known.push(k); else undated.push(k);
      if (f.externalId) byExt[`${f.platform}|${f.externalId}`] = k;
      result.ids.push(id);
    }
    if (outcome === "created") {
      result.created++;
      if (f.status === "needsReview") result.needsReview++;
      if (f.status === "archived") result.archived++;
      if (duplicateOf) result.crossPosts++;
    } else result[outcome]++;
    if (opts.dryRun && result.preview.length < PREVIEW_ROWS) {
      result.preview.push({
        row, outcome, status: existing ? existing.status : f.status, platform: f.platform, rating5: f.rating5,
        postedAt: p.day, reasons: f.matchReasons, crossPost: !!duplicateOf, text: f.text.slice(0, 200),
      });
    }
  });
  if (!opts.dryRun) delete result.preview;
  return result;
}

function sameRating(a, b) {
  if (a === null || a === undefined || a === 0) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) < 0.01;
}

// ---------------------------------------------------------- import & add
/** POST /api/zarin/reviews/import  {hotel, csv, platform?, listingId?, scaleMin?, scaleMax?, dryRun?} */
function importCsv(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  const b = e.requestInfo().body || {};
  const dryRun = b.dryRun !== false;
  if (!dryRun) z.requireFeature(e.app, hotelId, FLAG);
  const csv = typeof b.csv === "string" ? b.csv : "";
  if (!csv.trim()) throw z.bad("csv_required");
  if (csv.length > MAX_IMPORT_BYTES) throw z.bad("csv_too_large", { max: MAX_IMPORT_BYTES });
  if (b.platform !== undefined && b.platform !== null && b.platform !== "" && (PLATFORMS.indexOf(String(b.platform)) < 0 || b.platform === "survey")) {
    throw z.bad("invalid_field", { field: "platform" });
  }
  let listing = null;
  if (b.listingId) {
    listing = z.sameHotel(e.app, "reviewSources", String(b.listingId), hotelId);
    if (listing.getString("status") !== "confirmed") throw z.bad("listing_not_confirmed");
  }
  if (b.scaleMax !== undefined && b.scaleMax !== null && b.scaleMax !== "") scaleOf(b, "other", null);
  const parsed = core.readReviewImport(csv);
  if (parsed.rows.length + parsed.errors.length > MAX_IMPORT_ROWS) throw z.bad("too_many_rows", { max: MAX_IMPORT_ROWS });
  const items = [];
  const rowNumbers = rowsWithNumbers(parsed);
  parsed.rows.forEach((r, i) => {
    items.push({
      row: rowNumbers[i], channel: "csv", externalId: r.externalId, postedAt: r.postedAt, rating: r.rating,
      scaleMin: r.scaleMax ? 1 : b.scaleMin, scaleMax: r.scaleMax || b.scaleMax, text: r.text, title: r.title, url: r.url,
      platform: r.platform || (listing ? listing.getString("platform") : b.platform || null), hotelName: r.hotelName, deleted: r.deleted,
      listingId: listing ? listing.id : null, capturedBy: c.id,
    });
  });
  let result;
  if (dryRun) result = ingest(e.app, hotelId, items, { dryRun: true });
  else {
    e.app.runInTransaction((tx) => {
      result = ingest(tx, hotelId, items, { dryRun: false });
      z.audit(tx, hotelId, {
        action: "reviews.import", collection: "reviews", id: "", actor: z.actorOf(c), source: "client",
        changes: { created: result.created, updated: result.updated, unchanged: result.unchanged, needsReview: result.needsReview, crossPosts: result.crossPosts, errors: result.errors.length + parsed.errors.length },
      });
    });
  }
  result.errors = parsed.errors.concat(result.errors).sort((a, b2) => a.row - b2.row);
  result.columns = parsed.columns;
  result.rows = parsed.rows.length;
  result.dryRun = dryRun;
  delete result.ids;
  return e.json(200, result);
}

/** readImport numbers its errors by data row (1-based, header excluded); the accepted rows get theirs here. */
function rowsWithNumbers(parsed) {
  const bad = {};
  for (const er of parsed.errors) bad[er.row] = true;
  const out = [];
  let line = 1;
  for (let i = 0; i < parsed.rows.length; i++) {
    while (bad[line]) line++;
    out.push(line);
    line++;
  }
  return out;
}

/** POST /api/zarin/reviews  {hotel, channel: manual|staff_share, text?, url?, platform?, postedAt?, rating?, scaleMin?, scaleMax?, title?} */
function addOne(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  z.requireFeature(e.app, hotelId, FLAG);
  const b = e.requestInfo().body || {};
  const channel = b.channel === "staff_share" ? "staff_share" : b.channel === "manual" || b.channel === undefined ? "manual" : null;
  if (!channel) throw z.bad("invalid_field", { field: "channel" });
  if (b.platform && (PLATFORMS.indexOf(String(b.platform)) < 0 || b.platform === "survey")) throw z.bad("invalid_field", { field: "platform" });
  // A shared text often carries its link: take it before the text is redacted.
  const url = b.url || core.firstLink(String(b.text || ""));
  const item = {
    channel, url, text: b.text, title: b.title, platform: b.platform || null, rating: b.rating, scaleMin: b.scaleMin, scaleMax: b.scaleMax,
    postedAt: b.postedAt || z.dayKey(new Date()), externalId: b.externalId || null, capturedBy: c.id,
  };
  let result;
  e.app.runInTransaction((tx) => {
    result = ingest(tx, hotelId, [item], { dryRun: false });
    if (result.errors.length) throw z.bad(result.errors[0].reason);
    z.audit(tx, hotelId, { action: `reviews.${channel}`, collection: "reviews", id: result.ids[0], actor: z.actorOf(c), source: "client", changes: { created: result.created, updated: result.updated } });
  });
  const r = z.find(e.app, "reviews", result.ids[0]);
  return e.json(200, { id: r.id, status: r.getString("status"), platform: r.getString("platform"), outcome: result.created ? "created" : result.updated ? "updated" : "unchanged" });
}

// ------------------------------------------------------------------ queue
/** GET /api/zarin/reviews/queue?hotel= — waiting reviews, newest first. */
function queue(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  z.requireFeature(e.app, hotelId, FLAG);
  const items = z.findMany(e.app, "reviews", "hotel = {:h} && status = 'needsReview'", { h: hotelId }, "-created", 200).map((r) => ({
    id: r.id, platform: r.getString("platform"), channel: r.getString("channel"), url: r.getString("url"), title: r.getString("title"),
    text: r.getString("text"), rating5: r.get("rating5") === null ? null : r.getFloat("rating5"), postedAt: r.getString("postedAt"),
    matchScore: r.getFloat("matchScore"), matchReasons: z.jsonOf(r, "matchReasons") || [], created: r.getString("created"),
  }));
  return e.json(200, { items });
}

/** POST /api/zarin/reviews/{id}/decide  {decision: accept|reject, note?} */
function decide(e) {
  const c = z.caller(e);
  const rec = z.find(e.app, "reviews", e.request.pathValue("id"));
  const hotelId = z.requireHotel(c, rec.getString("hotel"));
  z.requirePerm(c, "reviews.manage");
  z.requireFeature(e.app, hotelId, FLAG);
  const b = e.requestInfo().body || {};
  const from = rec.getString("status");
  const to = b.decision === "accept" ? "active" : b.decision === "reject" ? "rejected" : null;
  if (!to) throw z.bad("invalid_decision");
  const allowed = { needsReview: ["active", "rejected"], active: ["rejected"], rejected: ["active"] };
  if (!allowed[from] || allowed[from].indexOf(to) < 0) throw z.bad("transition_not_allowed", { from, to });
  e.app.runInTransaction((tx) => {
    const r = z.find(tx, "reviews", rec.id);
    r.load({ status: to, decidedBy: c.id, decidedAt: z.pbDate(new Date()) });
    if (to === "active" && r.getString("url")) {
      const l = listingFor(tx, hotelId, r.getString("url"), r.getString("platform"));
      if (l) r.set("listing", l.id);
    }
    tx.save(r);
    z.audit(tx, hotelId, { action: "reviews.decide", collection: "reviews", id: r.id, actor: z.actorOf(c), source: "client", changes: { status: { from, to }, note: str(b.note, "note", 300) || "" } });
  });
  return e.json(200, { id: rec.id, status: to });
}

// ---------------------------------------------------------------- dry run
/** POST /api/zarin/reviews/dry-run  {hotel, samples?: [{text, url?, platform?, rating?, scaleMax?}]} — nothing is saved. */
function dryRun(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  const b = e.requestInfo().body || {};
  const samples = Array.isArray(b.samples) ? b.samples.slice(0, 50) : [];
  const p = profileOf(e.app, hotelId);
  const tokens = z.findMany(e.app, "reviewSurveyTokens", "hotel = {:h} && active = true", { h: hotelId });
  const result = ingest(e.app, hotelId, samples.map((s, i) => ({
    row: i + 1, channel: "manual", text: s && s.text, url: s && s.url, platform: (s && s.platform) || null,
    rating: s && s.rating, scaleMax: s && s.scaleMax, postedAt: z.dayKey(new Date()),
  })), { dryRun: true });
  const checks = {
    profileSaved: !!p.id,
    names: !!(p.names.fa || p.names.en),
    city: !!p.city,
    listingsConfirmed: listingsOf(e.app, hotelId, "confirmed").length,
    listingsCandidate: listingsOf(e.app, hotelId, "candidate").length,
    surveyPublicToken: tokens.some((t) => t.getString("kind") === "public"),
    surveyRoomTokens: tokens.filter((t) => t.getString("kind") === "room").length,
    surveyConfigured: !!salt(),
    feature: z.feature(e.app, hotelId, FLAG),
  };
  if (p.id) touchOnboarding(e.app, hotelId, "dryRunAt", new Date());
  return e.json(200, { checks, samples: result.preview, errors: result.errors });
}

// ----------------------------------------------------------------- survey
function salt() {
  return $os.getenv("ZH_REVIEW_SALT") || $os.getenv("ZH_SECRETS_KEY") || "";
}

function newToken() {
  return $security.randomStringWithAlphabet(24, TOKEN_ALPHABET);
}

/** POST /api/zarin/reviews/survey/tokens  {hotel, kind: public|room, roomId?} — creates missing tokens. */
function ensureTokens(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  z.requireFeature(e.app, hotelId, FLAG);
  const b = e.requestInfo().body || {};
  if (b.kind !== "public" && b.kind !== "room") throw z.bad("invalid_field", { field: "kind" });
  const now = z.pbDate(new Date());
  let created = 0;
  e.app.runInTransaction((tx) => {
    const slots = b.kind === "public" ? [""] : b.roomId ? [z.sameHotel(tx, "rooms", String(b.roomId), hotelId).id]
      : z.findMany(tx, "rooms", "hotel = {:h}", { h: hotelId }).map((r) => r.id);
    for (const room of slots) {
      if (z.findFirst(tx, "reviewSurveyTokens", "hotel = {:h} && kind = {:k} && room = {:r}", { h: hotelId, k: b.kind, r: room })) continue;
      tx.save(new Record(z.col(tx, "reviewSurveyTokens"), {
        hotel: hotelId, kind: b.kind, room, token: newToken(), stayResponses: 0, previousStayResponses: 0, rotatedAt: now, active: true,
      }));
      created++;
    }
    if (created) z.audit(tx, hotelId, { action: "reviewSurveyTokens.create", collection: "reviewSurveyTokens", id: "", actor: z.actorOf(c), source: "client", changes: { kind: b.kind, created } });
  });
  const tokens = z.findMany(e.app, "reviewSurveyTokens", "hotel = {:h} && kind = {:k}", { h: hotelId, k: b.kind });
  return e.json(200, { created, tokens });
}

/** POST /api/zarin/reviews/survey/tokens/{id}/rotate — the old token stops at once (a lost or copied card). */
function rotateToken(e) {
  const c = z.caller(e);
  const rec = z.find(e.app, "reviewSurveyTokens", e.request.pathValue("id"));
  const hotelId = z.requireHotel(c, rec.getString("hotel"));
  z.requirePerm(c, "reviews.manage");
  z.requireFeature(e.app, hotelId, FLAG);
  e.app.runInTransaction((tx) => {
    const r = z.find(tx, "reviewSurveyTokens", rec.id);
    r.load({ token: newToken(), previousToken: "", previousValidUntil: "", previousStayResponses: 0, stayResponses: 0, rotatedAt: z.pbDate(new Date()) });
    tx.save(r);
    z.audit(tx, hotelId, { action: "reviewSurveyTokens.rotate", collection: "reviewSurveyTokens", id: r.id, actor: z.actorOf(c), source: "client", changes: { kind: r.getString("kind") } });
  });
  return e.json(200, z.find(e.app, "reviewSurveyTokens", rec.id));
}

/** POST /api/zarin/reviews/survey/printed  {hotel, ids: []} */
function markPrinted(e) {
  const c = z.caller(e);
  const hotelId = hotelIdOf(e, c);
  z.requirePerm(c, "reviews.manage");
  const b = e.requestInfo().body || {};
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 1000) throw z.bad("invalid_field", { field: "ids" });
  const now = z.pbDate(new Date());
  e.app.runInTransaction((tx) => {
    for (const id of b.ids) {
      const r = z.sameHotel(tx, "reviewSurveyTokens", String(id), hotelId);
      r.set("printedAt", now);
      tx.save(r);
    }
  });
  return e.json(200, { printed: b.ids.length });
}

/**
 * Check-out (a room leaving "occupied"): the room's token rotates; the old one
 * stays valid 24 h for a guest who left this morning. Never blocks the room change.
 */
function afterRoomUpdate(app, room, before) {
  if (before !== "occupied" || room.getString("status") === "occupied") return;
  try {
    const t = z.findFirst(app, "reviewSurveyTokens", "hotel = {:h} && kind = 'room' && room = {:r}", { h: room.getString("hotel"), r: room.id });
    if (!t) return;
    const now = new Date();
    t.load({
      previousToken: t.getString("token"), previousValidUntil: z.pbDate(new Date(now.getTime() + AFTER_CHECKOUT_MS)),
      previousStayResponses: t.getInt("stayResponses"), stayResponses: 0, token: newToken(), rotatedAt: z.pbDate(now),
    });
    app.save(t);
  } catch (err) {
    console.log("survey token rotation failed", room.id, String(err));
  }
}

const TEXT = {
  fa: {
    dir: "rtl", title: "نظر شما دربارهٔ اقامت در", rating: "امتیاز شما (۱ بد، ۵ عالی)", comment: "نظر شما (اختیاری)",
    hint: "لطفاً نام، شمارهٔ تلفن یا اطلاعات شخصی ننویسید.", send: "ارسال", thanks: "سپاس از نظر شما.",
    unavailable: "این نظرسنجی در دسترس نیست.", expired: "فرم منقضی شده است؛ لطفاً صفحه را دوباره باز کنید.",
    limit: "از این کد بیش از حد مجاز پاسخ ثبت شده است.", ratingRequired: "لطفاً امتیاز را انتخاب کنید.", other: "English",
  },
  en: {
    dir: "ltr", title: "How was your stay at", rating: "Your rating (1 poor, 5 excellent)", comment: "Your comments (optional)",
    hint: "Please do not include names, phone numbers or other personal details.", send: "Send", thanks: "Thank you for your feedback.",
    unavailable: "This survey is not available.", expired: "This form has expired; please open the page again.",
    limit: "Too many responses have been sent with this code.", ratingRequired: "Please choose a rating.", other: "فارسی",
  },
};

function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** The token record and whether it is the current or the previous (after check-out) one. */
function findToken(app, token) {
  if (!token || !/^[A-Za-z0-9]{16,64}$/.test(token)) return null;
  const cur = z.findFirst(app, "reviewSurveyTokens", "token = {:t} && active = true", { t: token });
  if (cur) return { rec: cur, previous: false };
  const prev = z.findFirst(app, "reviewSurveyTokens", "previousToken = {:t} && active = true", { t: token });
  if (prev) {
    const until = z.parseDate(prev.getString("previousValidUntil"));
    if (until && until.getTime() > Date.now()) return { rec: prev, previous: true };
  }
  return null;
}

/** Why a token cannot take answers now (null: it can). */
function surveyBlock(app, found) {
  if (!found || !salt()) return "unavailable";
  const hotelId = found.rec.getString("hotel");
  if (!z.feature(app, hotelId, FLAG)) return "unavailable";
  const s = profileOf(app, hotelId).survey;
  const kind = found.rec.getString("kind");
  if ((kind === "public" && !s.publicEnabled) || (kind === "room" && !s.roomEnabled)) return "unavailable";
  return null;
}

function langOf(e, s, body) {
  const want = (body && body.lang) || e.request.url.query().get("lang");
  const langs = s.languages && s.languages.length ? s.languages : ["fa"];
  return langs.indexOf(want) >= 0 ? want : langs[0];
}

function page(lang, inner) {
  const t = TEXT[lang];
  return `<!doctype html><html lang="${lang}" dir="${t.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(t.send)}</title><style>` +
    "body{font-family:Vazirmatn,Tahoma,system-ui,sans-serif;background:#f6f5f2;color:#222;margin:0;padding:16px}" +
    "main{max-width:480px;margin:24px auto;background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.08)}" +
    "h1{font-size:1.2rem;margin:0 0 16px}fieldset{border:0;padding:0;margin:0 0 16px}legend{margin-bottom:8px}" +
    ".stars{display:flex;gap:8px}.stars label{flex:1;text-align:center;border:1px solid #ccc;border-radius:8px;padding:10px 0;cursor:pointer}" +
    ".stars input{position:absolute;opacity:0}.stars input:checked+span{font-weight:bold}.stars label:has(input:checked){background:#1f6f5c;color:#fff;border-color:#1f6f5c}" +
    "textarea{width:100%;box-sizing:border-box;min-height:120px;border:1px solid #ccc;border-radius:8px;padding:8px;font:inherit}" +
    "small{color:#666;display:block;margin:6px 0 16px}button{width:100%;padding:12px;border:0;border-radius:8px;background:#1f6f5c;color:#fff;font:inherit}" +
    ".hp{position:absolute;left:-9999px;top:-9999px}a{color:#1f6f5c}p.msg{font-size:1.05rem}" +
    `</style></head><body><main>${inner}</main></body></html>`;
}

function htmlHeaders(e) {
  const h = e.response.header();
  h.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cache-Control", "no-store");
}

function message(e, status, lang, text) {
  htmlHeaders(e);
  return e.html(status, page(lang, `<p class="msg">${esc(text)}</p>`));
}

/** GET /survey/{token} */
function surveyPage(e) {
  const token = e.request.pathValue("token");
  const found = findToken(e.app, token);
  const block = surveyBlock(e.app, found);
  if (block) return message(e, 404, "fa", `${TEXT.fa.unavailable} / ${TEXT.en.unavailable}`);
  const hotelId = found.rec.getString("hotel");
  const p = profileOf(e.app, hotelId);
  const lang = langOf(e, p.survey, null);
  const t = TEXT[lang];
  const brand = p.survey.brandName || (lang === "en" && p.names.en) || p.names.fa || p.names.en;
  const ts = String(Date.now());
  const sig = $security.hs256(`${token}.${ts}`, salt());
  const other = p.survey.languages.filter((l) => l !== lang)[0];
  const stars = [1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}" required><span>${n}</span></label>`).join("");
  htmlHeaders(e);
  return e.html(200, page(lang,
    `<h1>${esc(t.title)} ${esc(brand)}</h1>` +
    `<form method="post" action="/survey/${esc(token)}">` +
    `<fieldset><legend>${esc(t.rating)}</legend><div class="stars">${stars}</div></fieldset>` +
    `<label for="text">${esc(t.comment)}</label><textarea id="text" name="text" maxlength="${SURVEY_TEXT_MAX}"></textarea>` +
    `<small>${esc(t.hint)}</small>` +
    `<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>` +
    `<input type="hidden" name="t" value="${ts}"><input type="hidden" name="sig" value="${esc(sig)}"><input type="hidden" name="lang" value="${lang}">` +
    `<button type="submit">${esc(t.send)}</button></form>` +
    (other ? `<p><a href="/survey/${esc(token)}?lang=${other}">${esc(TEXT[lang].other)}</a></p>` : "")));
}

/**
 * One survey answer. Returns {status, code}: 200 ok (also for the honeypot, so
 * bots learn nothing), 400 form/rating, 404 unavailable, 403 stay not active, 429 limits.
 */
function submit(e) {
  const token = e.request.pathValue("token");
  const b = e.requestInfo().body || {};
  if (b.website) return { status: 200, code: "ok" };
  const found = findToken(e.app, token);
  if (surveyBlock(e.app, found)) return { status: 404, code: "unavailable" };
  const ts = Number(b.t);
  const age = Date.now() - ts;
  if (!isFinite(ts) || typeof b.sig !== "string" || b.sig !== $security.hs256(`${token}.${String(b.t)}`, salt()) || age < FORM_MIN_MS || age > FORM_MAX_MS) {
    return { status: 400, code: "expired" };
  }
  const rating = Number(b.rating);
  if (!(rating >= 1 && rating <= 5 && Math.round(rating) === rating)) return { status: 400, code: "ratingRequired" };
  const text = String(b.text || "").slice(0, SURVEY_TEXT_MAX);
  const hotelId = found.rec.getString("hotel");
  const kind = found.rec.getString("kind");
  const now = new Date();
  const day = z.dayKey(now);
  const authorHash = $security.hs256(`survey|${e.realIP()}|${day}|${hotelId}`, salt());
  let out = { status: 200, code: "ok" };
  e.app.runInTransaction((tx) => {
    const t = z.find(tx, "reviewSurveyTokens", found.rec.id);
    if (kind === "room") {
      const field = found.previous ? "previousStayResponses" : "stayResponses";
      if (!found.previous) {
        const room = z.findFirst(tx, "rooms", "id = {:id}", { id: t.getString("room") });
        if (!room || room.getString("status") !== "occupied") { out = { status: 403, code: "unavailable" }; return; }
      }
      if (t.getInt(field) >= STAY_MAX_RESPONSES) { out = { status: 429, code: "limit" }; return; }
      t.set(field, t.getInt(field) + 1);
      tx.save(t);
    } else {
      const cap = profileOf(tx, hotelId).survey.publicHourlyCap;
      const since = z.pbDate(new Date(now.getTime() - 3600 * 1000));
      if (z.findMany(tx, "reviews", "hotel = {:h} && channel = 'survey_public' && created >= {:s}", { h: hotelId, s: since }, "", cap + 1).length >= cap) {
        out = { status: 429, code: "limit" };
        return;
      }
      if (z.findMany(tx, "reviews", "hotel = {:h} && authorHash = {:a}", { h: hotelId, a: authorHash }, "", IP_DAILY_MAX + 1).length >= IP_DAILY_MAX) {
        out = { status: 429, code: "limit" };
        return;
      }
    }
    const res = ingest(tx, hotelId, [{
      channel: kind === "room" ? "survey_room" : "survey_public", platform: "survey", rating, scaleMin: 1, scaleMax: 5,
      text, postedAt: day, lang: b.lang === "en" ? "en" : "fa", authorHash: kind === "public" ? authorHash : "",
    }], { dryRun: false });
    if (res.errors.length) out = { status: 400, code: res.errors[0].reason };
  });
  return out;
}

/** POST /survey/{token} (the HTML form) */
function surveyForm(e) {
  const r = submit(e);
  const b = e.requestInfo().body || {};
  const lang = b.lang === "en" ? "en" : "fa";
  const t = TEXT[lang];
  const text = { ok: t.thanks, unavailable: t.unavailable, expired: t.expired, limit: t.limit, ratingRequired: t.ratingRequired }[r.code] || t.unavailable;
  return message(e, r.status, lang, text);
}

/** POST /api/zarin/survey/{token} (JSON) */
function surveyJson(e) {
  const r = submit(e);
  return e.json(r.status, { ok: r.status === 200, code: r.code });
}

// -------------------------------------------------------------- retention
/** Texts older than each hotel's retention are emptied for good; ratings, dates and counts stay. */
function purgeTexts(app, now) {
  const days = {};
  for (const p of z.findMany(app, "reviewProfiles", "id != ''")) days[p.getString("hotel")] = Math.min(p.getInt("retentionDays") || DEFAULTS.retentionDays, RETENTION_MAX);
  const hotels = z.unique(z.findMany(app, "hotels", "id != ''").map((h) => h.id));
  let purged = 0;
  for (const h of hotels) {
    const cutoff = z.pbDate(new Date(now.getTime() - (days[h] || DEFAULTS.retentionDays) * 864e5));
    for (;;) {
      const batch = z.findMany(app, "reviews", "hotel = {:h} && (text != '' || title != '') && ((postedAt != '' && postedAt < {:c}) || (postedAt = '' && created < {:c}))",
        { h, c: cutoff }, "", 500);
      if (!batch.length) break;
      for (const r of batch) {
        r.load({ text: "", title: "", textKey: "", textPurgedAt: z.pbDate(now) });
        app.save(r);
        purged++;
      }
    }
  }
  return purged;
}

module.exports = {
  FLAG, DEFAULTS, profileOf, matchProfiles, ingest, purgeTexts, afterRoomUpdate,
  getProfile, saveProfile, addSource, decideSource, importCsv, addOne, queue, decide, dryRun,
  ensureTokens, rotateToken, markPrinted, surveyPage, surveyForm, surveyJson,
};
