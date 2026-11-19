// F10: synthetic multi-hotel guest reviews with ground-truth labels (docs/21 §8.1).
//
//   node scripts/reviews-fixtures.mjs           # (re)write fixtures/reviews/generated/
//   node scripts/reviews-fixtures.mjs --check   # exit 1 if the committed files differ
//
// Deterministic (fixed seed and period). Inputs are data in fixtures/reviews/src/
// (fictional hotels, a hand-written phrase bank: no LLM); this script names no
// hotel. Every label is known by construction: each phrase speaks about one
// aspect with one polarity; scenarios are planted on purpose:
//   breakfast spike then an action and a fall, persistent noise without action,
//   prompt injections, personal data ({PHONE}/{EMAIL}/{NID} placeholders, filled
//   with runtime values by the tests, so no number is in the repository),
//   cross-posts, edited and deleted reviews (an update CSV), mentions of the
//   confusable hotel, and a confirmed source with no reviews.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const core = createRequire(import.meta.url)("../pb_hooks/lib/core.js");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/reviews");
const OUT = join(ROOT, "generated");
const SEED = 1010;
const VERSION = 1;

const src = JSON.parse(readFileSync(join(ROOT, "src/hotels.json"), "utf8"));
const bank = JSON.parse(readFileSync(join(ROOT, "src/phrases.json"), "utf8"));
const ASPECTS = Object.keys(bank.aspects);

// ------------------------------------------------------------------ random
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const chance = (p) => rnd() < p;
const pick = (list) => list[Math.floor(rnd() * list.length)];
function weighted(map) {
  const entries = Object.entries(map);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = rnd() * total;
  for (const [k, w] of entries) if ((x -= w) < 0) return k;
  return entries[entries.length - 1][0];
}
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// -------------------------------------------------------------------- days
const DAYS = [];
for (let d = src.period.from; d <= src.period.to; d = core.shiftDay(d, 1)) DAYS.push(d);
const between = (d, from, to) => d >= from && (!to || d <= to);

// How often an aspect is talked about, and how often negatively (scenarios override).
const MENTION = {
  cleanliness: 0.3, staff_service: 0.3, breakfast_fnb: 0.3, room_comfort: 0.25, location: 0.2, noise: 0.15, value: 0.15,
  checkin_checkout: 0.1, amenities: 0.08, wifi: 0.08, maintenance: 0.08, restaurant: 0.06, facilities: 0.05, safety: 0.03,
};
const DEFAULT_NEGATIVE = 0.12;
const S = src.scenarios;

function mentionOf(h, aspect, day) {
  const sp = S.breakfastSpike;
  if (h.key === sp.hotel && aspect === sp.aspect && between(day, sp.from, sp.to)) return 0.5;
  if (h.key === S.persistentNoise.hotel && aspect === S.persistentNoise.aspect) return 0.35;
  if (h.generate.baseNegative[aspect] !== undefined) return Math.max(MENTION[aspect], 0.2);
  return MENTION[aspect];
}

function negativeOf(h, aspect, day) {
  const sp = S.breakfastSpike;
  if (h.key === sp.hotel && aspect === sp.aspect) {
    if (between(day, sp.from, sp.to)) return sp.negativeShare;
    if (day >= sp.afterFrom) return sp.afterNegativeShare;
  }
  const base = h.generate.baseNegative[aspect];
  return base === undefined ? DEFAULT_NEGATIVE : base;
}

// -------------------------------------------------------------------- text
const sentence = (s, lang) => {
  const t = s.trim();
  if (!t) return "";
  const cap = lang === "en" ? t[0].toUpperCase() + t.slice(1) : t;
  return /[.!؟?]$/.test(cap) ? cap : `${cap}.`;
};
const join2 = (parts) => parts.filter(Boolean).join(" ");
const capWords = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function nameMention(h, lang) {
  const p = h.profile;
  return pick(bank.nameMentions[lang])
    .replace("{ALIAS}", pick(p.aliases.filter((a) => /[؀-ۿ]/.test(a))))
    .replace("{NAME}", p.names.fa)
    .replace("{CITY}", p.city)
    .replace("{NAME_EN}", p.names.en)
    .replace("{CITY_EN}", capWords(p.cityAliases[0] || ""));
}

