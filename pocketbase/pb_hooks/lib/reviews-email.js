/// <reference path="../../pb_data/types.d.ts" />
/**
 * F10 R2: reviews by e-mail (flag guestReviews).
 *
 * Mailbox: one shared IMAP mailbox on a domain we own (platform level). Each
 * hotel forwards review-site notifications to its own unguessable address
 * r-<inboundToken>@<ZH_REVIEWS_MAIL_DOMAIN> (tokens are hotel data, visible to
 * reviews.manage, rotatable). n8n (workflow 08) reads the mailbox and posts
 * each mail here, signed:
 *
 *   POST /v1/reviews/inbound-email  {to: [..], from, subject, date, text, html, messageId}
 *
 * v1 shared secret, or a scoped key whose hotels include the address's hotel.
 * The mail is parsed and dropped: no sender, recipient or header is stored;
 * the Message-ID only as an HMAC (intakeKey), so the same mail is taken once.
 *   - a forwarding confirmation → the hotel's managers get its link in-app;
 *   - otherwise the generic parser (core parseGenericMail) → one review through
 *     the usual pipeline (redaction, matching, duplicates: a later CSV row of
 *     the same review completes it and accepts it), status "needs review";
 *   - nothing usable → "needs review" with a redacted excerpt (≤ 1000 chars).
 * Per-site templates (accepted without a person) come with real samples.
 *
 *   POST /api/zarin/reviews/inbound-address  {hotel}   reviews.manage: a new address (the old one stops)
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const MAX_BODY = 1024 * 1024;
const EXCERPT = 1000;
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function domain() {
  return ($os.getenv("ZH_REVIEWS_MAIL_DOMAIN") || "").trim().toLowerCase();
}

function addressOf(token) {
  return token && domain() ? `r-${token}@${domain()}` : "";
}

function list(v) {
  if (Array.isArray(v)) return v.map(String);
  return typeof v === "string" ? v.split(",") : [];
}

function salt() {
  return $os.getenv("ZH_REVIEW_SALT") || $os.getenv("ZH_SECRETS_KEY") || $os.getenv("ZH_INTEGRATION_SECRET") || "";
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * The mail's date: ISO 8601, or RFC 2822 ("Wed, 19 Nov 2026 10:06:00 +0330")
 * read explicitly; anything else, or a date more than a year back or in the
 * future, is replaced by the time it arrived.
 */
function mailDate(v) {
  const now = new Date();
  const s = typeof v === "string" ? v.trim() : "";
  let d = null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) d = new Date(s);
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([+-])(\d{2})(\d{2})|GMT|UTC|Z)?/i.exec(s);
  if (!d && m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const offset = m[7] ? (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) : 0;
    d = new Date(Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)) - offset * 60000);
  }
  if (!d || isNaN(d.getTime()) || d.getTime() > now.getTime() + 864e5 || d.getTime() < now.getTime() - 400 * 864e5) return now;
  return d;
}

