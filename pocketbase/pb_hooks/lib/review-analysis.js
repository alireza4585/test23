/// <reference path="../../pb_data/types.d.ts" />
/**
 * F10 R2: review analysis and the daily digest (flag guestReviews).
 *
 * Analysis (cron every 15 min, and POST /api/zarin/admin/hotels/{id}/reviews/run):
 *   accepted reviews with text and no analysis go to the existing LLM gateway
 *   (ai.complete: ZH_AI_PROVIDER / ZH_AI_MODEL, e.g. Liara AI) in batches of 20.
 *   Before the call: the text is already redacted at intake; staff names
 *   become [P1]…; each review is quoted JSON data inside <reviews_data>.
 *   The answer is validated (core parseReviewAnalysis); a review without a
 *   valid result, an LLM error or no provider → the rule tagger (method
 *   "rules", no estimated rating). The hotel's monthly budget and its daily
 *   review cap (llmDailyCap tokens) stop the LLM: the rest waits for tomorrow
 *   and the digest says how many.
 *
 * Digest (when the hotel's schedule.digest time has passed, once a day):
 *   core buildReviewDigest: yesterday's new reviews by channel group, the rated
 *   average and the estimated satisfaction (separate, each with its minimum n),
 *   themes over 7 days. Stored in reviewDigests; the profile's recipient roles
 *   get an in-app notification (push through n8n when enabled). F4 adds it to
 *   the morning briefing of roles with reviews.view.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const BATCH = 20;
const MAX_OUT_TOKENS = 3000;
const MAX_BATCHES_PER_RUN = 10;
const TEXT_MAX = 2000;

function pendingFilter() {
  return "hotel = {:h} && status = 'active' && text != '' && analyzedAt = ''";
}

function pendingCount(app, hotelId) {
  return z.findMany(app, "reviews", pendingFilter(), { h: hotelId }, "", 100000).length;
}

/** Start of the Tehran day of [now], as a PocketBase (UTC) date. */
function dayStart(now) {
  return z.pbDate(new Date(Date.parse(`${z.dayKey(now)}T00:00:00Z`) - 210 * 60000));
}

function tokensToday(app, hotelId, now) {
  let sum = 0;
  for (const a of z.findMany(app, "reviewAnalyses", "hotel = {:h} && method = 'llm' && created >= {:s}", { h: hotelId, s: dayStart(now) })) sum += a.getInt("tokens");
  return sum;
}

function save(app, hotelId, review, a, extra) {
  let rec = z.findFirst(app, "reviewAnalyses", "review = {:r}", { r: review.id });
  if (!rec) rec = new Record(z.col(app, "reviewAnalyses"));
  rec.load({
    hotel: hotelId, review: review.id, method: a.method, model: extra.model || "", promptVersion: core.REVIEW_PROMPT_VERSION,
    lang: a.lang || "", sentiment: a.sentiment, label: a.label, aspects: a.aspects,
    inferredRating: a.inferredRating === null ? null : a.inferredRating, confidence: a.confidence,
    tokens: extra.tokens || 0, fallbackReason: extra.fallbackReason || "",
  });
  app.save(rec);
  review.set("analyzedAt", z.pbDate(new Date()));
  app.save(review);
}

/**
 * One batch through the gateway (or the rules). Returns {analyzed, llm, rules, stop}
 * where stop names why the LLM may not be used now (budget, daily cap).
 */
