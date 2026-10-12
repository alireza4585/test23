/// <reference path="../pb_data/types.d.ts" />
/**
 * Optional dedupe key on the notification log: POST /v1/hotels/{id}/notifications
 * with the same key inside its window is skipped (n8n's 30-minute SLA
 * escalation no longer repeats the same warning every run).
 */
migrate((app) => {
  const c = app.findCollectionByNameOrId("notifications");
  c.fields.add(new TextField({ name: "dedupeKey", max: 160 }));
  c.indexes.push("CREATE INDEX idx_notifications_dedupe ON notifications (hotel, dedupeKey)");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("notifications");
  c.indexes = c.indexes.filter((i) => i.indexOf("idx_notifications_dedupe") < 0);
  c.fields.removeByName("dedupeKey");
  app.save(c);
});
