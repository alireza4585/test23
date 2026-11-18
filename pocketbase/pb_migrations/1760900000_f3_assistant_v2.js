/// <reference path="../pb_data/types.d.ts" />
/**
 * AI phase 2, F3: assistant v2 (flag assistantV2). Additive only.
 *   aiConversations + version ("v1" | "v2"), sources (the chips the app
 *   shows), tools (the calls made) and trace (tool results the LLM saw;
 *   hidden: superusers only, for audits and the eval harness).
 */
migrate((app) => {
  const c = app.findCollectionByNameOrId("aiConversations");
  c.fields.add(new TextField({ name: "version", max: 10 }));
  c.fields.add(new JSONField({ name: "sources", maxSize: 20000 }));
  c.fields.add(new JSONField({ name: "tools", maxSize: 5000 }));
  c.fields.add(new JSONField({ name: "trace", maxSize: 200000, hidden: true }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("aiConversations");
  for (const f of ["trace", "tools", "sources", "version"]) c.fields.removeByName(f);
  app.save(c);
});