function runBatch(app, hotelId, batch, now, cap) {
  const ai = require(`${__hooks}/lib/ai.js`);
  const out = { analyzed: 0, llm: 0, rules: 0, stop: "" };
  let parsed = null;
  let fallbackReason = "";
  let model = "";
  let tokensPer = 0;
  const r = ai.redactor(app, hotelId);
  const items = batch.map((rev, i) => ({ id: `r${i + 1}`, lang: rev.getString("lang"), text: r.text(rev.getString("text"), TEXT_MAX) }));
  if (!ai.llmConfigured()) {
    fallbackReason = "no_llm_provider";
  } else if (ai.budget(app, hotelId, now).remaining <= 0) {
    out.stop = "budget_exhausted";
    return out;
  } else if (tokensToday(app, hotelId, now) >= cap) {
    out.stop = "daily_cap";
    return out;
  } else {
    try {
      const res = ai.complete(core.REVIEW_ANALYSIS_SYSTEM, [{ role: "user", content: core.reviewAnalysisMessage(items) }], MAX_OUT_TOKENS);
      ai.recordUsage(app, hotelId, now, res.usage);
      const u = res.usage || {};
      const tokens = (Number(u.prompt_tokens || u.input_tokens) || 0) + (Number(u.completion_tokens || u.output_tokens) || 0);
      tokensPer = Math.round(tokens / batch.length);
      model = res.model || "";
      if (res.status !== "ok") fallbackReason = `llm_${res.status}`;
      else parsed = core.parseReviewAnalysis(res.text, items);
    } catch (err) {
      fallbackReason = `llm_error: ${String((err && err.message) || err).slice(0, 120)}`;
    }
  }
  app.runInTransaction((tx) => {
    batch.forEach((rev, i) => {
      const fresh = z.find(tx, "reviews", rev.id);
      const got = parsed && parsed.byId[items[i].id];
      if (got) {
        got.aspects = got.aspects.map((a) => Object.assign({}, a, { evidence: r.restore(a.evidence) }));
        save(tx, hotelId, fresh, got, { model, tokens: tokensPer });
        out.llm++;
      } else {
        const reason = fallbackReason || (parsed ? "invalid_llm_result" : "no_llm_result");
        save(tx, hotelId, fresh, core.reviewRulesAnalyze(fresh.getString("text"), fresh.getString("lang")), { fallbackReason: reason, tokens: parsed ? tokensPer : 0, model });
        out.rules++;
      }
      out.analyzed++;
    });
  });
  return out;
}

function analyzeHotel(app, hotelId, now, maxBatches) {
  if (!z.feature(app, hotelId, "guestReviews")) return { skipped: "feature_disabled" };
  const profile = require(`${__hooks}/lib/reviews.js`).profileOf(app, hotelId);
  const total = { analyzed: 0, llm: 0, rules: 0, stop: "" };
  for (let i = 0; i < (maxBatches || MAX_BATCHES_PER_RUN); i++) {
    const batch = z.findMany(app, "reviews", pendingFilter(), { h: hotelId }, "created", BATCH);
    if (!batch.length) break;
    const r = runBatch(app, hotelId, batch, now, profile.llmDailyCap);
    total.analyzed += r.analyzed;
    total.llm += r.llm;
    total.rules += r.rules;
    if (r.stop) {
      total.stop = r.stop;
      break;
    }
  }
  total.backlog = pendingCount(app, hotelId);
  return total;
}

/** The digest of [day] (default: today, Tehran), stored; notifies once a day. */
function digestHotel(app, hotelId, now, day) {
  if (!z.feature(app, hotelId, "guestReviews")) return { skipped: "feature_disabled" };
  const profile = require(`${__hooks}/lib/reviews.js`).profileOf(app, hotelId);
  const d = day || z.dayKey(now);
  const from = z.addDays(d, -32);
  const fromStamp = `${from} 00:00:00.000Z`;
  const recs = z.findMany(app, "reviews", "hotel = {:h} && status = 'active' && (postedAt >= {:f} || created >= {:f})", { h: hotelId, f: fromStamp });
  const dayOf = (s) => { const x = z.parseDate(s); return x ? z.dayKey(x) : null; };
  const reviews = recs.map((r) => ({
    id: r.id, channel: r.getString("channel"), platform: r.getString("platform"),
    day: dayOf(r.getString("postedAt")) || dayOf(r.getString("created")), receivedDay: dayOf(r.getString("created")),
    rating5: r.get("rating5") === null || r.getFloat("rating5") === 0 ? null : r.getFloat("rating5"),
    duplicateOf: r.getString("duplicateOf") || null, url: r.getString("url") || null,
  }));
  const ids = {};
  for (const r of reviews) ids[r.id] = true;
  const analyses = {};
  for (const a of z.findMany(app, "reviewAnalyses", "hotel = {:h} && updated >= {:f}", { h: hotelId, f: fromStamp })) {
    if (!ids[a.getString("review")]) continue;
    analyses[a.getString("review")] = {
      method: a.getString("method"), aspects: z.jsonOf(a, "aspects") || [],
      inferredRating: a.get("inferredRating") === null || a.getFloat("inferredRating") === 0 ? null : a.getFloat("inferredRating"),
      confidence: a.getFloat("confidence"),
    };
  }
  const digest = core.buildReviewDigest({
    day: d, reviews, analyses, minN: profile.minN, showEstimated: profile.toggles.showEstimated === true, backlog: pendingCount(app, hotelId),
  });
  let rec = z.findFirst(app, "reviewDigests", "hotel = {:h} && day = {:d}", { h: hotelId, d });
  const first = !rec;
  if (!rec) rec = new Record(z.col(app, "reviewDigests"), { hotel: hotelId, day: d });
  rec.load({
    newCount: digest.newCount, byGroup: digest.byGroup, rated: digest.rated, estimated: digest.estimated, trend: digest.trend,
    themes: digest.themes, facts: digest.facts, text: digest.text, backlog: digest.backlog, reviewIds: digest.reviewIds,
    generatedAt: z.pbDate(now),
  });
  app.save(rec);
  if (first && profile.recipients.roles.length) {
    z.notify(app, {
      hotelId, roles: profile.recipients.roles, title: "خلاصهٔ نظرات مهمانان", body: digest.text.split("\n").slice(0, 3).join(" "),
      category: "report", severity: "info", route: "/reviews", createdBy: "system", dedupeKey: `reviews.digest:${d}`,
    });
  }
  return { day: d, created: first, newCount: digest.newCount, rated: digest.rated.all, estimated: digest.estimated, themes: digest.themes.length };
}