function compose(h, day, lang) {
  let aspects = ASPECTS.filter((a) => chance(mentionOf(h, a, day)));
  if (!aspects.length) aspects = [weighted(MENTION)];
  aspects = shuffle(aspects).slice(0, 3);
  const labels = aspects.map((aspect) => ({ aspect, sentiment: chance(negativeOf(h, aspect, day)) ? "neg" : "pos" }));
  const phrases = labels.map((l) => sentence(pick(bank.aspects[l.aspect][lang][l.sentiment]), lang));
  const neg = labels.filter((l) => l.sentiment === "neg").length;
  const sentiment = neg === 0 ? "pos" : neg === labels.length ? "neg" : "mixed";
  const mention = chance(0.15) ? sentence(nameMention(h, lang), lang) : "";
  const text = join2([sentence(pick(bank.openers[lang]), lang), mention, ...phrases, sentence(pick(bank.closers[lang]), lang)]);
  return { text, labels, sentiment };
}

// ------------------------------------------------------------------ rating
function scaleOf(h, platform) {
  const l = h.listings.find((x) => x.platform === platform);
  if (l && l.scaleMax) return { min: l.scaleMin ?? 1, max: l.scaleMax };
  return core.REVIEW_PLATFORM_SCALES[platform] || null;
}

function ratingFor(sentiment, scale) {
  const r5 = sentiment === "pos" ? pick([4, 5, 5]) : sentiment === "neg" ? pick([1, 2, 2]) : pick([2, 3, 3, 4]);
  const raw = Math.round(scale.min + ((r5 - 1) * (scale.max - scale.min)) / 4);
  return { raw, rating5: core.ratingTo5(raw, scale.min, scale.max) };
}

// ---------------------------------------------------------------- reviews
const PREFIX = { booking: "bk", google: "gg", snapptrip: "sn", instagram: "ig", tripadvisor: "ta", jabama: "jb", expedia: "ex" };

function generateHotel(h, hi) {
  const out = [];
  const days = Array.from({ length: h.generate.reviews }, () => pick(DAYS)).sort();
  const seq = {};
  for (const day of days) {
    const platform = weighted(h.generate.platforms);
    const lang = chance(h.generate.faShare) ? "fa" : "en";
    // Templated texts can repeat: a near-twin of a nearby review of this hotel is drawn again,
    // so only the planted cross-posts are duplicates.
    let c;
    for (let tries = 0; tries < 30; tries++) {
      c = compose(h, day, lang);
      const key = core.reviewTextKey(c.text);
      const clash = out.some((r) => Math.abs(core.daysBetween(r.postedAt, day)) <= 3 &&
        (core.reviewTextKey(r.text) === key || core.textSimilarity(r.text, c.text) >= 0.8));
      if (!clash) break;
    }
    seq[platform] = (seq[platform] || 0) + 1;
    const n = seq[platform];
    const scale = scaleOf(h, platform);
    const rating = scale ? ratingFor(c.sentiment, scale) : null;
    const listing = h.listings.find((l) => l.platform === platform && l.status === "confirmed");
    const url = platform === "instagram" ? `https://www.instagram.com/p/fx${hi}${String(n).padStart(4, "0")}/`
      : listing && platform !== "booking" ? `${listing.url}/review/${n}` : "";
    out.push({
      hotel: h.key, platform, externalId: `${PREFIX[platform]}-${hi}-${String(n).padStart(4, "0")}`, postedAt: day,
      rating: rating ? rating.raw : null, scaleMin: scale ? scale.min : null, scaleMax: scale ? scale.max : null,
      lang, text: c.text, url,
      truth: {
        hotel: h.key, aspects: c.labels, sentiment: c.sentiment, rating5: rating ? rating.rating5 : null,
        expectedStatus: "active", scenarios: [],
      },
    });
  }
  return out;
}

const hotels = src.hotels;
const byKey = Object.fromEntries(hotels.map((h) => [h.key, h]));
let reviews = hotels.flatMap((h, i) => generateHotel(h, i + 1));
const tag = (r, s) => r.truth.scenarios.push(s);
const sp = S.breakfastSpike;
for (const r of reviews) {
  if (r.hotel === sp.hotel && r.truth.aspects.some((a) => a.aspect === sp.aspect)) {
    if (between(r.postedAt, sp.from, sp.to)) tag(r, "breakfastSpike");
    else if (r.postedAt >= sp.afterFrom) tag(r, "breakfastAfterAction");
  }
  if (r.hotel === S.persistentNoise.hotel && r.truth.aspects.some((a) => a.aspect === "noise" && a.sentiment === "neg")) tag(r, "persistentNoise");
}

// One pool, so the planted scenarios never overlap.
let pool = shuffle(reviews.filter((r) => r.truth.scenarios.length === 0));
const take = (n, pred) => {
  const got = [];
  pool = pool.filter((r) => {
    if (got.length < n && pred(r)) { got.push(r); return false; }
    return true;
  });
  return got;
};
const words = (t) => core.reviewTextKey(t).split(" ").length;

