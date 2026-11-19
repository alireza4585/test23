/// <reference path="../pb_data/types.d.ts" />
/**
 * F10 R2: analysis, daily digest, e-mail intake. Additive; down restores exactly.
 *
 *   reviewAnalyses   one per review: method (llm | rules), aspects with evidence
 *                    spans, sentiment, the LLM's inferred rating and confidence;
 *                    evidence is emptied with the review text at retention
 *   reviewDigests    one per hotel and day: counts by channel group, the rated
 *                    average and the estimated satisfaction (separate scores,
 *                    each with its n), themes, the rule-built text
 *   reviews          + analyzedAt (empty: waiting for analysis), + intakeKey
 *                    (hidden HMAC of an e-mail's Message-ID: each mail once)
 *   reviewProfiles   + inboundToken: the hotel's unguessable mail address part
 *                    (r-<token>@<platform mail domain>), rotatable
 */
migrate((app) => {
  const hotels = app.findCollectionByNameOrId("hotels");
  const reviews = app.findCollectionByNameOrId("reviews");
  const SA = "@request.auth.role = 'superAdmin'";
  const can = (p) => `(@request.auth.activeHotel = hotel || ${SA}) && @request.auth.permissions.code ?= '${p}'`;
  const hotel = { name: "hotel", type: "relation", collectionId: hotels.id, maxSelect: 1, required: true, cascadeDelete: true };
  const stamps = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  app.save(new Collection({
    type: "base",
    name: "reviewAnalyses",
    fields: [
      hotel,
      { name: "review", type: "relation", collectionId: reviews.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "method", type: "select", maxSelect: 1, values: ["llm", "rules"], required: true },
      { name: "model", type: "text", max: 120 },
      { name: "promptVersion", type: "text", max: 20 },
      { name: "lang", type: "text", max: 10 },
      { name: "sentiment", type: "number", min: -1, max: 1 },
      { name: "label", type: "select", maxSelect: 1, values: ["pos", "neg", "mixed", "neutral"] },
      { name: "aspects", type: "json", maxSize: 20000 },
      { name: "inferredRating", type: "number", min: 0, max: 5 },
      { name: "confidence", type: "number", min: 0, max: 1 },
      { name: "tokens", type: "number", min: 0, onlyInt: true },
      { name: "fallbackReason", type: "text", max: 200 },
    ].concat(stamps),
    indexes: [
      "CREATE UNIQUE INDEX idx_review_analyses_review ON reviewAnalyses (review)",
      "CREATE INDEX idx_review_analyses_hotel ON reviewAnalyses (hotel, created)",
    ],
    listRule: can("reviews.view"),
    viewRule: can("reviews.view"),
    createRule: null, updateRule: null, deleteRule: null,
  }));

  app.save(new Collection({
    type: "base",
    name: "reviewDigests",
    fields: [
      hotel,
      { name: "day", type: "text", required: true, max: 10 },
      { name: "newCount", type: "number", min: 0, onlyInt: true },
      { name: "byGroup", type: "json", maxSize: 2000 },
      { name: "rated", type: "json", maxSize: 4000 },
      { name: "estimated", type: "json", maxSize: 1000 },
      { name: "trend", type: "json", maxSize: 2000 },
      { name: "themes", type: "json", maxSize: 20000 },
      { name: "facts", type: "json", maxSize: 5000 },
      { name: "text", type: "text", max: 5000 },
      { name: "backlog", type: "number", min: 0, onlyInt: true },
      { name: "reviewIds", type: "json", maxSize: 50000 },
      { name: "generatedAt", type: "date" },
    ].concat(stamps),
    indexes: ["CREATE UNIQUE INDEX idx_review_digests_day ON reviewDigests (hotel, day)"],
    listRule: can("reviews.view"),
    viewRule: can("reviews.view"),
    createRule: null, updateRule: null, deleteRule: null,
  }));

  reviews.fields.add(new DateField({ name: "analyzedAt" }));
  // HMAC of the e-mail's Message-ID: the same mail is taken once; the mail itself is not kept.
  reviews.fields.add(new TextField({ name: "intakeKey", max: 80, hidden: true }));
  reviews.addIndex("idx_reviews_intake", true, "hotel, intakeKey", "intakeKey != ''");
  reviews.addIndex("idx_reviews_pending", false, "hotel, status, analyzedAt", "");
  app.save(reviews);

  const profiles = app.findCollectionByNameOrId("reviewProfiles");
  profiles.fields.add(new TextField({ name: "inboundToken", max: 64 }));
  profiles.addIndex("idx_review_profiles_inbound", true, "inboundToken", "inboundToken != ''");
  app.save(profiles);
}, (app) => {
  const profiles = app.findCollectionByNameOrId("reviewProfiles");
  profiles.removeIndex("idx_review_profiles_inbound");
  profiles.fields.removeByName("inboundToken");
  app.save(profiles);
  const reviews = app.findCollectionByNameOrId("reviews");
  reviews.removeIndex("idx_reviews_pending");
  reviews.removeIndex("idx_reviews_intake");
  reviews.fields.removeByName("intakeKey");
  reviews.fields.removeByName("analyzedAt");
  app.save(reviews);
  for (const name of ["reviewDigests", "reviewAnalyses"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
