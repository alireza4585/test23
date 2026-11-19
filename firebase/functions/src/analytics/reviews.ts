/**
 * Guest reviews (F10): the pure parts shared by the server and its tests.
 *
 * Nothing here knows a hotel: names, aliases, cities, negative keywords and
 * listings always come from the hotel's review profile (data), never from code.
 *
 *  - text: Persian/Arabic normalisation for matching; redaction of phone
 *    numbers, national IDs, e-mails, handles and links before storage or any
 *    LLM call; sanitising (no control or bidi characters, no markup).
 *  - ratings: any platform scale mapped linearly to 1–5 (e.g. 10 → 5).
 *  - matching: which hotel a mention is about, from the profiles: a confirmed
 *    listing decides; otherwise names/aliases (+ city) score it, a negative
 *    keyword excludes a hotel, and an unclear result goes to "needs review".
 *  - duplicates: word-shingle similarity for the same review arriving twice
 *    (another channel, or cross-posted on another platform).
 *  - CSV: a small RFC 4180 parser and the generic import format.
 *  - links: the platform guessed from a shared link (editable in the app).
 */
import { jalaliToDay } from "./calendar";

// ------------------------------------------------------------------- text
const PERSIAN_DIGITS = /[۰-۹]/g;
const ARABIC_DIGITS = /[٠-٩]/g;

export function asciiDigits(s: string): string {
  return s.replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** For matching only (not stored): one script, no diacritics or joiners, lower case, words separated by single spaces. */
export function normalizeText(s: string): string {
  return asciiDigits(String(s ?? ""))
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[ً-ٰٟـ]/g, "") // harakat, superscript alef, tatweel
    .replace(/[‌‍]/g, " ") // ZWNJ / ZWJ
    // Letters and digits kept by explicit ranges (the PocketBase JSVM has no \p{…} escapes):
    // Latin, Latin-1/Extended letters, Arabic/Persian letters and their presentation forms.
    .replace(/[^0-9a-z\u00df-\u00f6\u00f8-\u024f\u0620-\u064a\u066e-\u06d3\u06d5\u06ee\u06ef\u06fa-\u06ff\u0750-\u077f\ufb50-\ufdfb\ufe70-\ufefc]+/g, " ")
    .trim();
}