for (const r of take(S.injections, () => true)) {
  r.text = join2([r.text, sentence(pick(bank.injections[r.lang]), r.lang)]);
  r.truth.injection = true;
  tag(r, "injection");
}
for (const r of take(S.pii, () => true)) {
  r.text = join2([r.text, sentence(pick(bank.pii[r.lang]), r.lang)]);
  r.truth.pii = true;
  tag(r, "pii");
}
// Without a link to a confirmed listing (a confirmed listing decides the match, so such a review is accepted).
for (const r of take(S.confusable.count, (x) => x.hotel === S.confusable.hotel && x.lang === "fa" && !x.url)) {
  const other = hotels.find((h) => h.key !== r.hotel && h.profile.aliases.some((a) => byKey[r.hotel].profile.aliases.includes(a)));
  r.text = join2([sentence(`قبلاً در ${other.profile.names.fa} مانده بودیم ولی این بار اینجا را انتخاب کردیم`, "fa"), r.text]);
  r.truth.expectedStatus = "needsReview";
  tag(r, "confusable");
}
const cp = S.crossPosts;
const crossCopies = [];
for (const r of take(cp.count, (x) => x.hotel === cp.hotel && x.platform === cp.from && x.rating !== null && words(x.text) >= 6 &&
  x.postedAt <= core.shiftDay(src.period.to, -2))) {
  const h = byKey[r.hotel];
  const scale = scaleOf(h, cp.to);
  const raw = Math.round(scale.min + ((r.truth.rating5 - 1) * (scale.max - scale.min)) / 4);
  const n = crossCopies.length + 1;
  const listing = h.listings.find((l) => l.platform === cp.to);
  crossCopies.push({
    hotel: r.hotel, platform: cp.to, externalId: `${PREFIX[cp.to]}-x-${String(n).padStart(4, "0")}`, postedAt: core.shiftDay(r.postedAt, 1 + (n % 2)),
    rating: raw, scaleMin: scale.min, scaleMax: scale.max, lang: r.lang, text: r.text, url: `${listing.url}/review/x${n}`,
    truth: { ...r.truth, rating5: core.ratingTo5(raw, scale.min, scale.max), scenarios: ["crossPost"], crossPostOf: r.externalId },
  });
  tag(r, "crossPostSource");
}
reviews = reviews.concat(crossCopies);

const updates = [];
for (const r of take(S.edited.count, (x) => x.hotel === S.edited.hotel && x.platform === S.edited.platform && x.rating !== null)) {
  const h = byKey[r.hotel];
  const c = compose(h, r.postedAt, r.lang);
  const rating = ratingFor(c.sentiment, scaleOf(h, r.platform));
  const text = join2([sentence(r.lang === "fa" ? "نظرم را به‌روز کردم" : "Updated my review", r.lang), c.text]);
  updates.push({ ...r, text, rating: rating.raw, deleted: false });
  r.truth.edited = { text, rating5: rating.rating5, aspects: c.labels, sentiment: c.sentiment };
  tag(r, "edited");
}
for (const r of take(S.deleted.count, (x) => x.hotel === S.deleted.hotel && x.platform === S.deleted.platform && x.rating !== null)) {
  updates.push({ ...r, deleted: true });
  r.truth.expectedStatus = "deleted";
  tag(r, "deleted");
}

// ----------------------------------------------------------------- mentions
// Platform-level mentions (no hotel context): the matcher's expected verdict by construction.
const mentions = [];
for (const h of hotels) {
  const p = h.profile;
  const fa = p.names.fa.includes(p.city) ? p.names.fa : `${p.names.fa} ${p.city}`;
  const city = capWords(p.cityAliases[0]);
  mentions.push({ text: `اقامت در ${fa} خوب بود`, truth: { hotel: h.key, status: "accepted" } });
  mentions.push({ text: p.names.en.includes(city) ? `${p.names.en} was fine` : `${p.names.en} in ${city} was fine`, truth: { hotel: h.key, status: "accepted" } });
  for (const l of h.listings.filter((x) => x.status === "confirmed")) {
    mentions.push({ text: "عالی", url: `${l.url}/review/m1`, platform: l.platform, truth: { hotel: h.key, status: "accepted" } });
  }
  for (const a of p.aliases.filter((x) => /[؀-ۿ]/.test(x))) {
    const shared = hotels.filter((o) => o.profile.aliases.includes(a) || o.profile.names.fa.includes(a)).map((o) => o.key);
    if (mentions.some((m) => m.text === `${a} تمیز بود`)) continue;
    mentions.push({ text: `${a} تمیز بود`, truth: { hotel: shared.length > 1 ? null : h.key, status: "needsReview", candidates: shared.sort() } });
  }
}
mentions.push({ text: "اتاق تمیز بود و صبحانه خوب", truth: { hotel: null, status: "unmatched" } });
mentions.push({ text: "Nice stay, friendly staff", truth: { hotel: null, status: "unmatched" } });