/** Minutes since local midnight of "HH:MM" (Asia/Tehran). */
function minutesOf(hhmm) {
  const p = String(hhmm || "").split(":").map(Number);
  return p.length === 2 && isFinite(p[0]) && isFinite(p[1]) ? p[0] * 60 + p[1] : null;
}

/** The cron step for every flagged hotel: analysis, then the digest once its time has come. */
function tick(app, now) {
  const out = {};
  for (const id of z.activeHotelIds(app)) {
    if (!z.feature(app, id, "guestReviews")) continue;
    try {
      const a = analyzeHotel(app, id, now);
      const profile = require(`${__hooks}/lib/reviews.js`).profileOf(app, id);
      const local = new Date(now.getTime() + 210 * 60000);
      const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
      const at = minutesOf(profile.schedule.digest);
      const today = z.dayKey(now);
      let d = null;
      if (at !== null && nowMin >= at && !z.findFirst(app, "reviewDigests", "hotel = {:h} && day = {:d}", { h: id, d: today })) d = digestHotel(app, id, now);
      out[id] = { analysis: a, digest: d };
    } catch (err) {
      console.log("reviews tick failed", id, String(err));
    }
  }
  return out;
}

/** POST /api/zarin/admin/hotels/{id}/reviews/run  {analyze?: true, digest?: true, day?, maxBatches?} (superuser) */
function runNow(e) {
  const hotelId = e.request.pathValue("id");
  z.find(e.app, "hotels", hotelId);
  const b = e.requestInfo().body || {};
  const now = new Date();
  const out = {};
  if (b.analyze !== false) out.analysis = analyzeHotel(e.app, hotelId, now, Math.min(Math.max(Number(b.maxBatches) || MAX_BATCHES_PER_RUN, 1), 500));
  if (b.digest !== false) out.digest = digestHotel(e.app, hotelId, now, typeof b.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : null);
  return e.json(200, out);
}

/** The latest digest as a briefing item for F4 (null without one from today or yesterday). */
function briefingItem(app, hotelId, today) {
  if (!z.feature(app, hotelId, "guestReviews")) return null;
  const rec = z.findFirst(app, "reviewDigests", "hotel = {:h} && (day = {:a} || day = {:b})", { h: hotelId, a: today, b: z.addDays(today, -1) });
  if (!rec) return null;
  const digest = {
    day: rec.getString("day"), newCount: rec.getInt("newCount"), rated: z.jsonOf(rec, "rated") || {}, themes: z.jsonOf(rec, "themes") || [],
    facts: z.jsonOf(rec, "facts") || { values: {}, counts: {}, windows: {} },
  };
  if (!digest.rated.all) return null;
  return core.reviewDigestBriefingItem(digest);
}

module.exports = { analyzeHotel, digestHotel, tick, runNow, briefingItem, pendingCount };
