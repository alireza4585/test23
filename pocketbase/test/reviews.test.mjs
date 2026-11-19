// F10 R1: guest reviews without AI. Profile, CSV import (dry run and commit),
// redaction, matching against confusable hotels, de-duplication, the review
// queue, listings, share-to-app, the QR survey (public and per room with a
// rotating token), retention, permissions, the flag and hotel isolation.
// Fictional hotels; passwords are generated per run.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NID, errorOf, hotelId, login, post, roomByNumber, superuser, url } from "./helpers.mjs";

const PASSWORD = `Rv-${randomBytes(6).toString("hex")}-a1`;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

/** A valid Iranian national ID from a 9-digit prefix (check digit computed). */
function nationalId(prefix) {
  const d = prefix.split("").map(Number);
  const s = d.reduce((a, x, i) => a + x * (10 - i), 0) % 11;
  return prefix + String(s < 2 ? s : 11 - s);
}

let su;
let sa;
let gm;
let inv;
let reception;
let hB;
let hC;
let gmB;
let gmBUser;
const flagsOf = async (id) => (await su.collection("hotels").getOne(id)).settings || {};
async function setFlag(id, on) {
  const s = await flagsOf(id);
  await su.collection("hotels").update(id, { settings: { ...s, features: { ...(s.features || {}), guestReviews: on } } });
}
const reviewsOf = (filter) => su.collection("reviews").getFullList({ filter: `hotel = "${hotelId()}"${filter ? ` && ${filter}` : ""}`, sort: "created" });

beforeAll(async () => {
  su = await superuser();
  sa = await login(NID.superAdmin);
  gm = await login(NID.gm);
  inv = await login(NID.inventory);
  reception = await login(NID.reception);
  hB = await su.collection("hotels").create({ name: "هتل آزمایشی ب", city: "کرمان", status: "trial", settings: {} });
  hC = await su.collection("hotels").create({ name: "هتل آزمایشی ج", city: "بندرعباس", status: "trial", settings: {} });
  gmBUser = await su.collection("users").create({
    nationalId: nationalId("045123456"), fullName: "مدیرکل هتل ب", role: "generalManager", hotels: [hB.id], primaryHotel: hB.id,
    activeHotel: hB.id, status: "active", password: PASSWORD, passwordConfirm: PASSWORD,
  });
  gmB = await login(gmBUser.nationalId, PASSWORD);
});

afterAll(async () => {
  for (const r of await su.collection("reviews").getFullList({ filter: `hotel = "${hotelId()}"` })) await su.collection("reviews").delete(r.id);
  for (const name of ["reviewSurveyTokens", "reviewSources", "reviewProfiles"]) {
    for (const r of await su.collection(name).getFullList({ filter: `hotel = "${hotelId()}"` })) await su.collection(name).delete(r.id);
  }
  await setFlag(hotelId(), false).catch(() => {});
  if (gmBUser) await su.collection("users").delete(gmBUser.id).catch(() => {});
  for (const h of [hB, hC]) if (h) await su.collection("hotels").delete(h.id).catch(() => {});
});