// --------------------------------------------------------------------- CSV
const csvField = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toJalali = (day) => {
  const j = core.dayToJalali(day);
  return `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`;
};
// Header styles: one Persian file with Jalali dates, the rest English; booking relies on its default scale.
const persianFile = (h, platform) => h.key === "sepidar" && platform === "google";
function csvOf(h, platform, rows, update) {
  const fa = persianFile(h, platform);
  const header = fa ? ["شناسه", "تاریخ", "امتیاز", "از", "متن", "لینک"] : ["id", "date", "rating", "scale", "text", "url"];
  if (update) header.push("deleted");
  const lines = [header.join(",")];
  for (const r of rows) {
    const scale = platform === "booking" || r.rating === null ? "" : r.scaleMax;
    const cells = [r.externalId, fa ? toJalali(r.postedAt) : r.postedAt, r.rating, scale, r.text, r.url];
    if (update) cells.push(r.deleted ? "1" : "");
    lines.push(cells.map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const files = {};
for (const h of hotels) {
  for (const platform of Object.keys(h.generate.platforms).concat(h.listings.map((l) => l.platform))) {
    const rows = reviews.filter((r) => r.hotel === h.key && r.platform === platform).sort((a, b) => (a.postedAt < b.postedAt ? -1 : 1));
    if (rows.length && !files[`csv/${h.key}-${platform}.csv`]) files[`csv/${h.key}-${platform}.csv`] = csvOf(h, platform, rows, false);
  }
}
files[`csv/${S.edited.hotel}-${S.edited.platform}-update.csv`] = csvOf(byKey[S.edited.hotel], S.edited.platform, updates, true);

// ----------------------------------------------------------------- manifest
const count = (list, f) => list.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
const manifest = {
  generator: "pocketbase/scripts/reviews-fixtures.mjs", version: VERSION, seed: SEED, period: src.period,
  note: "Synthetic, template-built texts: simpler than real reviews, so accuracy measured on them is optimistic. Labels are by construction.",
  reviews: reviews.length,
  byHotel: count(reviews, (r) => r.hotel),
  byHotelPlatform: count(reviews, (r) => `${r.hotel}/${r.platform}`),
  byMonth: count(reviews, (r) => `${r.hotel}/${r.postedAt.slice(0, 7)}`),
  scenarios: count(reviews.flatMap((r) => r.truth.scenarios.map((s) => ({ s }))), (x) => x.s),
  expectedStatus: count(reviews, (r) => `${r.hotel}/${r.truth.expectedStatus}`),
  emptySources: [`${S.emptySource.hotel}/${S.emptySource.platform}`],
  actions: [{ hotel: sp.hotel, aspect: sp.aspect, day: sp.actionDay }],
  updates: updates.length,
  mentions: mentions.length,
  files: Object.keys(files).sort().concat(["mentions.jsonl", "reviews.jsonl"]),
};
files["reviews.jsonl"] = reviews.map((r) => JSON.stringify(r)).join("\n") + "\n";
files["mentions.jsonl"] = mentions.map((m) => JSON.stringify(m)).join("\n") + "\n";
files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";

// -------------------------------------------------------------------- write
const list = (dir) => {
  const out = [];
  const walk = (d, rel) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) e.isDirectory() ? walk(join(d, e.name), `${rel}${e.name}/`) : out.push(`${rel}${e.name}`);
  };
  walk(dir, "");
  return out.sort();
};
if (process.argv.includes("--check")) {
  const want = Object.keys(files).sort();
  const have = list(OUT);
  const diff = want.filter((f) => { try { return readFileSync(join(OUT, f), "utf8") !== files[f]; } catch { return true; } })
    .concat(have.filter((f) => !files[f]));
  if (diff.length) {
    console.error(`fixtures/reviews/generated is out of date: ${diff.join(", ")}\nRun: node pocketbase/scripts/reviews-fixtures.mjs`);
    process.exit(1);
  }
  console.log(`fixtures/reviews/generated up to date (${reviews.length} reviews, ${want.length} files)`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(OUT, f)), { recursive: true });
    writeFileSync(join(OUT, f), body);
  }
  console.log(`wrote ${Object.keys(files).length} files, ${reviews.length} reviews, ${mentions.length} mentions to fixtures/reviews/generated`);
}