/** Untrusted text kept readable: line breaks stay, control/bidi characters and markup go. */
export function sanitizeText(s: string, max = 4000): string {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩]/g, " ")
    .replace(/[<>`]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/**
 * Personal data out of review text: phone numbers, national-ID-like numbers,
 * e-mail addresses, @handles and links. Applied before storage and before any
 * LLM call; the reviewer's own name/handle/photo are never taken at all.
 * The patterns are compiled once: the PocketBase JSVM recompiles a literal on
 * every call, which made each call ~80 ms.
 */
const REDACTIONS: [RegExp, string][] = [
  [/https?:\/\/\S+|www\.\S+/gi, "[link]"],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]"],
  [/(^|[^\w@])@[A-Za-z0-9_.]{2,30}/g, "$1[handle]"],
  [/(^|[^\d])\d{3}-\d{6}-\d(?!\d)/g, "$1[id]"], // national ID with dashes, before phone patterns
  [/(^|[^\d])(?:\+98|0098|0)?9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g, "$1[phone]"],
  [/(^|[^\d])0\d{2}[\s-]?\d{8}(?!\d)/g, "$1[phone]"],
  [/(^|[^\d])\+?\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)/g, "$1[phone]"],
  [/(^|[^\d])\d{3}-?\d{6}-?\d(?!\d)/g, "$1[id]"],
];

export function redactText(s: string): string {
  let out = asciiDigits(String(s ?? ""));
  for (const [re, by] of REDACTIONS) {
    re.lastIndex = 0;
    out = out.replace(re, by);
  }
  return out;
}

// ---------------------------------------------------------------- ratings
/** A rating on [min, max] mapped linearly to 1–5 (2 decimals); null when unknown or out of range. */
export function ratingTo5(raw: number | null | undefined, min: number, max: number): number | null {
  if (raw === null || raw === undefined || !isFinite(raw) || !(max > min)) return null;
  if (raw < min || raw > max) return null;
  return Math.round((1 + ((raw - min) / (max - min)) * 4) * 100) / 100;
}

/** The usual scale of a platform (the hotel can change it per listing). */
export const PLATFORM_SCALES: Record<string, { min: number; max: number }> = {
  booking: { min: 1, max: 10 },
  expedia: { min: 1, max: 10 },
  google: { min: 1, max: 5 },
  tripadvisor: { min: 1, max: 5 },
  survey: { min: 1, max: 5 },
};

// ---------------------------------------------------------------- matching
export interface ProfileForMatch {
  hotelId: string;
  names: string[]; // official names in every language
  aliases: string[]; // other names and common misspellings
  cities: string[]; // the city and its other spellings
  negativeKeywords: string[]; // e.g. another hotel with a similar name
  listings: { platform: string; url?: string | null; externalId?: string | null }[];
}

export interface Mention {
  text: string;
  title?: string | null;
  url?: string | null;
  platform?: string | null;
  listingExternalId?: string | null;
  hotelName?: string | null; // a hotel-name column of an import, a parsed e-mail's property name
}

export type MatchStatus = "accepted" | "needsReview" | "unmatched";

export interface MatchResult {
  hotelId: string | null;
  status: MatchStatus;
  score: number;
  reasons: string[];
  candidates: { hotelId: string; score: number }[];
}

/** Matching thresholds: accept from AUTO with MARGIN over the next hotel; review from REVIEW. */
export const MATCH_AUTO = 0.9;
export const MATCH_REVIEW = 0.5;
export const MATCH_MARGIN = 0.3;

/** Host + path without query, fragment, "www." or a trailing slash. */
export function canonicalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(?:https?:\/\/)?([^/?#]+)([^?#]*)/i.exec(String(url).trim());
  if (!m) return null;
  return `${m[1].toLowerCase().replace(/^www\./, "")}${m[2].replace(/\/+$/, "").toLowerCase()}`;
}

const containsPhrase = (haystack: string, phrase: string): boolean => {
  const p = normalizeText(phrase);
  return p.length > 0 && ` ${haystack} `.includes(` ${p} `);
};

/** How strongly [m] is about the hotel of [p] (0–1), and why. */
export function scoreProfile(m: Mention, p: ProfileForMatch): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const url = canonicalUrl(m.url);
  for (const l of p.listings) {
    const lu = canonicalUrl(l.url);
    if ((url && lu && (url === lu || url.startsWith(`${lu}/`))) || (m.listingExternalId && l.externalId && m.listingExternalId === l.externalId && (!m.platform || m.platform === l.platform))) {
      return { score: 1, reasons: ["listing"] };
    }
  }
  const text = normalizeText([m.hotelName, m.title, m.text].filter(Boolean).join(" "));
  for (const k of p.negativeKeywords) if (containsPhrase(text, k)) return { score: 0, reasons: [`negative:${k}`] };
  let score = 0;
  const named = [...p.names, ...p.aliases].find((n) => containsPhrase(text, n));
  if (named) {
    score += 0.6;
    reasons.push("name");
  }
  if (p.cities.some((c) => containsPhrase(text, c))) {
    score += named ? 0.35 : 0.1;
    reasons.push("city");
  }
  return { score: Math.min(score, 0.95), reasons };
}

/**
 * Which hotel [m] is about, among [profiles].
 * - [context] is the hotel the mention came in for (its import, its staff, its e-mail address):
 *   that hotel is accepted unless another hotel clearly fits better (then it needs review);
 *   with a confirmed listing of that hotel it is accepted outright.
 * - without context (a platform-level import) the best hotel needs MATCH_AUTO and a
 *   MATCH_MARGIN lead to be accepted; from MATCH_REVIEW it needs review.
 */
export function matchMention(m: Mention, profiles: ProfileForMatch[], context?: string | null): MatchResult {
  const scored = profiles.map((p) => ({ hotelId: p.hotelId, ...scoreProfile(m, p) })).sort((a, b) => b.score - a.score);
  const candidates = scored.filter((s) => s.score > 0).map((s) => ({ hotelId: s.hotelId, score: Math.round(s.score * 100) / 100 }));
  if (context) {
    const own = scored.find((s) => s.hotelId === context) ?? { hotelId: context, score: 0, reasons: [] as string[] };
    const other = scored.find((s) => s.hotelId !== context);
    if (own.reasons.includes("listing")) return { hotelId: context, status: "accepted", score: 1, reasons: ["listing"], candidates };
    if (own.reasons.some((r) => r.startsWith("negative:"))) return { hotelId: context, status: "needsReview", score: 0, reasons: own.reasons, candidates };
    if (other && other.score >= MATCH_REVIEW && other.score > own.score) {
      return { hotelId: context, status: "needsReview", score: own.score, reasons: [...own.reasons, `other:${other.hotelId}`], candidates };
    }
    return { hotelId: context, status: "accepted", score: Math.max(own.score, 0.9), reasons: own.reasons.length ? own.reasons : ["context"], candidates };
  }
  const [best, next] = scored;
  if (!best || best.score < MATCH_REVIEW) return { hotelId: null, status: "unmatched", score: best?.score ?? 0, reasons: best?.reasons ?? [], candidates };
  const lead = best.score - (next?.score ?? 0);
  const status: MatchStatus = best.score >= MATCH_AUTO && lead >= MATCH_MARGIN ? "accepted" : "needsReview";
  return { hotelId: best.hotelId, status, score: Math.round(best.score * 100) / 100, reasons: best.reasons, candidates };
}

// ------------------------------------------------------------- duplicates
function shingles(s: string): Set<string> {
  const w = normalizeText(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (w.length === 1) out.add(w[0]);
  for (let i = 0; i + 1 < w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return out;
}

/** Jaccard similarity of word bigrams (0–1) of two texts. */
export function textSimilarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return Math.round((inter / (A.size + B.size - inter)) * 1000) / 1000;
}

export const SAME_REVIEW_SIMILARITY = 0.85; // the same review through another channel (e-mail vs CSV)
export const CROSS_POST_SIMILARITY = 0.9; // the same guest posting on two platforms
export const CROSS_POST_DAYS = 3;

/** A stable key of a text for exact duplicate checks (normalised). */
export function textKey(s: string): string {
  return normalizeText(s);
}

// --------------------------------------------------------------------- CSV
/** RFC 4180: quoted fields, doubled quotes, separators and line breaks inside quotes; BOM removed. */
export function parseCsv(text: string): string[][] {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

export interface ImportRow {
  externalId: string | null;
  postedAt: string | null; // YYYY-MM-DD
  rating: number | null;
  scaleMax: number | null;
  text: string;
  title: string | null;
  url: string | null;
  platform: string | null;
  hotelName: string | null;
  deleted: boolean;
}

/** Header names accepted for the generic import format (English and Persian). */
export const CSV_COLUMNS: Record<keyof ImportRow, string[]> = {
  externalId: ["id", "review_id", "externalid", "external_id", "شناسه"],
  postedAt: ["date", "posted_at", "postedat", "review_date", "تاریخ"],
  rating: ["rating", "score", "امتیاز"],
  scaleMax: ["scale", "scale_max", "out_of", "از"],
  text: ["text", "review", "comment", "متن", "نظر"],
  title: ["title", "عنوان"],
  url: ["url", "link", "لینک"],
  platform: ["platform", "source", "منبع"],
  hotelName: ["hotel", "property", "هتل"],
  deleted: ["deleted", "حذف"],
};

/** Gregorian YYYY-MM-DD from common forms (YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY), else null. */
export function parseDay(v: string | null | undefined): string | null {
  const s = asciiDigits(String(v ?? "")).trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
    if (!m) return null;
    [y, mo, d] = [Number(m[3]), Number(m[2]), Number(m[1])];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // A Persian export uses the Jalali calendar (years 1300–1499).
  if (y >= 1300 && y < 1500) {
    if (d > (mo <= 6 ? 31 : 30)) return null;
    return jalaliToDay(y, mo, d);
  }
  if (y < 1900 || y > 2200) return null;
  const day = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
}

/** Rows of the generic format; [errors] lists rows that could not be read (1-based, header excluded). Dates: Gregorian or Jalali. */
export function readImport(text: string): { rows: ImportRow[]; errors: { row: number; reason: string }[]; columns: string[] } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], errors: [{ row: 0, reason: "empty" }], columns: [] };
  const header = table[0].map((h) => normalizeText(h).replace(/ /g, "_"));
  const col = (k: keyof ImportRow) => header.findIndex((h) => CSV_COLUMNS[k].includes(h));
  const idx = Object.fromEntries((Object.keys(CSV_COLUMNS) as (keyof ImportRow)[]).map((k) => [k, col(k)])) as Record<keyof ImportRow, number>;
  const columns = (Object.keys(idx) as (keyof ImportRow)[]).filter((k) => idx[k] >= 0);
  const rows: ImportRow[] = [];
  const errors: { row: number; reason: string }[] = [];
  if (idx.text < 0 && idx.rating < 0) return { rows, errors: [{ row: 0, reason: "no_text_or_rating_column" }], columns };
  table.slice(1).forEach((r, i) => {
    const get = (k: keyof ImportRow) => (idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : "");
    const ratingRaw = get("rating");
    const rating = ratingRaw === "" ? null : Number(asciiDigits(ratingRaw).replace(",", "."));
    const scale = get("scaleMax") === "" ? null : Number(asciiDigits(get("scaleMax")));
    const text = get("text");
    if (!text && (rating === null || !isFinite(rating))) { errors.push({ row: i + 1, reason: "no_text_or_rating" }); return; }
    if (rating !== null && !isFinite(rating)) { errors.push({ row: i + 1, reason: "bad_rating" }); return; }
    const day = get("postedAt") ? parseDay(get("postedAt")) : null;
    if (get("postedAt") && !day) { errors.push({ row: i + 1, reason: "bad_date" }); return; }
    rows.push({
      externalId: get("externalId") || null, postedAt: day, rating, scaleMax: scale && isFinite(scale) ? scale : null,
      text, title: get("title") || null, url: get("url") || null, platform: get("platform") ? normalizeText(get("platform")) : null,
      hotelName: get("hotelName") || null, deleted: /^(1|true|yes|بله)$/i.test(get("deleted")),
    });
  });
  return { rows, errors, columns };
}

// ------------------------------------------------------------------- links
const HOSTS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, "instagram"],
  [/(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|(^|\.)g\.co$|maps\.app\.goo\.gl$/, "google"],
  [/(^|\.)t\.me$|(^|\.)telegram\.(me|org)$/, "telegram"],
  [/(^|\.)booking\.com$/, "booking"],
  [/(^|\.)expedia\.[a-z.]+$|(^|\.)hotels\.com$/, "expedia"],
  [/(^|\.)tripadvisor\.[a-z.]+$/, "tripadvisor"],
  [/(^|\.)snapptrip\.com$/, "snapptrip"],
  [/(^|\.)jabama\.com$/, "jabama"],
  [/(^|\.)eghamat24\.com$/, "eghamat24"],
  [/(^|\.)alibaba\.ir$/, "alibaba"],
];

export const PLATFORMS = ["booking", "expedia", "google", "tripadvisor", "instagram", "telegram", "snapptrip", "jabama", "eghamat24", "alibaba", "survey", "other"] as const;

/** The platform of a shared link (the app lets the user change it); "other" when unknown. */
export function guessPlatform(url: string | null | undefined): string {
  const c = canonicalUrl(url);
  if (!c) return "other";
  const host = c.split("/")[0];
  if (/(^|\.)google\./.test(host) && !c.includes("/maps")) return /maps|goo\.gl/.test(host) ? "google" : "other";
  for (const [re, p] of HOSTS) if (re.test(host)) return p;
  return "other";
}

/** The first link in a shared text, if any. */
export function firstLink(text: string): string | null {
  const m = /https?:\/\/[^\s<>"']+/i.exec(String(text ?? ""));
  return m ? m[0].replace(/[).,،]+$/, "") : null;
}