describe("JSVM compatibility", () => {
  it("the bundled core uses no Unicode property escapes (the PocketBase JSVM does not support \\p{…})", () => {
    const src = readFileSync(new URL("../pb_hooks/lib/core.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/\\[pP]\{/);
  });
});

describe("profile and permissions", () => {
  it("defaults come from the hotel; view-only roles read, only managers write; superAdmin-only fields", async () => {
    const p = await gm.send("/api/zarin/reviews/profile", {});
    expect(p).toMatchObject({ id: null, retentionDays: 365, feature: false, survey: { publicEnabled: false, roomEnabled: false } });
    expect(p.names.fa).toBeTruthy();
    const view = await inv.send("/api/zarin/reviews/profile", {});
    expect(view.recipients).toBeUndefined();
    expect(await errorOf(reception.send("/api/zarin/reviews/profile", {}))).toMatchObject({ status: 403, code: "missing_permission" });
    expect(await errorOf(post(inv, "/api/zarin/reviews/profile", { aliases: ["x"] }))).toMatchObject({ status: 403, code: "missing_permission" });
    expect(await errorOf(post(gm, "/api/zarin/reviews/profile", { llmDailyCap: 10 }))).toMatchObject({ status: 403, code: "superadmin_only" });
    expect(await errorOf(post(gm, "/api/zarin/reviews/profile", { retentionDays: 900 }))).toMatchObject({ status: 400, code: "invalid_field" });
    expect(await errorOf(post(gm, "/api/zarin/reviews/profile", { hotel: hB.id, aliases: [] }))).toMatchObject({ status: 403 });
  });

  it("three fictional profiles: two share a brand in different cities", async () => {
    const a = await post(gm, "/api/zarin/reviews/profile", {
      names: { fa: "هتل نیلوفر کویر", en: "Niloofar Kavir Hotel" }, aliases: ["نیلوفر کویر"], city: "یزد", cityAliases: ["yazd"],
      negativeKeywords: ["کرمان", "شیراز"], survey: { brandName: "نیلوفر کویر" },
    });
    expect(a.id).toBeTruthy();
    expect(a.names.en).toBe("Niloofar Kavir Hotel");
    await post(sa, "/api/zarin/reviews/profile", { hotel: hB.id, names: { fa: "هتل نیلوفر کویر کرمان" }, aliases: ["نیلوفر کویر"], city: "کرمان", negativeKeywords: ["یزد"] });
    await post(sa, "/api/zarin/reviews/profile", { hotel: hC.id, names: { fa: "هتل سپیدار ساحل" }, city: "بندرعباس" });
    expect((await post(sa, "/api/zarin/reviews/profile", { hotel: hotelId(), llmDailyCap: 20000 })).llmDailyCap).toBe(20000);
    const audit = await su.collection("auditLogs").getFirstListItem(`hotel = "${hotelId()}" && action = "reviewProfiles.update"`, { sort: "-created" });
    expect(audit.actor.role).toBe("superAdmin");
  });
});

const CSV = [
  "id,date,rating,scale,text,url",
  `bk-1,${day(-10)},9,10,"اتاق تمیز بود. شمارهٔ من 09123456789 است، ایمیل guest@example.com",`,
  `bk-2,${day(-9)},4,10,صبحانه سرد بود و کسی پاسخ نداد,`,
  `bk-3,${day(-8)},,,"هتل نیلوفر کویر کرمان را با این‌جا اشتباه نگیرید، آن‌جا بهتر بود",`,
  `bk-4,${day(-7)},12,10,امتیاز نامعتبر,`,
  `,${day(-6)},,,,`,
].join("\n");

describe("CSV import", () => {
  it("flag off: the dry run works, the commit does not", async () => {
    const dry = await post(gm, "/api/zarin/reviews/import", { csv: CSV, platform: "booking" });
    expect(dry).toMatchObject({ dryRun: true, created: 3, needsReview: 1 });
    expect(dry.errors).toEqual([{ row: 4, reason: "bad_rating" }, { row: 5, reason: "no_text_or_rating" }]);
    expect(dry.preview[0].text).not.toMatch(/0912|example\.com/);
    expect(dry.preview[0].text).toContain("[phone]");
    expect(dry.preview[0].rating5).toBe(4.56);
    expect(await reviewsOf()).toHaveLength(0);
    expect(await errorOf(post(gm, "/api/zarin/reviews/import", { csv: CSV, dryRun: false }))).toMatchObject({ status: 400, code: "feature_disabled" });
    expect(await errorOf(gm.send("/api/zarin/reviews/queue", {}))).toMatchObject({ code: "feature_disabled" });
  });

  it("commit: redacted, scaled to 1–5, the confusable hotel goes to the queue; a second run changes nothing", async () => {
    await setFlag(hotelId(), true);
    const r = await post(gm, "/api/zarin/reviews/import", { csv: CSV, platform: "booking", dryRun: false });
    expect(r).toMatchObject({ dryRun: false, created: 3, needsReview: 1, updated: 0 });
    const saved = await reviewsOf();
    expect(saved).toHaveLength(3);
    expect(saved.map((x) => x.text).join(" ")).not.toMatch(/0912|example\.com/);
    expect(saved[0]).toMatchObject({ platform: "booking", channel: "csv", externalId: "bk-1", rating5: 4.56, status: "active" });
    const queued = saved.find((x) => x.externalId === "bk-3");
    expect(queued.status).toBe("needsReview");
    // The hotel's own negative keyword (the other city) sent it to the queue; no other hotel is named.
    expect(queued.matchReasons).toEqual(["negative:کرمان"]);
    expect(JSON.stringify(queued.matchReasons)).not.toContain(hB.id);
    const again = await post(gm, "/api/zarin/reviews/import", { csv: CSV, platform: "booking", dryRun: false });
    expect(again).toMatchObject({ created: 0, unchanged: 3 });
    const audit = await su.collection("auditLogs").getFirstListItem(`hotel = "${hotelId()}" && action = "reviews.import"`, { sort: "-created" });
    expect(audit.changes).toMatchObject({ created: 0, unchanged: 3 });
  });

  it("REST: hidden fields stay hidden; the queue is not in the collection; view-only roles see accepted reviews", async () => {
    const list = await inv.collection("reviews").getFullList();
    expect(list.length).toBe(2);
    expect(list.every((x) => x.status === "active")).toBe(true);
    for (const x of list) {
      expect(x.textKey).toBeUndefined();
      expect(x.authorHash).toBeUndefined();
      expect(x.candidates).toBeUndefined();
    }
    expect(await reception.collection("reviews").getFullList()).toHaveLength(0);
    await expect(gm.collection("reviews").create({ hotel: hotelId(), platform: "other", channel: "manual", status: "active" })).rejects.toThrow();
    // Another hotel's manager sees nothing of this hotel and cannot import into it.
    expect(await gmB.collection("reviews").getFullList()).toHaveLength(0);
    expect((await gmB.collection("reviewProfiles").getFullList()).map((p) => p.hotel)).toEqual([hB.id]);
    expect(await errorOf(post(gmB, "/api/zarin/reviews/import", { hotel: hotelId(), csv: CSV }))).toMatchObject({ status: 403, code: "not_hotel_member" });
  });

  it("the same review through another channel is completed, not doubled; a cross-post is linked", async () => {
    const text = "کارکنان پذیرش بسیار مهربان بودند و اتاق رو به حیاط آرام بود";
    const m = await post(gm, "/api/zarin/reviews", { channel: "manual", platform: "booking", text, postedAt: day(-3) });
    expect(m).toMatchObject({ outcome: "created", status: "active" });
    // The later export has the review id and the rating: same record.
    const csv = `id,date,rating,scale,text\nbk-9,${day(-2)},,,"${text}."\n`;
    const r = await post(gm, "/api/zarin/reviews/import", { csv, platform: "booking", dryRun: false });
    expect(r).toMatchObject({ created: 0, updated: 1 });
    expect((await su.collection("reviews").getOne(m.id)).externalId).toBe("bk-9");
    // The same guest on Google two days later: saved, pointing at the first.
    const g = await post(gm, "/api/zarin/reviews", { channel: "manual", platform: "google", text, postedAt: day(-1), rating: 5 });
    expect((await su.collection("reviews").getOne(g.id)).duplicateOf).toBe(m.id);
  });

  it("Jalali dates and Persian headers", async () => {
    const r = await post(gm, "/api/zarin/reviews/import", { csv: "شناسه,تاریخ,امتیاز,از,متن\nj-1,۱۴۰۵/۰۸/۲۸,۵,۵,خوب\nj-2,1405/07/31,4,5,بد\n", platform: "google" });
    expect(r.preview[0].postedAt).toBe("2026-11-19");
    expect(r.errors).toEqual([{ row: 2, reason: "bad_date" }]);
  });
});

describe("queue and decisions", () => {
  it("lists waiting reviews to managers only; accept and reject with audit", async () => {
    const q = await gm.send("/api/zarin/reviews/queue", {});
    expect(q.items.length).toBe(1);
    expect(q.items[0].matchReasons).toEqual(["negative:کرمان"]);
    expect(JSON.stringify(q)).not.toContain(hB.id);
    expect(await errorOf(inv.send("/api/zarin/reviews/queue", {}))).toMatchObject({ status: 403 });
    const id = q.items[0].id;
    expect(await errorOf(post(inv, `/api/zarin/reviews/${id}/decide`, { decision: "accept" }))).toMatchObject({ status: 403 });
    expect(await post(gm, `/api/zarin/reviews/${id}/decide`, { decision: "reject" })).toMatchObject({ status: "rejected" });
    expect(await post(gm, `/api/zarin/reviews/${id}/decide`, { decision: "accept" })).toMatchObject({ status: "active" });
    expect(await errorOf(post(gm, `/api/zarin/reviews/${id}/decide`, { decision: "accept" }))).toMatchObject({ code: "transition_not_allowed" });
    expect(await errorOf(post(gmB, `/api/zarin/reviews/${id}/decide`, { decision: "reject" }))).toMatchObject({ status: 403 });
    const audit = await su.collection("auditLogs").getFullList({ filter: `hotel = "${hotelId()}" && action = "reviews.decide" && resourceId = "${id}"` });
    expect(audit).toHaveLength(2);
  });

  it("a profile change matches the queue again (accepted reviews are left alone)", async () => {
    const w = await post(gm, "/api/zarin/reviews", { channel: "manual", text: "سفر کاری به شیراز و یک شب اقامت، همه چیز خوب بود", postedAt: day(-1) });
    expect(w.status).toBe("needsReview");
    const p = await post(gm, "/api/zarin/reviews/profile", { negativeKeywords: ["کرمان"] });
    expect(p.rematched).toEqual({ accepted: 1, waiting: 0 });
    expect((await su.collection("reviews").getOne(w.id)).status).toBe("active");
  });
});

describe("share-to-app and listings", () => {
  it("staff share: the link is kept and its platform guessed, the text redacted, the sharer recorded", async () => {
    const r = await post(gm, "/api/zarin/reviews", {
      channel: "staff_share", text: "این نظر را در اینستاگرام دیدم: «تخت راحت بود» https://www.instagram.com/p/AbC123/ — @someone",
    });
    const rec = await su.collection("reviews").getOne(r.id);
    expect(rec).toMatchObject({ channel: "staff_share", platform: "instagram", url: "https://www.instagram.com/p/AbC123/" });
    expect(rec.text).not.toMatch(/instagram\.com|@someone/);
    expect(rec.capturedBy).toBeTruthy();
    expect(await errorOf(post(inv, "/api/zarin/reviews", { channel: "staff_share", text: "x" }))).toMatchObject({ status: 403 });
    expect(await errorOf(post(gm, "/api/zarin/reviews", { channel: "staff_share", text: "" }))).toMatchObject({ code: "no_text_or_rating" });
  });

  it("a confirmed listing decides the match; rejecting it archives its reviews", async () => {
    const l = await post(gm, "/api/zarin/review-sources", { url: "https://maps.google.com/place/fictional-niloofar", label: "Google Maps" });
    expect(l).toMatchObject({ status: "candidate", platform: "google" });
    expect(await errorOf(post(gm, "/api/zarin/review-sources", { url: "https://maps.google.com/place/fictional-niloofar" }))).toMatchObject({ code: "source_exists" });
    // Before confirmation an ambiguous text waits; confirming the listing accepts it.
    const w = await post(gm, "/api/zarin/reviews", { channel: "manual", text: "هتل نیلوفر کویر کرمان؟ نه، همین‌جا", url: "https://maps.google.com/place/fictional-niloofar/review/1" });
    expect(w.status).toBe("needsReview");
    await post(gm, `/api/zarin/review-sources/${l.id}/decide`, { decision: "confirm" });
    const rec = await su.collection("reviews").getOne(w.id);
    expect(rec).toMatchObject({ status: "active", listing: l.id });
    const rej = await post(gm, `/api/zarin/review-sources/${l.id}/decide`, { decision: "reject", note: "not ours" });
    expect(rej).toMatchObject({ status: "rejected", archived: 1 });
    expect((await su.collection("reviews").getOne(w.id)).status).toBe("archived");
    // Imported under a confirmed listing: its scale and the listing link.
    const bk = await post(gm, "/api/zarin/review-sources", { platform: "booking", url: "https://www.booking.com/hotel/ir/fictional-niloofar.html", confirm: true });
    const imp = await post(gm, "/api/zarin/reviews/import", { csv: `id,rating,text\nbk-50,8,خوب\n`, listingId: bk.id, dryRun: false });
    expect(imp.created).toBe(1);
    const x = (await reviewsOf(`externalId = "bk-50"`))[0];
    expect(x).toMatchObject({ listing: bk.id, platform: "booking", scaleMax: 10, status: "active" });
  });
});

describe("dry run", () => {
  it("a checklist and the samples through the pipeline, nothing saved", async () => {
    const before = (await reviewsOf()).length;
    const r = await post(gm, "/api/zarin/reviews/dry-run", { samples: [{ text: "هتل سپیدار ساحل بندرعباس عالی بود" }, { text: "خوب" }] });
    expect(r.checks).toMatchObject({ profileSaved: true, names: true, city: true, listingsConfirmed: 1, feature: true, surveyConfigured: true });
    expect(r.samples.map((s) => s.status)).toEqual(["needsReview", "active"]);
    expect((await reviewsOf()).length).toBe(before);
  });
});

describe("QR survey", () => {
  let pub;
  let form;
  const send = (token, body) => fetch(`${url()}/api/zarin/survey/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json() }));
  async function formOf(token) {
    const html = await (await fetch(`${url()}/survey/${token}`)).text();
    return { t: /name="t" value="(\d+)"/.exec(html)[1], sig: /name="sig" value="([0-9a-f]+)"/.exec(html)[1] };
  }

  it("public token: off until enabled, then a branded page without scripts", async () => {
    const r = await post(gm, "/api/zarin/reviews/survey/tokens", { kind: "public" });
    expect(r.created).toBe(1);
    pub = r.tokens[0].token;
    expect((await fetch(`${url()}/survey/${pub}`)).status).toBe(404);
    await post(gm, "/api/zarin/reviews/profile", { survey: { publicEnabled: true, roomEnabled: true, publicHourlyCap: 2 } });
    const res = await fetch(`${url()}/survey/${pub}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain("نیلوفر کویر");
    expect(html).not.toContain("<script");
    expect((await fetch(`${url()}/survey/${pub}?lang=en`).then((x) => x.text()))).toContain("How was your stay");
    expect((await fetch(`${url()}/survey/notarealtoken12345`)).status).toBe(404);
    // Token records: managers only.
    expect(await inv.collection("reviewSurveyTokens").getFullList()).toHaveLength(0);
  });

  it("answers: a fresh form is refused, the honeypot is silent, the hourly cap holds", async () => {
    form = await formOf(pub);
    expect(await send(pub, { ...form, rating: 5 })).toMatchObject({ status: 400, json: { code: "expired" } });
    await sleep(3100);
    expect(await send(pub, { ...form, rating: 5, sig: "0".repeat(64) })).toMatchObject({ status: 400 });
    expect(await send(pub, { ...form, rating: 7 })).toMatchObject({ status: 400, json: { code: "ratingRequired" } });
    expect(await send(pub, { ...form, rating: 5, website: "spam" })).toMatchObject({ status: 200 });
    expect(await reviewsOf(`channel = "survey_public"`)).toHaveLength(0);
    expect(await send(pub, { ...form, rating: 4, text: "خوب بود؛ شماره‌ام 09121112233", lang: "fa" })).toMatchObject({ status: 200, json: { ok: true } });
    // The HTML form (urlencoded) works the same.
    const res = await fetch(`${url()}/survey/${pub}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, rating: "3", text: "" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("سپاس");
    expect(await send(pub, { ...form, rating: 5 })).toMatchObject({ status: 429, json: { code: "limit" } });
    const saved = await reviewsOf(`channel = "survey_public"`);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ platform: "survey", rating5: 4, status: "active" });
    expect(saved[0].text).toContain("[phone]");
    expect(saved[0].authorHash).toBeTruthy();
  });

  it("room token: only during the stay (+24 h), 3 answers per stay, rotates at check-out", async () => {
    const room = await roomByNumber(su, "101");
    await su.collection("rooms").update(room.id, { status: "vacantClean" });
    const t = await post(gm, "/api/zarin/reviews/survey/tokens", { kind: "room", roomId: room.id });
    const tok = t.tokens.find((x) => x.room === room.id);
    const first = tok.token;
    const f = await formOf(first);
    await sleep(3100);
    expect(await send(first, { ...f, rating: 5 })).toMatchObject({ status: 403 });
    await su.collection("rooms").update(room.id, { status: "occupied" });
    for (let i = 0; i < 3; i++) expect((await send(first, { ...f, rating: 4 })).status).toBe(200);
    expect(await send(first, { ...f, rating: 4 })).toMatchObject({ status: 429 });
    // Check-out: a new token; the old one still works (24 h) but this stay is used up.
    await su.collection("rooms").update(room.id, { status: "vacantDirty" });
    const rotated = await su.collection("reviewSurveyTokens").getOne(tok.id);
    expect(rotated.token).not.toBe(first);
    expect(rotated.previousToken).toBe(first);
    expect(await send(first, { ...f, rating: 4 })).toMatchObject({ status: 429 });
    // The next guest's card does not work before check-in.
    const f2 = await formOf(rotated.token);
    expect(f2.t).toBeTruthy();
    const saved = await reviewsOf(`channel = "survey_room"`);
    expect(saved).toHaveLength(3);
    // No room is stored on the review.
    expect(Object.keys(saved[0])).not.toContain("room");
    expect(rotated.printedAt).toBe("");
    await post(gm, "/api/zarin/reviews/survey/printed", { ids: [tok.id] });
    expect((await su.collection("reviewSurveyTokens").getOne(tok.id)).printedAt).toBeTruthy();
    // A manual rotation (lost card) stops the old token at once.
    const pubRec = await su.collection("reviewSurveyTokens").getFirstListItem(`token = "${pub}"`);
    const r2 = await post(gm, `/api/zarin/reviews/survey/tokens/${pubRec.id}/rotate`, {});
    expect(r2.token).not.toBe(pub);
    expect((await fetch(`${url()}/survey/${pub}`)).status).toBe(404);
    await su.collection("rooms").update(room.id, { status: room.status });
  });
});

describe("retention", () => {
  it("texts older than the hotel's retention are emptied; ratings stay; shortening asks for confirmation", async () => {
    await post(gm, "/api/zarin/reviews/import", { csv: `id,date,rating,scale,text\nold-1,${day(-400)},8,10,متن قدیمی\n`, platform: "booking", dryRun: false });
    const err = await errorOf(post(gm, "/api/zarin/reviews/profile", { retentionDays: 30 }));
    expect(err).toMatchObject({ code: "retention_confirm_required" });
    // The crons API starts the job in the background: wait for it.
    await su.send("/api/crons/zarin_review_retention", { method: "POST" });
    let old;
    for (let i = 0; i < 50; i++) {
      old = (await reviewsOf(`externalId = "old-1"`))[0];
      if (old.textPurgedAt) break;
      await sleep(100);
    }
    expect(old).toMatchObject({ text: "", rating5: 4.11 });
    expect(old.textPurgedAt).toBeTruthy();
    expect((await reviewsOf(`externalId = "bk-1"`))[0].text).not.toBe("");
  });
});