/** POST /v1/reviews/inbound-email (signed) */
function inbound(e) {
  const integration = require(`${__hooks}/lib/integration.js`);
  // The body is read once, by the signature check (fields are capped after parsing).
  let profile = null;
  const resolve = (text) => {
    let body = {};
    try { body = JSON.parse(text || "{}"); } catch (_) { return null; }
    const token = core.inboundToken(list(body.to), domain() || null);
    profile = token ? z.findFirst(e.app, "reviewProfiles", "inboundToken = {:t}", { t: token }) : null;
    return profile ? profile.getString("hotel") : null;
  };
  const b = integration.verified(e, resolve);
  if (JSON.stringify(b).length > MAX_BODY) throw z.bad("mail_too_large");
  if (!profile) resolve(JSON.stringify(b));
  if (!profile) throw z.notFound("unknown_address");
  const hotelId = profile.getString("hotel");
  if (!z.feature(e.app, hotelId, "guestReviews")) return e.json(200, { status: "ignored", reason: "feature_disabled" });

  const text = typeof b.text === "string" ? b.text.slice(0, 500000) : "";
  const html = typeof b.html === "string" ? b.html.slice(0, 500000) : "";
  const subject = typeof b.subject === "string" ? b.subject.slice(0, 500) : "";
  const from = typeof b.from === "string" ? b.from.slice(0, 300) : "";
  const idSource = typeof b.messageId === "string" && b.messageId ? b.messageId : `${subject}|${b.date || ""}|${text.slice(0, 500)}`;
  const intakeKey = $security.hs256(`mail|${idSource}`, salt() || hotelId);
  if (z.findFirst(e.app, "reviews", "hotel = {:h} && intakeKey = {:k}", { h: hotelId, k: intakeKey })) {
    return e.json(200, { status: "duplicate" });
  }

  const plain = text || core.htmlToText(html);
  const confirm = core.forwardingConfirmation({ from, subject, text: plain });
  if (confirm !== null) {
    const managers = core.rolesWith("reviews.manage").filter((r) => r !== "superAdmin");
    z.notify(e.app, {
      hotelId, roles: managers, title: "تأیید ارسال خودکار ایمیل نظرات",
      body: confirm ? `برای فعال شدن ارسال خودکار، این پیوند را باز کنید: ${confirm}` : "سرویس ایمیل شما ارسال خودکار را تأیید می‌خواهد؛ ایمیل تأیید را در صندوق خودتان ببینید.",
      category: "system", severity: "info", route: "/reviews", createdBy: "system", inAppOnly: true,
    });
    return e.json(200, { status: "confirmation" });
  }

  const p = core.parseGenericMail({ from, subject, text, html });
  const d = mailDate(b.date);
  const day = z.dayKey(d);
  const item = p.kind === "generic"
    ? {
      channel: "email", platform: p.platform, url: p.url, text: p.text, title: p.title, postedAt: day,
      rating: p.rating ? p.rating.raw : undefined, scaleMax: p.rating ? p.rating.max : undefined, forceReview: "email_generic", intakeKey,
    }
    : {
      channel: "email", platform: "other", text: core.mailBodyOf(plain).slice(0, EXCERPT), title: subject || null, postedAt: day,
      forceReview: "email_unparsed", intakeKey,
    };
  if (!String(item.text || "").trim() && item.rating === undefined) return e.json(200, { status: "empty" });
  let out;
  e.app.runInTransaction((tx) => {
    out = require(`${__hooks}/lib/reviews.js`).ingest(tx, hotelId, [item], { dryRun: false });
  });
  if (out.errors.length) return e.json(200, { status: "rejected", reason: out.errors[0].reason });
  const rec = z.find(e.app, "reviews", out.ids[0]);
  return e.json(200, {
    status: out.created ? "created" : out.updated ? "completed" : "unchanged", kind: p.kind, reviewStatus: rec.getString("status"),
  });
}

/** POST /api/zarin/reviews/inbound-address {hotel} — a new address; mail to the old one is no longer taken. */
function rotateAddress(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const hotelId = z.requireHotel(c, String(b.hotel || c.activeHotel || ""));
  z.requirePerm(c, "reviews.manage");
  z.requireFeature(e.app, hotelId, "guestReviews");
  const token = $security.randomStringWithAlphabet(24, TOKEN_ALPHABET);
  e.app.runInTransaction((tx) => {
    let rec = z.findFirst(tx, "reviewProfiles", "hotel = {:h}", { h: hotelId });
    if (!rec) {
      const p = require(`${__hooks}/lib/reviews.js`).profileOf(tx, hotelId);
      rec = new Record(z.col(tx, "reviewProfiles"), { hotel: hotelId, names: p.names, city: p.city || "" });
    }
    rec.set("inboundToken", token);
    tx.save(rec);
    z.audit(tx, hotelId, { action: "reviewProfiles.inboundAddress", collection: "reviewProfiles", id: rec.id, actor: z.actorOf(c), source: "client", changes: { rotated: true } });
  });
  return e.json(200, { address: addressOf(token), configured: !!domain() });
}

module.exports = { inbound, rotateAddress, addressOf, domain, mailDate };
