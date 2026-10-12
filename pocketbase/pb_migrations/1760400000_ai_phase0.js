/// <reference path="../pb_data/types.d.ts" />
/**
 * AI phase 0 (foundation & security), additive only:
 * - aiConversations.thread: assistant history is read back on the server
 *   (the client's history is ignored).
 * - integrationKeys: scoped signing keys for the integration API (n8n, the
 *   AI worker). The secret is stored encrypted with ZH_SECRETS_KEY; there are
 *   no API rules, so only superusers (and hooks) can read the collection.
 * - integrationNonces: replay guard for key-signed requests.
 * - aiBudgets: monthly LLM usage per hotel (shared by ai.js and the worker).
 */
migrate((app) => {
  const hotels = app.findCollectionByNameOrId("hotels");
  const perm = (p) => `@request.auth.permissions.code ?= '${p}'`;
  const member = "(@request.auth.hotels.id ?= hotel || @request.auth.role = 'superAdmin')";
  const stamps = () => [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  const conv = app.findCollectionByNameOrId("aiConversations");
  conv.fields.add(new TextField({ name: "thread", max: 40 }));
  conv.indexes.push("CREATE INDEX idx_ai_conversations_thread ON aiConversations (hotel, user, thread)");
  app.save(conv);

  app.save(new Collection({
    type: "base",
    name: "integrationKeys",
    fields: [
      { name: "keyId", type: "text", required: true, max: 40, pattern: "^[a-z0-9_-]{8,40}$" },
      { name: "secretEnc", type: "text", required: true, max: 500, hidden: true },
      { name: "hotels", type: "relation", collectionId: hotels.id, maxSelect: 999, cascadeDelete: false },
      { name: "label", type: "text", max: 80 },
      { name: "active", type: "bool" },
      { name: "lastUsedAt", type: "date" },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_integration_keys_id ON integrationKeys (keyId)"],
  }));

  app.save(new Collection({
    type: "base",
    name: "integrationNonces",
    fields: [
      { name: "keyId", type: "text", required: true, max: 40 },
      { name: "nonce", type: "text", required: true, max: 64 },
    ].concat(stamps()),
    indexes: [
      "CREATE UNIQUE INDEX idx_integration_nonces ON integrationNonces (keyId, nonce)",
      "CREATE INDEX idx_integration_nonces_created ON integrationNonces (created)",
    ],
  }));

  app.save(new Collection({
    type: "base",
    name: "aiBudgets",
    fields: [
      { name: "hotel", type: "relation", collectionId: hotels.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "month", type: "text", required: true, pattern: "^[0-9]{4}-[0-9]{2}$" },
      { name: "calls", type: "number", onlyInt: true },
      { name: "tokensIn", type: "number", onlyInt: true },
      { name: "tokensOut", type: "number", onlyInt: true },
      { name: "costMicros", type: "number", onlyInt: true },
    ].concat(stamps()),
    indexes: ["CREATE UNIQUE INDEX idx_ai_budgets ON aiBudgets (hotel, month)"],
    listRule: `${member} && ${perm("hotel.settings")}`,
    viewRule: `${member} && ${perm("hotel.settings")}`,
  }));
}, (app) => {
  for (const name of ["aiBudgets", "integrationNonces", "integrationKeys"]) {
    app.delete(app.findCollectionByNameOrId(name));
  }
  const conv = app.findCollectionByNameOrId("aiConversations");
  conv.indexes = conv.indexes.filter((i) => i.indexOf("idx_ai_conversations_thread") < 0);
  conv.fields.removeByName("thread");
  app.save(conv);
});
