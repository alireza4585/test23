import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { loadHotelData } from "../analytics/loader";
import { AI_MODEL, AI_RATE_LIMIT_PER_HOUR, ANTHROPIC_API_KEY, REGION, TIMEZONE } from "../config";
import { addDays, dayKey, db, FieldValue, paths } from "../lib/admin";
import { requireCaller, requireHotel, requirePermission } from "../lib/guards";
import { buildHotelContext } from "./context";
import { AnthropicProvider, LlmProvider } from "./provider";

const AskSchema = z.object({
  hotelId: z.string().min(1),
  question: z.string().trim().min(2).max(1000),
  locale: z.enum(["fa", "en"]).default("fa"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(12)
    .default([]),
});

export const SYSTEM_PROMPT = `You are "Zarin", the operations analyst inside Zarin Hooshmand, a hotel
management and optimization platform used by hotel executives and department managers in Iran.

You receive a JSON snapshot of the hotel's recent operational data inside <hotel_data>. Answer the
user's question using only that data:
- Lead with the direct answer, then the 2–4 numbers that support it, then concrete next actions
  the hotel team can take this week.
- When you attribute a cause, say how confident you are and what evidence would confirm it
  (e.g. "a technician reading the chiller's refrigerant pressure").
- If the data does not contain what is needed, say so plainly and name the data that is missing.
- Quantify money in Iranian rial (IRR) using the tariffs and ADR in the data; round sensibly.
- Hospitality KPIs: occupancy = sold/available, ADR = room revenue/sold rooms,
  RevPAR = room revenue/available rooms, energy intensity = kWh per occupied room.
- Reply in the user's language (Persian with Persian digits when the locale is "fa").
- Keep answers under 220 words and use short paragraphs or a brief numbered list.
You advise; managers decide. Never invent figures that are not in the data.`;

/** `1234.5` → `۱٬۲۳۴٫۵` (matches the app's Persian number formatting). */
function faNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
    .format(value)
    .replace(/,/g, "٬")
    .replace(/\./g, "٫")
    .replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** Simple fixed-window rate limit per user (cost control). */
async function consumeQuota(uid: string, now: Date): Promise<void> {
  const window = now.toISOString().slice(0, 13); // yyyy-MM-ddTHH
  const ref = db.doc(`users/${uid}/usage/ai_${window}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.get("count") as number | undefined) ?? 0;
    if (count >= AI_RATE_LIMIT_PER_HOUR) {
      throw new HttpsError("resource-exhausted", "Assistant hourly limit reached");
    }
    tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export async function answerQuestion(
  provider: LlmProvider,
  input: z.infer<typeof AskSchema>,
  now: Date,
): Promise<{ answer: string; dataPoints: string[]; model: string; status: string; usage: unknown }> {
  const today = dayKey(now, TIMEZONE);
  const data = await loadHotelData(input.hotelId, addDays(today, -35), now);
  const insights = await db
    .collection(paths.insights(input.hotelId))
    .where("status", "==", "active")
    .limit(8)
    .get();
  const context = buildHotelContext(data, {
    now,
    today,
    addDays,
    dayKeyOf: (d) => dayKey(d, TIMEZONE),
    insights: insights.docs.map((d) => ({ title: d.get("title"), summary: d.get("summary") })),
  });

  // The Messages API requires the conversation to start with a user turn.
  const history = [...input.history];
  while (history.length > 0 && history[0].role === "assistant") history.shift();

  const result = await provider.complete({
    system: SYSTEM_PROMPT,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.text })),
      {
        role: "user" as const,
        content: `<hotel_data>\n${JSON.stringify(context)}\n</hotel_data>\n\nlocale: ${input.locale}\n\n${input.question}`,
      },
    ],
  });

  const answer =
    result.status === "refused"
      ? input.locale === "fa"
        ? "متأسفانه امکان پاسخ به این پرسش وجود ندارد. لطفاً پرسش را درباره عملکرد هتل مطرح کنید."
        : "I can't help with that request. Please ask about the hotel's operations."
      : result.text;

  const latest = context.last14Days[context.last14Days.length - 1];
  return {
    answer,
    dataPoints:
      input.locale === "fa"
        ? [
            `اشغال ${faNumber(latest?.occupancyRate)}٪`,
            `برق ${faNumber(latest?.energy.electricity)} kWh`,
            `تیکت باز ${faNumber(context.openTickets.length)}`,
          ]
        : [
            `occupancy ${latest?.occupancyRate ?? "—"}%`,
            `electricity ${latest?.energy.electricity ?? "—"} kWh`,
            `open tickets ${context.openTickets.length}`,
          ],
    model: result.model,
    status: result.status,
    usage: result.usage,
  };
}

/**
 * `aiAssistant` callable: authorises (role + tenant), rate-limits, grounds
 * the question in the hotel's analytics and logs the exchange for audit.
 */
export const aiAssistant = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const caller = requireCaller(request);
    const input = AskSchema.parse(request.data);
    requireHotel(caller, input.hotelId);
    requirePermission(caller, "ai.assistant.use");
    const now = new Date();
    await consumeQuota(caller.uid, now);

    const provider = new AnthropicProvider(ANTHROPIC_API_KEY.value(), AI_MODEL.value());
    try {
      const result = await answerQuestion(provider, input, now);
      await db.collection(paths.conversations(input.hotelId)).add({
        uid: caller.uid,
        role: caller.role,
        question: input.question,
        answer: result.answer,
        model: result.model,
        status: result.status,
        usage: result.usage,
        at: FieldValue.serverTimestamp(),
      });
      return { answer: result.answer, dataPoints: result.dataPoints };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("assistant failed", { err: String(err) });
      throw new HttpsError("unavailable", "Assistant temporarily unavailable");
    }
  },
);
