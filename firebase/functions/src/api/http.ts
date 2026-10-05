import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import { runInsightsForHotel } from "../analytics/scheduled";
import { loadHotelData } from "../analytics/loader";
import { computeDailyMetrics } from "../analytics/metrics";
import { isActiveTicket } from "../analytics/types";
import { AnthropicProvider } from "../ai/provider";
import { AI_MODEL, ANTHROPIC_API_KEY, INTEGRATION_SECRET, REGION, TIMEZONE } from "../config";
import { ROLES } from "../domain/rbac";
import { addDays, dayKey, db, FieldValue, paths, Timestamp } from "../lib/admin";
import { writeAudit } from "../lib/audit";
import { notify } from "../lib/notify";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "../lib/signature";

/**
 * Integration API (v1) for n8n, IoT gateways and future partners.
 *
 *   GET  /v1/health
 *   GET  /v1/hotels/:hotelId/summary?day=yyyy-MM-dd[&narrative=fa|en]
 *                                                     KPIs + alerts + insights (+ AI briefing)
 *   GET  /v1/hotels/:hotelId/maintenance/overdue      SLA breaches (escalation)
 *   POST /v1/hotels/:hotelId/notifications            in-app + push to roles/users
 *   POST /v1/hotels/:hotelId/insights                 store an external/LLM insight
 *   POST /v1/hotels/:hotelId/energy/readings          smart-meter / IoT ingestion
 *   POST /v1/hotels/:hotelId/insights/run             run the rule engine now
 *
 * Every request must be HMAC-signed (see lib/signature.ts). The same
 * resource-oriented contract is what the dedicated backend will expose.
 */
export const api = onRequest(
  { region: REGION, secrets: [INTEGRATION_SECRET, ANTHROPIC_API_KEY], cors: false, timeoutSeconds: 180 },
  async (req, res) => {
    const rawBody = req.rawBody?.toString("utf8") ?? "";
    const path = req.path.replace(/\/+$/, "");

    if (path === "/v1/health") {
      res.json({ ok: true, service: "zarin-hooshmand", version: 1 });
      return;
    }
    if (
      !verify(
        INTEGRATION_SECRET.value(),
        req.header(TIMESTAMP_HEADER),
        req.header(SIGNATURE_HEADER),
        rawBody,
      )
    ) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    const match = path.match(/^\/v1\/hotels\/([\w-]+)(\/.*)$/);
    if (!match) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const [, hotelId, sub] = match;
    const hotel = await db.doc(paths.hotel(hotelId)).get();
    if (!hotel.exists) {
      res.status(404).json({ error: "hotel_not_found" });
      return;
    }

    try {
      const route = `${req.method} ${sub}`;
      switch (route) {
        case "GET /summary": {
          const result = await summary(hotelId, req.query.day as string | undefined);
          const locale = req.query.narrative;
          if (locale === "fa" || locale === "en") {
            res.json({ ...result, narrative: await narrate(result, locale) });
          } else {
            res.json(result);
          }
          return;
        }
        case "GET /maintenance/overdue":
          res.json(await overdue(hotelId));
          return;
        case "POST /notifications":
          res.json(await postNotification(hotelId, req.body));
          return;
        case "POST /insights":
          res.json(await postInsight(hotelId, req.body));
          return;
        case "POST /energy/readings":
          res.json(await postReading(hotelId, req.body));
          return;
        case "POST /insights/run":
          res.json({ created: await runInsightsForHotel(hotelId, dayKey(new Date(), TIMEZONE), new Date()) });
          return;
        default:
          res.status(404).json({ error: "not_found" });
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "invalid_body", issues: err.issues });
        return;
      }
      logger.error("api failure", { err: String(err), path });
      res.status(500).json({ error: "internal" });
    }
  },
);

async function summary(hotelId: string, day?: string) {
  const now = new Date();
  const target = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : addDays(dayKey(now, TIMEZONE), -1);
  const data = await loadHotelData(hotelId, addDays(target, -7), now);
  const metrics = computeDailyMetrics({
    day: target,
    now,
    dayKeyOf: (d) => dayKey(d, TIMEZONE),
    settings: data.settings,
    operations: data.operations.find((o) => o.day === target),
    energy: data.energy,
    tickets: data.tickets,
    tasks: data.tasks,
    items: data.items,
    rooms: data.rooms,
  });
  const [alerts, insights] = await Promise.all([
    db.collection(paths.alerts(hotelId)).where("status", "in", ["open", "acknowledged"]).limit(20).get(),
    db.collection(paths.insights(hotelId)).where("status", "==", "active").limit(10).get(),
  ]);
  return {
    hotelId,
    hotel: data.name,
    day: target,
    metrics,
    alerts: alerts.docs.map((d) => ({ id: d.id, severity: d.get("severity"), title: d.get("title"), message: d.get("message") })),
    insights: insights.docs.map((d) => ({
      id: d.id,
      title: d.get("title"),
      recommendation: d.get("recommendation"),
      estimatedMonthlySaving: d.get("estimatedMonthlySaving") ?? null,
    })),
  };
}

