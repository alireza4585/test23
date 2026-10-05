/// <reference path="../../pb_data/types.d.ts" />
/**
 * AI assistant & executive narrative (ports ai/*.ts).
 *
 * Provider is chosen by environment so the same build runs anywhere:
 *   ZH_AI_PROVIDER = anthropic | openai_compatible | none (default)
 *   ZH_AI_API_KEY, ZH_AI_MODEL, ZH_AI_BASE_URL (openai_compatible: e.g. a
 *   self-hosted Ollama/vLLM endpoint)
 * With no provider, or when the provider fails, answers come from a
 * deterministic summary of the same data — the assistant never goes dark.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const analytics = require(`${__hooks}/lib/analytics.js`);
const core = z.core;

const RATE_LIMIT_PER_HOUR = 30;

const SYSTEM_PROMPT = `You are "Zarin", the operations analyst inside Zarin Hooshmand, a hotel
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

// ---------------------------------------------------------------- context
function buildContext(app, hotelId, now) {
  const today = z.dayKey(now);
  const data = analytics.loadHotelData(app, hotelId, z.addDays(today, -35), now);
  const last14Days = [];
  for (let i = 14; i >= 1; i--) {
    const day = z.addDays(today, -i);
    const m = core.computeDailyMetrics({
      day, now, dayKeyOf: z.dayKey, settings: data.settings,
      operations: data.operations.find((o) => o.day === day),
      energy: data.energy, tickets: [], tasks: [], items: [], rooms: [],
    });
    last14Days.push({
      day, occupancyRate: m.occupancyRate, adr: m.adr, revpar: m.revpar, totalRevenue: m.totalRevenue,
      energy: m.energy, electricityPerOccupiedRoom: m.electricityPerOccupiedRoom,
    });
  }
  const roomsNow = {};
  for (const r of data.rooms) roomsNow[r.status] = (roomsNow[r.status] || 0) + 1;
  const rank = { critical: 3, high: 2, medium: 1, low: 0 };
  const openTickets = data.tickets
    .filter(core.isActiveTicket)
    .sort((a, b) => rank[b.priority] - rank[a.priority])
    .slice(0, 12)
    .map((t) => ({
      title: t.title, category: t.category, priority: t.priority, status: t.status,
      location: t.roomNumber ? `room ${t.roomNumber}` : t.area || "—",
      ageHours: t.createdAt ? Math.round((now.getTime() - t.createdAt.getTime()) / 36e5) : null,
      overdue: !!t.slaDueAt && t.slaDueAt < now,
    }));
  const insights = z.findMany(app, "aiInsights", "hotel = {:h} && status = 'active'", { h: hotelId }, "-created", 8)
    .map((i) => ({ title: i.getString("title"), summary: i.getString("summary") }));
  return {
    hotel: data.name,
    generatedAt: now.toISOString(),
    today,
    baselines: data.settings.energyDailyBaseline,
    tariffs: data.settings.energyTariff,
    last14Days,
    roomsNow,
    openTickets,
    lowStock: data.items
      .filter((i) => i.quantity <= i.reorderLevel)
      .map((i) => ({ name: i.name, quantity: i.quantity, reorderLevel: i.reorderLevel, unit: i.unit })),
    activeInsights: insights,
  };
}

// ---------------------------------------------------------------- numbers
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function num(value, locale, decimals) {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  const fixed = Math.abs(value).toFixed(decimals || 0).split(".");
  const sep = locale === "fa" ? "٬" : ",";
  let out = (value < 0 ? "-" : "") + fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  if (fixed[1] && Number(fixed[1]) !== 0) out += (locale === "fa" ? "٫" : ".") + fixed[1];
  return locale === "fa" ? out.replace(/\d/g, (d) => FA_DIGITS[Number(d)]) : out;
}

// -------------------------------------------------------------- providers
function provider() {
  const kind = $os.getenv("ZH_AI_PROVIDER") || "none";
  return {
    kind,
    key: $os.getenv("ZH_AI_API_KEY"),
    model: $os.getenv("ZH_AI_MODEL") || (kind === "anthropic" ? "claude-opus-5-5" : ""),
    baseUrl: ($os.getenv("ZH_AI_BASE_URL") || "").replace(/\/+$/, ""),
  };
}

/** Returns {text, model, status: ok|refused|truncated, usage} or throws. */
function complete(system, messages, maxTokens) {
  const p = provider();
  if (p.kind === "anthropic") {
    if (!p.key) throw new Error("ZH_AI_API_KEY missing");
    const res = $http.send({
      url: `${p.baseUrl || "https://api.anthropic.com"}/v1/messages`,
      method: "POST",
      timeout: 90,
      headers: {
        "content-type": "application/json",
        "x-api-key": p.key,
        "anthropic-version": "2023-06-01",
        // Re-run declined requests on the recommended fallback model.
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: p.model,
        max_tokens: maxTokens || 16000,
        output_config: { effort: "medium" },
        fallbacks: "default",
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
      }),
    });
    if (res.statusCode !== 200) throw new Error(`anthropic ${res.statusCode}: ${toString(res.body).slice(0, 300)}`);
    const j = res.json;
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return {
      text,
      model: j.model,
      status: j.stop_reason === "refusal" ? "refused" : j.stop_reason === "max_tokens" ? "truncated" : "ok",
      usage: j.usage || null,
    };
  }
  if (p.kind === "openai_compatible") {
    if (!p.baseUrl || !p.model) throw new Error("ZH_AI_BASE_URL / ZH_AI_MODEL missing");
    const headers = { "content-type": "application/json" };
    if (p.key) headers.authorization = `Bearer ${p.key}`;
    const res = $http.send({
      url: `${p.baseUrl}/v1/chat/completions`,
      method: "POST",
      timeout: 120,
      headers,
      body: JSON.stringify({
        model: p.model,
        max_tokens: Math.min(maxTokens || 4000, 4000),
        messages: [{ role: "system", content: system }].concat(messages),
      }),
    });
    if (res.statusCode !== 200) throw new Error(`llm ${res.statusCode}: ${toString(res.body).slice(0, 300)}`);
    const choice = (res.json.choices || [])[0] || {};
    return {
      text: String((choice.message || {}).content || "").trim(),
      model: res.json.model || p.model,
      status: choice.finish_reason === "length" ? "truncated" : "ok",
      usage: res.json.usage || null,
    };
  }
  throw new Error("no_provider");
}

