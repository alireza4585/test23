/// <reference path="../pb_data/types.d.ts" />
/**
 * Outbox delivery lease: a flush claims each event (conditional UPDATE on
 * `lockedUntil`) before sending it, so the per-minute cron and
 * POST /v1/outbox/flush can overlap without delivering an event twice.
 */
migrate((app) => {
  const outbox = app.findCollectionByNameOrId("outbox");
  outbox.fields.add(new DateField({ name: "lockedUntil" }));
  app.save(outbox);
}, (app) => {
  const outbox = app.findCollectionByNameOrId("outbox");
  outbox.fields.removeByName("lockedUntil");
  app.save(outbox);
});