/**
 * Executive narrative for scheduled reports (n8n → e-mail / Bale). The LLM
 * only rephrases the computed summary; numbers come from the analytics engine.
 */
async function narrate(data: Awaited<ReturnType<typeof summary>>, locale: "fa" | "en"): Promise<string | null> {
  try {
    const provider = new AnthropicProvider(ANTHROPIC_API_KEY.value(), AI_MODEL.value());
    const result = await provider.complete({
      system:
        "You write the morning management briefing for a hotel general manager. Use only the JSON you are given. " +
        "Structure: one-sentence headline; 3–5 bullet points with the most decision-relevant numbers (occupancy, ADR, " +
        "RevPAR, energy vs baseline, maintenance backlog, low stock); then 'Today's priorities' with up to 3 actions " +
        "drawn from the alerts and insights. Max 180 words. Write in " +
        (locale === "fa" ? "Persian with Persian digits." : "English."),
      messages: [{ role: "user", content: JSON.stringify(data) }],
      maxTokens: 8000,
    });
    return result.status === "ok" ? result.text : null;
  } catch (err) {
    logger.warn("narrative failed", { err: String(err) });
    return null;
  }
}

async function overdue(hotelId: string) {
  const now = new Date();
  const data = await loadHotelData(hotelId, addDays(dayKey(now, TIMEZONE), -1), now);
  return {
    tickets: data.tickets
      .filter((t) => isActiveTicket(t) && t.slaDueAt && t.slaDueAt < now)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        location: t.roomNumber ?? t.area ?? null,
        overdueMinutes: Math.round((now.getTime() - t.slaDueAt!.getTime()) / 60000),
      })),
  };
}

const NotificationBody = z.object({
  roles: z.array(z.enum(ROLES)).max(15).optional(),
  userIds: z.array(z.string()).max(200).optional(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  severity: z.enum(["info", "warning", "critical"]).default("info"),
  category: z.enum(["alert", "task", "maintenance", "inventory", "report", "ai", "system"]).default("system"),
  route: z.string().startsWith("/").max(200).optional(),
});

async function postNotification(hotelId: string, body: unknown) {
  const input = NotificationBody.parse(body);
  const recipients = await notify({ hotelId, ...input, createdBy: "n8n" });
  return { recipients };
}

const InsightBody = z.object({
  id: z.string().regex(/^[\w-]{3,80}$/),
  category: z.enum(["energy", "maintenance", "housekeeping", "inventory", "revenue", "staffing"]),
  title: z.string().min(3).max(160),
  summary: z.string().min(3).max(1200),
  recommendation: z.string().min(3).max(800),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().max(200)).max(10).default([]),
  estimatedMonthlySaving: z.number().nonnegative().optional(),
  route: z.string().startsWith("/").optional(),
  model: z.string().max(80).optional(),
});

async function postInsight(hotelId: string, body: unknown) {
  const input = InsightBody.parse(body);
  await db.doc(`${paths.insights(hotelId)}/llm_${input.id}`).set({
    ...input,
    status: "active",
    source: "llm",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: `llm_${input.id}` };
}

const ReadingBody = z.object({
  type: z.enum(["electricity", "water", "gas"]),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  consumption: z.number().nonnegative().max(1e7),
  meterId: z.string().max(60).optional(),
  meterValue: z.number().optional(),
  source: z.enum(["iot", "smartMeter", "import"]).default("iot"),
});

/** Same document shape as manual entry → analytics never change when meters arrive. */
async function postReading(hotelId: string, body: unknown) {
  const input = ReadingBody.parse(body);
  const [y, m, d] = input.day.split("-").map(Number);
  const id = `${input.day}_${input.type}`;
  await db.doc(`${paths.energy(hotelId)}/${id}`).set(
    {
      type: input.type,
      unit: input.type === "electricity" ? "kWh" : "m³",
      day: input.day,
      date: Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d))),
      consumption: input.consumption,
      meterId: input.meterId ?? null,
      meterValue: input.meterValue ?? null,
      source: input.source,
      recordedBy: { uid: "integration", name: "IoT Gateway", role: "system" },
      recordedByName: "IoT Gateway",
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await writeAudit(hotelId, {
    action: "energyReadings.ingest",
    resource: { collection: "energyReadings", id },
    actor: { uid: "integration", type: "integration" },
    source: "iot",
  });
  return { id };
}
