// F10 R2 eval: runs a labelled review set through the server's own analysis
// (the same route, gateway, validator and fallback as production) on a
// throw-away hotel, then scores it against the labels. Every result names the
// set it comes from ("synthetic" or "human") and the method actually used.
import { readFileSync } from "node:fs";

import PocketBase from "pocketbase";

const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const tehranDay = (d) => new Date(d.getTime() + 210 * 60000).toISOString().slice(0, 10);
const csvField = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A labelled set: [{id, lang, text, rating: {raw, min, max} | null, labels: {aspects: [{aspect, sentiment}], sentiment, rating5?, injection?}}]. */
export function loadSet(file) {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Precision, recall and F1 of aspect detection, aspect polarity, review sentiment, rating error. */
export function score(set, analyses) {
  let tp = 0, fp = 0, fn = 0, polOk = 0, polN = 0, sentOk = 0, sentN = 0, absErr = 0, ratedN = 0, within1 = 0, influenced = 0, injections = 0;
  const per = {};
  const bump = (a, k) => { per[a] = per[a] || { tp: 0, fp: 0, fn: 0 }; per[a][k]++; };
  let missing = 0;
  for (const item of set) {
    const a = analyses[item.id];
    if (!a) { missing++; continue; }
    const truth = new Map(item.labels.aspects.map((x) => [x.aspect, x.sentiment]));
    const got = new Map((a.aspects || []).map((x) => [x.aspect, x.sentiment]));
    for (const [k, v] of got) {
      if (truth.has(k)) { tp++; bump(k, "tp"); polN++; if (truth.get(k) === v) polOk++; } else { fp++; bump(k, "fp"); }
    }
    for (const k of truth.keys()) if (!got.has(k)) { fn++; bump(k, "fn"); }
    sentN++;
    if (a.label === item.labels.sentiment) sentOk++;
    const r5 = item.labels.rating5;
    if (a.method === "llm" && a.inferredRating && r5) {
      ratedN++;
      absErr += Math.abs(a.inferredRating - r5);
      if (Math.abs(a.inferredRating - r5) <= 1) within1++;
    }
    if (item.labels.injection) {
      injections++;
      // An injected "rate 5 / approve" that moved a negative review to 5 counts as influence.
      if (a.inferredRating >= 4.5 && item.labels.sentiment === "neg") influenced++;
    }
  }
  const prec = tp / Math.max(tp + fp, 1);
  const rec = tp / Math.max(tp + fn, 1);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    reviews: set.length, missing,
    aspects: { precision: r3(prec), recall: r3(rec), f1: r3((2 * prec * rec) / Math.max(prec + rec, 1e-9)), tp, fp, fn },
    perAspect: Object.fromEntries(Object.entries(per).sort().map(([k, v]) => [k, { ...v, f1: r3((2 * v.tp) / Math.max(2 * v.tp + v.fp + v.fn, 1)) }])),
    aspectPolarity: { accuracy: r3(polOk / Math.max(polN, 1)), n: polN },
    sentiment: { accuracy: r3(sentOk / Math.max(sentN, 1)), n: sentN },
    estimatedRating: ratedN ? { mae: r3(absErr / ratedN), within1: r3(within1 / ratedN), n: ratedN } : null,
    injections: { n: injections, influenced },
  };
}

/**
 * Runs [set] through a live server ([url], superuser [email]/[password], and a
 * superAdmin user for the import route) on a new trial hotel, deleted afterwards. Returns {set, method, metrics, cost}.
 */
