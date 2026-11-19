/// <reference path="../pb_data/types.d.ts" />
/**
 * F10 R1: guest reviews (flag guestReviews). Additive; down restores exactly.
 *
 *   permissions         + reviews.view, reviews.manage (role templates from
 *                       core.ROLE_PERMISSIONS; existing per-hotel overrides of
 *                       roles whose template has them get them too, so an
 *                       older override does not hide a new feature)
 *   reviewProfiles      one per hotel: names, aliases, city, negative keywords,
 *                       schedule, recipients, toggles, retention, survey, caps
 *   reviewSources       a hotel's listings per platform (candidate / confirmed /
 *                       rejected): only confirmed listings decide a match
 *   reviewSurveyTokens  survey QR tokens: one public per hotel, one per room
 *                       (rotates at check-out); readable with reviews.manage
 *   reviews             one review: platform, channel, link, redacted text,
 *                       rating and its 1–5 value, dates, status
 *
 * Nothing is written by clients: every write goes through a route that checks
 * the hotel, the permission, the flag, redaction and matching. Reviews waiting
 * for a decision ("needsReview") are listed by a reviews.manage route, not by
 * the collection rule. Hidden: the normalised text, the author hash and the
 * match candidates (they can name other hotels).
 */
const CODES = ["reviews.view", "reviews.manage"];
const PLATFORMS = ["booking", "expedia", "google", "tripadvisor", "instagram", "telegram", "snapptrip", "jabama", "eghamat24", "alibaba", "survey", "other"];
const CHANNELS = ["csv", "manual", "staff_share", "email", "survey_public", "survey_room", "seed"];
const STATUSES = ["active", "needsReview", "rejected", "deleted", "archived"];
const NAMES = ["reviews", "reviewSurveyTokens", "reviewSources", "reviewProfiles"];

function setMaxSelect(app, n) {
  for (const [name, field] of [["users", "permissions"], ["roleTemplates", "permissions"], ["roleOverrides", "permissions"]]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.getByName(field).maxSelect = n;
    app.save(c);
  }
}

function permissionIds(app) {
  const out = {};
  for (const p of app.findAllRecords("permissions")) out[p.getString("code")] = p.id;
  return out;
}

function resyncUsers(app) {
  const users = require(`${__hooks}/lib/users.js`);
  for (const u of app.findAllRecords("users")) {
    if (!u.getString("role")) continue;
    users.syncPermissions(app, u);
    app.saveNoValidate(u);
  }
}