// ---------------------------------------------------- deterministic answer
function topicOf(q) {
  const s = q.toLowerCase();
  if (/برق|انرژی|مصرف|آب|گاز|energy|electric|water|gas/.test(s)) return "energy";
  if (/خرابی|تعمیر|تیکت|sla|maintenance|ticket|repair/.test(s)) return "maintenance";
  if (/انبار|موجودی|کالا|سفارش|stock|inventory|order/.test(s)) return "inventory";
  if (/اشغال|درآمد|فروش|occupancy|revenue|adr|revpar/.test(s)) return "revenue";
  return "overview";
}

function avg(list) {
  const v = list.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Fact-based answer from the same context (no LLM). */
function ruleAnswer(ctx, question, locale) {
  const fa = locale === "fa";
  const n = (v, d) => num(v, locale, d);
  const days = ctx.last14Days;
  const recent = days.slice(-4);
  const prior = days.slice(0, -4);
  const lines = [];
  const topic = topicOf(question);

  if (topic === "energy" || topic === "overview") {
    const eRecent = avg(recent.map((d) => d.energy.electricity));
    const ePrior = avg(prior.map((d) => d.energy.electricity));
    const iRecent = avg(recent.map((d) => d.electricityPerOccupiedRoom));
    const iPrior = avg(prior.map((d) => d.electricityPerOccupiedRoom));
    const base = ctx.baselines.electricity;
    if (eRecent !== null) {
      const change = ePrior ? ((eRecent - ePrior) / ePrior) * 100 : null;
      lines.push(fa
        ? `میانگین مصرف برق ۴ روز اخیر ${n(eRecent)} کیلووات‌ساعت بوده${change !== null ? ` (${n(change, 0)}٪ نسبت به ۱۰ روز قبل)` : ""}؛ خط مبنا ${n(base)} است.`
        : `Electricity averaged ${n(eRecent)} kWh over the last 4 days${change !== null ? ` (${n(change, 0)}% vs the previous 10 days)` : ""}; baseline ${n(base)}.`);
      if (iRecent !== null && iPrior !== null) {
        lines.push(fa
          ? `شدت مصرف به ازای هر اتاق اشغال از ${n(iPrior, 1)} به ${n(iRecent, 1)} رسیده؛ اگر اشغال ثابت مانده، احتمالاً منشأ آن تجهیزات (HVAC، چیلر) یا اتاق‌های خالیِ روشن است.`
          : `Energy per occupied room moved from ${n(iPrior, 1)} to ${n(iRecent, 1)}; with flat occupancy this usually points to HVAC/chiller load or vacant rooms left running.`);
      }
    } else {
      lines.push(fa ? "قرائت برق در ۱۴ روز اخیر ثبت نشده است." : "No electricity readings in the last 14 days.");
    }
  }
  if (topic === "maintenance" || topic === "overview") {
    const overdue = ctx.openTickets.filter((t) => t.overdue);
    lines.push(fa
      ? `${n(ctx.openTickets.length)} خرابی باز وجود دارد که ${n(overdue.length)} مورد از SLA گذشته است.`
      : `${ctx.openTickets.length} open tickets, ${overdue.length} past SLA.`);
    for (const t of (overdue.length ? overdue : ctx.openTickets).slice(0, 3)) {
      lines.push(`• ${t.title} — ${t.location} (${t.priority})`);
    }
  }
  if (topic === "inventory" || topic === "overview") {
    lines.push(fa
      ? `${n(ctx.lowStock.length)} قلم زیر نقطهٔ سفارش است.`
      : `${ctx.lowStock.length} items are at or below reorder level.`);
    for (const i of ctx.lowStock.slice(0, 4)) lines.push(`• ${i.name}: ${n(i.quantity)} ${i.unit} / ${n(i.reorderLevel)}`);
  }
  if (topic === "revenue" || topic === "overview") {
    const occ = avg(days.slice(-7).map((d) => d.occupancyRate));
    const revpar = avg(days.slice(-7).map((d) => d.revpar));
    lines.push(fa
      ? `میانگین اشغال ۷ روز اخیر ${n(occ, 1)}٪ و RevPAR ${n(revpar)} ریال است.`
      : `7-day occupancy averaged ${n(occ, 1)}% with RevPAR ${n(revpar)} IRR.`);
  }
  if (ctx.activeInsights.length) {
    lines.push(fa ? `پیشنهاد فعال: ${ctx.activeInsights[0].title}` : `Top active insight: ${ctx.activeInsights[0].title}`);
  }
  return lines.join("\n");
}

function dataPoints(ctx, locale) {
  const latest = ctx.last14Days[ctx.last14Days.length - 1] || { energy: {} };
  const n = (v, d) => num(v, locale, d);
  return locale === "fa"
    ? [`اشغال ${n(latest.occupancyRate, 1)}٪`, `برق ${n(latest.energy.electricity)} kWh`, `تیکت باز ${n(ctx.openTickets.length)}`]
    : [`occupancy ${n(latest.occupancyRate, 1)}%`, `electricity ${n(latest.energy.electricity)} kWh`, `open tickets ${ctx.openTickets.length}`];
}

// ------------------------------------------------------------------ routes
function consumeQuota(app, userId, now) {
  const window = now.toISOString().slice(0, 13);
  let rec = z.findFirst(app, "aiUsage", "user = {:u} && window = {:w}", { u: userId, w: window });
  if (!rec) rec = new Record(z.col(app, "aiUsage"), { user: userId, window, count: 0 });
  if (rec.getInt("count") >= RATE_LIMIT_PER_HOUR) throw new TooManyRequestsError("assistant_rate_limited", z.details("assistant_rate_limited"));
  rec.set("count", rec.getInt("count") + 1);
  app.save(rec);
}

/** POST /api/zarin/ai/ask  {hotelId, question, locale, history[]} */
function ask(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const hotelId = z.requireHotel(c, b.hotelId);
  z.requirePerm(c, "ai.assistant.use");
  const question = String(b.question || "").trim();
  if (question.length < 2 || question.length > 1000) throw z.bad("invalid_question");
  const locale = b.locale === "en" ? "en" : "fa";
  const now = new Date();
  consumeQuota(e.app, c.id, now);

  const ctx = buildContext(e.app, hotelId, now);
  const history = (Array.isArray(b.history) ? b.history : [])
    .slice(-12)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .map((m) => ({ role: m.role, content: m.text.slice(0, 4000) }));
  while (history.length && history[0].role === "assistant") history.shift();

  let answer;
  let model = "rules";
  let status = "ok";
  let usage = null;
  try {
    const r = complete(SYSTEM_PROMPT, history.concat([{
      role: "user",
      content: `<hotel_data>\n${JSON.stringify(ctx)}\n</hotel_data>\n\nlocale: ${locale}\n\n${question}`,
    }]));
    model = r.model;
    status = r.status;
    usage = r.usage;
    answer = r.status === "refused"
      ? (locale === "fa"
        ? "متأسفانه امکان پاسخ به این پرسش وجود ندارد. لطفاً پرسش را درباره عملکرد هتل مطرح کنید."
        : "I can't help with that request. Please ask about the hotel's operations.")
      : r.text;
  } catch (err) {
    if (String(err).indexOf("no_provider") < 0) console.log("ai provider failed:", String(err));
    answer = ruleAnswer(ctx, question, locale);
    status = String(err).indexOf("no_provider") >= 0 ? "ok" : "fallback";
  }

  e.app.save(new Record(z.col(e.app, "aiConversations"), {
    hotel: hotelId, user: c.id, role: c.role, question, answer, model, status, usage,
  }));
  return e.json(200, { answer, dataPoints: dataPoints(ctx, locale), model });
}

/** Executive briefing for the n8n morning report; null when no LLM is available. */
function narrate(summary, locale) {
  try {
    const r = complete(
      "You write the morning management briefing for a hotel general manager. Use only the JSON you are given. " +
      "Structure: one-sentence headline; 3–5 bullet points with the most decision-relevant numbers (occupancy, ADR, " +
      "RevPAR, energy vs baseline, maintenance backlog, low stock); then 'Today's priorities' with up to 3 actions " +
      "drawn from the alerts and insights. Max 180 words. Write in " +
      (locale === "fa" ? "Persian with Persian digits." : "English."),
      [{ role: "user", content: JSON.stringify(summary) }],
      8000,
    );
    return r.status === "ok" ? r.text : null;
  } catch (_) {
    return null;
  }
}

module.exports = { ask, narrate, buildContext, ruleAnswer, num };
