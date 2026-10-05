import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { INTEGRATION_SECRET, REGION, TIMEZONE } from "../config";
import { Role } from "../domain/rbac";
import { addDays, dayKey, db, FieldValue, paths } from "../lib/admin";
import { raiseAlert } from "../lib/alerts";
import { emitEvent } from "../lib/n8n";
import { notify } from "../lib/notify";
import { activeHotelIds, loadHotelData } from "./loader";
import { computeDailyMetrics } from "./metrics";
import { generateInsights, InsightDraft } from "./rules-engine";
import { isActiveTicket } from "./types";

/**
 * Nightly rollup (00:20 Tehran): writes yesterday's KPIs to
 * `hotels/{id}/dailyMetrics/{day}` for every active hotel.
 */
export const analyticsDailyRollup = onSchedule(
  { region: REGION, schedule: "20 0 * * *", timeZone: TIMEZONE, retryCount: 2 },
  async () => {
    const now = new Date();
    const yesterday = addDays(dayKey(now, TIMEZONE), -1);
    for (const hotelId of await activeHotelIds()) {
      const data = await loadHotelData(hotelId, addDays(yesterday, -2), now);
      const metrics = computeDailyMetrics({
        day: yesterday,
        now,
        dayKeyOf: (d) => dayKey(d, TIMEZONE),
        settings: data.settings,
        operations: data.operations.find((o) => o.day === yesterday),
        energy: data.energy,
        tickets: data.tickets,
        tasks: data.tasks,
        items: data.items,
        rooms: data.rooms,
      });
      await db.doc(`${paths.metrics(hotelId)}/${yesterday}`).set({
        ...metrics,
        generatedAt: FieldValue.serverTimestamp(),
      });
      logger.info("daily metrics written", { hotelId, day: yesterday });
    }
  },
);

/**
 * Morning insight run (06:40 Tehran): rule engine → `aiInsights`, plus SLA
 * breach alerts. Insight ids are stable per rule & subject, so re-runs update
 * instead of duplicating, and dismissed insights stay quiet for 14 days.
 */
export const aiGenerateInsights = onSchedule(
  {
    region: REGION,
    schedule: "40 6 * * *",
    timeZone: TIMEZONE,
    secrets: [INTEGRATION_SECRET],
    retryCount: 1,
  },
  async () => {
    const now = new Date();
    const today = dayKey(now, TIMEZONE);
    for (const hotelId of await activeHotelIds()) {
      await runInsightsForHotel(hotelId, today, now);
    }
  },
);

export async function runInsightsForHotel(hotelId: string, today: string, now: Date): Promise<number> {
  const data = await loadHotelData(hotelId, addDays(today, -35), now);
  const drafts = generateInsights({ ...data, today, now, addDays });
  let created = 0;
  for (const draft of drafts) {
    if (await upsertInsight(hotelId, draft, now)) created++;
  }

  // SLA breaches become alerts (one per ticket).
  for (const t of data.tickets.filter((t) => isActiveTicket(t) && t.slaDueAt && t.slaDueAt < now)) {
    await raiseAlert({
      hotelId,
      type: "maintenanceSla",
      severity: t.priority === "critical" || t.priority === "high" ? "critical" : "warning",
      title: `عبور از SLA: ${t.title}`,
      message: `محل: ${t.roomNumber ?? t.area ?? "—"}`,
      route: `/maintenance/${t.id}`,
      audienceRoles: ["maintenanceManager", "operationsManager"],
      dedupeKey: `sla_${t.id}`,
      source: "ruleEngine",
    });
  }
  return created;
}

async function upsertInsight(hotelId: string, draft: InsightDraft, now: Date): Promise<boolean> {
  const ref = db.doc(`${paths.insights(hotelId)}/${draft.id}`);
  const snap = await ref.get();
  const { audienceRoles, ...fields } = draft;
  if (snap.exists) {
    const status = snap.get("status");
    const updatedAt = snap.get("updatedAt")?.toDate?.() as Date | undefined;
    const recentlyHandled =
      status !== "active" && updatedAt && now.getTime() - updatedAt.getTime() < 14 * 864e5;
    if (recentlyHandled) return false;
    if (status === "active") {
      await ref.update({ ...fields, refreshedAt: FieldValue.serverTimestamp() });
      return false;
    }
  }
  await ref.set({
    ...fields,
    status: "active",
    source: "ruleEngine",
    audienceRoles,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (draft.priority === "high") {
    await notify({
      hotelId,
      roles: audienceRoles as Role[],
      title: draft.title,
      body: draft.recommendation,
      category: "ai",
      severity: "warning",
      route: "/insights",
    });
  }
  await emitEvent("insight.created", hotelId, { insightId: draft.id, title: draft.title, priority: draft.priority });
  return true;
}