migrate((app) => {
  const core = require(`${__hooks}/lib/core.js`);
  // ------------------------------------------------------- permissions
  const perms = app.findCollectionByNameOrId("permissions");
  for (const code of CODES) {
    let rec = null;
    try { rec = app.findFirstRecordByFilter("permissions", "code = {:c}", { c: code }); } catch (_) {}
    if (!rec) app.save(new Record(perms, { code, module: "reviews" }));
  }
  setMaxSelect(app, core.PERMISSIONS.length);
  const permId = permissionIds(app);
  for (const t of app.findAllRecords("roleTemplates")) {
    t.set("permissions", (core.ROLE_PERMISSIONS[t.getString("role")] || []).map((c) => permId[c]).filter(Boolean));
    app.save(t);
  }
  for (const o of app.findAllRecords("roleOverrides")) {
    const template = core.ROLE_PERMISSIONS[o.getString("role")] || [];
    const ids = o.getStringSlice("permissions");
    const add = CODES.filter((c) => template.indexOf(c) >= 0).map((c) => permId[c]).filter((id) => ids.indexOf(id) < 0);
    if (add.length) {
      o.set("permissions", ids.concat(add));
      app.save(o);
    }
  }

  // ------------------------------------------------------- collections
  const hotels = app.findCollectionByNameOrId("hotels");
  const users = app.findCollectionByNameOrId("users");
  const rooms = app.findCollectionByNameOrId("rooms");
  const SA = "@request.auth.role = 'superAdmin'";
  const member = "(@request.auth.activeHotel = hotel || " + SA + ")";
  const can = (p) => `${member} && @request.auth.permissions.code ?= '${p}'`;
  const hotel = { name: "hotel", type: "relation", collectionId: hotels.id, maxSelect: 1, required: true, cascadeDelete: true };
  const sel = (name, values, required) => ({ name, type: "select", maxSelect: 1, values, required: !!required });
  const stamps = () => [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const serverOnly = { createRule: null, updateRule: null, deleteRule: null };

  const profiles = new Collection(Object.assign({
    type: "base",
    name: "reviewProfiles",
    fields: [
      hotel,
      // {fa, en}
      { name: "names", type: "json", maxSize: 2000 },
      { name: "aliases", type: "json", maxSize: 5000 },
      { name: "city", type: "text", max: 80 },
      { name: "cityAliases", type: "json", maxSize: 2000 },
      { name: "address", type: "text", max: 300 },
      { name: "negativeKeywords", type: "json", maxSize: 5000 },
      // {ingest: "HH:MM", digest: "HH:MM", tz}
      { name: "schedule", type: "json", maxSize: 500 },
      // {roles: [], baleChatId, emails: []}
      { name: "recipients", type: "json", maxSize: 5000 },
      // {summary, showEstimated}
      { name: "toggles", type: "json", maxSize: 500 },
      { name: "retentionDays", type: "number", min: 1, max: 730, onlyInt: true },
      // {languages: [], brandName, publicEnabled, roomEnabled}
      { name: "survey", type: "json", maxSize: 2000 },
      { name: "surveyLogo", type: "file", maxSelect: 1, maxSize: 1024 * 1024, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
      { name: "llmDailyCap", type: "number", min: 0, onlyInt: true },
      { name: "minN", type: "json", maxSize: 1000 },
      { name: "thresholds", type: "json", maxSize: 2000 },
      { name: "reportYearStart", type: "text", max: 20 },
      // onboarding progress: {profile, listings, dryRunAt, enabledAt}
      { name: "onboarding", type: "json", maxSize: 1000 },
      { name: "updatedBy", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_review_profiles_hotel ON reviewProfiles (hotel)"],
    listRule: can("reviews.view"),
    viewRule: can("reviews.view"),
  }, serverOnly));
  app.save(profiles);

  const sources = new Collection(Object.assign({
    type: "base",
    name: "reviewSources",
    fields: [
      hotel,
      sel("platform", PLATFORMS, true),
      { name: "label", type: "text", max: 120 },
      { name: "url", type: "text", max: 500 },
      { name: "externalId", type: "text", max: 120 },
      sel("status", ["candidate", "confirmed", "rejected"], true),
      { name: "matchScore", type: "number" },
      { name: "scaleMin", type: "number" },
      { name: "scaleMax", type: "number" },
      { name: "decidedBy", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "decidedByName", type: "text", max: 120 },
      { name: "decidedAt", type: "date" },
      { name: "note", type: "text", max: 300 },
    ].concat(stamps()),
    indexes: [
      "CREATE UNIQUE INDEX idx_review_sources_url ON reviewSources (hotel, platform, url) WHERE url != ''",
      "CREATE UNIQUE INDEX idx_review_sources_ext ON reviewSources (hotel, platform, externalId) WHERE externalId != ''",
    ],
    listRule: can("reviews.view"),
    viewRule: can("reviews.view"),
  }, serverOnly));
  app.save(sources);

  const tokens = new Collection(Object.assign({
    type: "base",
    name: "reviewSurveyTokens",
    fields: [
      hotel,
      sel("kind", ["public", "room"], true),
      { name: "room", type: "relation", collectionId: rooms.id, maxSelect: 1, cascadeDelete: true },
      { name: "token", type: "text", required: true, min: 16, max: 64 },
      // Still accepted for 24 h after a rotation (a guest who checked out this morning).
      { name: "previousToken", type: "text", max: 64 },
      { name: "previousValidUntil", type: "date" },
      { name: "stayResponses", type: "number", onlyInt: true, min: 0 },
      { name: "previousStayResponses", type: "number", onlyInt: true, min: 0 },
      { name: "rotatedAt", type: "date" },
      { name: "printedAt", type: "date" },
      { name: "active", type: "bool" },
    ].concat(stamps()),
    indexes: [
      "CREATE UNIQUE INDEX idx_review_tokens_token ON reviewSurveyTokens (token)",
      "CREATE UNIQUE INDEX idx_review_tokens_slot ON reviewSurveyTokens (hotel, kind, room)",
    ],
    listRule: can("reviews.manage"),
    viewRule: can("reviews.manage"),
  }, serverOnly));
  app.save(tokens);

  const reviews = new Collection(Object.assign({
    type: "base",
    name: "reviews",
    fields: [
      hotel,
      sel("platform", PLATFORMS, true),
      sel("channel", CHANNELS, true),
      { name: "listing", type: "relation", collectionId: sources.id, maxSelect: 1, cascadeDelete: false },
      { name: "externalId", type: "text", max: 160 },
      { name: "url", type: "text", max: 500 },
      { name: "title", type: "text", max: 300 },
      // Redacted (no phone, e-mail, national ID, handle or link); emptied after the retention period.
      { name: "text", type: "text", max: 8000 },
      { name: "textKey", type: "text", max: 8000, hidden: true },
      { name: "authorHash", type: "text", max: 80, hidden: true },
      { name: "ratingRaw", type: "number" },
      { name: "scaleMin", type: "number" },
      { name: "scaleMax", type: "number" },
      { name: "rating5", type: "number", min: 1, max: 5 },
      { name: "lang", type: "text", max: 10 },
      { name: "postedAt", type: "date" },
      { name: "editedAt", type: "date" },
      { name: "deletedAt", type: "date" },
      sel("status", STATUSES, true),
      { name: "matchScore", type: "number" },
      { name: "matchReasons", type: "json", maxSize: 2000 },
      { name: "candidates", type: "json", maxSize: 2000, hidden: true },
      { name: "textPurgedAt", type: "date" },
      { name: "capturedBy", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "decidedBy", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "decidedAt", type: "date" },
    ].concat(stamps()),
    indexes: [
      "CREATE UNIQUE INDEX idx_reviews_ext ON reviews (hotel, platform, externalId) WHERE externalId != ''",
      "CREATE INDEX idx_reviews_hotel_status ON reviews (hotel, status, postedAt)",
    ],
    // Accepted reviews only; the queue is a reviews.manage route.
    listRule: `${can("reviews.view")} && status = 'active'`,
    viewRule: `${can("reviews.view")} && status = 'active'`,
  }, serverOnly));
  app.save(reviews);
  // A review posted on two platforms is counted once: the later copy points at the first.
  const saved = app.findCollectionByNameOrId("reviews");
  saved.fields.add(new RelationField({ name: "duplicateOf", collectionId: saved.id, maxSelect: 1, cascadeDelete: false }));
  app.save(saved);

  resyncUsers(app);
}, (app) => {
  for (const name of NAMES) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const ids = [];
  for (const code of CODES) {
    try { ids.push(app.findFirstRecordByFilter("permissions", "code = {:c}", { c: code }).id); } catch (_) {}
  }
  for (const name of ["users", "roleTemplates", "roleOverrides"]) {
    for (const r of app.findAllRecords(name)) {
      const current = r.getStringSlice("permissions");
      const next = current.filter((id) => ids.indexOf(id) < 0);
      if (next.length === current.length) continue;
      r.set("permissions", next);
      if (name === "users") app.saveNoValidate(r);
      else app.save(r);
    }
  }
  for (const id of ids) app.delete(app.findRecordById("permissions", id));
  setMaxSelect(app, app.findAllRecords("permissions").length);
});