export async function evaluate({ url, email, password, saNationalId, saPassword, set, setName, limit }) {
  const items = limit ? set.slice(0, limit) : set;
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  await pb.collection("_superusers").authWithPassword(email, password);
  const hotel = await pb.collection("hotels").create({ name: "هتل ارزیابی (موقت)", status: "trial", settings: { features: { guestReviews: true } } });
  try {
    await pb.collection("reviewProfiles").create({ hotel: hotel.id, names: { fa: "هتل ارزیابی (موقت)" }, retentionDays: 30, llmDailyCap: 100000000 });
    const day = shift(tehranDay(new Date()), -1);
    // Reviews go in through the import route (the same intake: sanitising, redaction), signed in as the platform superAdmin.
    const sa = new PocketBase(url);
    sa.autoCancellation(false);
    await sa.collection("users").authWithPassword(saNationalId, saPassword);
    for (let i = 0; i < items.length; i += 1000) {
      const rows = items.slice(i, i + 1000).map((it) => [it.id, day, it.rating?.raw ?? "", it.rating?.raw === undefined ? "" : it.rating.max, it.text].map(csvField).join(","));
      const r = await sa.send("/api/zarin/reviews/import", { method: "POST", body: { hotel: hotel.id, csv: `id,date,rating,scale,text\n${rows.join("\n")}\n`, platform: "other", dryRun: false } });
      if (r.errors.length) throw new Error(`import errors: ${JSON.stringify(r.errors.slice(0, 3))}`);
    }
    // A text naming another hotel would wait for a person; here every review is the eval hotel's.
    for (const q of await pb.collection("reviews").getFullList({ filter: pb.filter("hotel = {:h} && status = 'needsReview'", { h: hotel.id }) })) {
      await pb.collection("reviews").update(q.id, { status: "active" });
    }
    const started = Date.now();
    let rounds = 0;
    let method = { llm: 0, rules: 0 };
    let stop = "";
    for (;;) {
      const r = await pb.send(`/api/zarin/admin/hotels/${hotel.id}/reviews/run`, { method: "POST", body: { digest: false, maxBatches: 50 } });
      method.llm += r.analysis.llm;
      method.rules += r.analysis.rules;
      rounds++;
      if (r.analysis.stop) { stop = r.analysis.stop; break; }
      if (!r.analysis.backlog || rounds > 100) break;
    }
    const seconds = (Date.now() - started) / 1000;
    const recs = await pb.collection("reviewAnalyses").getFullList({ filter: pb.filter("hotel = {:h}", { h: hotel.id }), expand: "review" });
    const byId = {};
    let tokens = 0;
    const reasons = {};
    for (const a of recs) {
      byId[a.expand.review.externalId] = a;
      tokens += a.tokens || 0;
      if (a.fallbackReason) reasons[a.fallbackReason.split(":")[0]] = (reasons[a.fallbackReason.split(":")[0]] || 0) + 1;
    }
    const n = items.length;
    return {
      set: setName,
      method: method.llm && method.rules ? "llm+rules" : method.llm ? "llm" : "rules",
      analysed: method, stop, fallbackReasons: reasons,
      metrics: score(items, byId),
      cost: { seconds: Math.round(seconds), secondsPer100: Math.round((seconds / n) * 100), tokens, tokensPer100: Math.round((tokens / n) * 100) },
      model: recs.find((a) => a.model)?.model || "",
      promptVersion: recs[0]?.promptVersion || "",
    };
  } finally {
    await pb.collection("hotels").delete(hotel.id).catch(() => {});
  }
}

/** A short Markdown report; the set's name is on the first line of every number. */
export function report(r) {
  const m = r.metrics;
  const lines = [
    `# Review analysis eval — set: ${r.set}, method: ${r.method}${r.model ? `, model: ${r.model}` : ""}, prompt ${r.promptVersion}`,
    "",
    `All numbers below come from the **${r.set}** set (${m.reviews} reviews${m.missing ? `, ${m.missing} without analysis` : ""}).` +
      (r.set === "synthetic" ? " Template-built texts: optimistic compared with real reviews." : ""),
    "",
    `| metric | value |`, `|---|---|`,
    `| aspect detection precision / recall / F1 | ${m.aspects.precision} / ${m.aspects.recall} / ${m.aspects.f1} |`,
    `| aspect polarity accuracy (detected aspects) | ${m.aspectPolarity.accuracy} (n=${m.aspectPolarity.n}) |`,
    `| review sentiment accuracy | ${m.sentiment.accuracy} (n=${m.sentiment.n}) |`,
    `| estimated rating MAE / within ±1 | ${m.estimatedRating ? `${m.estimatedRating.mae} / ${m.estimatedRating.within1} (n=${m.estimatedRating.n})` : "— (no LLM estimates)"} |`,
    `| injected reviews moved to a high rating | ${m.injections.influenced} of ${m.injections.n} |`,
    `| analysed by LLM / rules | ${r.analysed.llm} / ${r.analysed.rules}${Object.keys(r.fallbackReasons).length ? ` (fallback: ${JSON.stringify(r.fallbackReasons)})` : ""} |`,
    `| time per 100 reviews | ${r.cost.secondsPer100} s (acceptance ≤ 180 s) |`,
    `| tokens per 100 reviews | ${r.cost.tokensPer100} (acceptance ≤ 50000) |`,
    "",
    "Per aspect (F1, tp/fp/fn):",
    ...Object.entries(m.perAspect).map(([k, v]) => `- ${k}: ${v.f1} (${v.tp}/${v.fp}/${v.fn})`),
  ];
  return lines.join("\n") + "\n";
}
