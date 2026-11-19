// F10 R1 on the synthetic multi-hotel fixtures (fixtures/reviews, docs/21 §8.1):
// three fictional hotels onboarded (one through the CLI), every CSV imported
// through the app route, and each stored review compared with its ground truth:
// status (incl. the confusable hotel's mentions), 1–5 rating, cross-posts,
// edits, deletions, redaction of personal data (filled in at runtime here),
// prompt injections stored as plain data, the source with no reviews, and the
// platform-level matcher on the labelled mentions.
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applySpec } from "../scripts/lib/review-profile.mjs";
import { SUPERUSER } from "./global-setup.mjs";
import { NID, login, post, superuser, url } from "./helpers.mjs";

const core = createRequire(import.meta.url)("../pb_hooks/lib/core.js");
const FX = new URL("../../fixtures/reviews/", import.meta.url);
const read = (p) => readFileSync(new URL(p, FX), "utf8");
const spec = JSON.parse(read("src/hotels.json"));
const truth = read("generated/reviews.jsonl").trim().split("\n").map((l) => JSON.parse(l));
const mentions = read("generated/mentions.jsonl").trim().split("\n").map((l) => JSON.parse(l));
const manifest = JSON.parse(read("generated/manifest.json"));

// Personal data generated per run: nothing of the kind is in the repository.
function nationalId() {
  const d = Array.from({ length: 9 }, () => randomInt(10));
  const s = d.reduce((a, x, i) => a + x * (10 - i), 0) % 11;
  return d.join("") + String(s < 2 ? s : 11 - s);
}
const PII = { PHONE: `09${String(randomInt(1e8, 1e9))}`, EMAIL: `g${randomInt(1e6)}@example.net`, NID: nationalId() };
const fill = (s) => s.replace(/\{(PHONE|EMAIL|NID)\}/g, (_, k) => PII[k]);

let su;
let sa;
const idOf = Object.fromEntries(spec.hotels.map((h) => [h.key, h.id]));
const results = {};

beforeAll(async () => {
  su = await superuser();
  sa = await login(NID.superAdmin);
  for (const h of spec.hotels) {
    await su.collection("hotels").create({ id: h.id, ...h.hotel, settings: { features: { guestReviews: true } } });
  }
  for (const h of spec.hotels.slice(0, 2)) await applySpec(su, h.id, h);
  // The third through the CLI, as the platform owner would.
  const out = execFileSync("node", ["scripts/review-profile.mjs", spec.hotels[2].id, "--apply", new URL("src/hotels.json", FX).pathname, "--key", spec.hotels[2].key], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, ZH_PB_URL: url(), ZH_PB_SUPERUSER_EMAIL: SUPERUSER.email, ZH_PB_SUPERUSER_PASSWORD: SUPERUSER.password },
    encoding: "utf8",
  });
  results.cli = out;
  // Booking before Google, so a cross-post points at the original; the update file last.
  const files = manifest.files.filter((f) => f.startsWith("csv/") && !f.endsWith("-update.csv"))
    .sort((a, b) => (a.includes("booking") ? -1 : b.includes("booking") ? 1 : a < b ? -1 : 1));
  for (const f of files.concat(manifest.files.filter((x) => x.endsWith("-update.csv")))) {
    const key = spec.hotels.find((h) => f.startsWith(`csv/${h.key}-`)).key;
    const platform = f.slice(`csv/${key}-`.length).replace(/(-update)?\.csv$/, "");
    const t = Date.now();
    results[f] = await post(sa, "/api/zarin/reviews/import", { hotel: idOf[key], csv: fill(read(`generated/${f}`)), platform, dryRun: false });
    results[f].ms = Date.now() - t;
  }
}, 300_000);

afterAll(async () => {
  for (const h of spec.hotels) await su.collection("hotels").delete(h.id).catch(() => {});
});

const stored = async (key) => su.collection("reviews").getFullList({ filter: `hotel = "${idOf[key]}"`, batch: 1000 });

describe("onboarding", () => {
  it("profiles and listings from data; the CLI shows what it applied", async () => {
    expect(results.cli).toContain("profile created; listings: 2 added");
    for (const h of spec.hotels) {
      const p = await su.collection("reviewProfiles").getFirstListItem(`hotel = "${h.id}"`);
      expect(p.names).toEqual(h.profile.names);
      expect(p.retentionDays).toBe(h.profile.retentionDays);
      const ls = await su.collection("reviewSources").getFullList({ filter: `hotel = "${h.id}"` });
      expect(ls.map((l) => `${l.platform}:${l.status}`).sort()).toEqual(h.listings.map((l) => `${l.platform}:${l.status}`).sort());
    }
    const a = await su.collection("auditLogs").getFullList({ filter: `action = "reviewProfiles.onboard"` });
    expect(a.length).toBe(3);
  });
});

describe("import against the ground truth", () => {
  it("every row is read; nothing is merged by accident", () => {
    for (const [f, r] of Object.entries(results)) {
      if (!f.startsWith("csv/")) continue;
      expect(r.errors, f).toEqual([]);
      if (f.endsWith("-update.csv")) expect(r, f).toMatchObject({ created: 0, updated: manifest.updates, edited: 5 });
      else expect(r.created, f).toBe(r.rows);
    }
  });

  it("imports stay fast (the JSVM once took ~65 ms a row: regexes recompiled per call)", () => {
    for (const [f, r] of Object.entries(results)) if (f.startsWith("csv/")) expect(r.ms / Math.max(r.rows, 1), f).toBeLessThan(20);
  });

  it("status, rating and platform of each review match the labels (100%)", async () => {
    const wrong = [];
    for (const h of spec.hotels) {
      const byId = Object.fromEntries((await stored(h.key)).map((r) => [`${r.platform}|${r.externalId}`, r]));
      for (const t of truth.filter((x) => x.hotel === h.key)) {
        const r = byId[`${t.platform}|${t.externalId}`];
        if (!r) { wrong.push(`${t.externalId}: missing`); continue; }
        if (r.status !== t.truth.expectedStatus) wrong.push(`${t.externalId}: ${r.status} ≠ ${t.truth.expectedStatus}`);
        const r5 = t.truth.edited ? t.truth.edited.rating5 : t.truth.rating5;
        if ((r.rating5 || null) !== r5) wrong.push(`${t.externalId}: rating ${r.rating5} ≠ ${r5}`);
        if (r.postedAt.slice(0, 10) !== t.postedAt) wrong.push(`${t.externalId}: day ${r.postedAt} ≠ ${t.postedAt}`);
      }
      expect(Object.keys(byId).length, h.key).toBe(manifest.byHotel[h.key]);
    }
    expect(wrong).toEqual([]);
  });

  it("cross-posts point at the original; edits replace the text; deletions keep the record", async () => {
    const a = await stored("niloofar-yazd");
    const by = Object.fromEntries(a.map((r) => [`${r.platform}|${r.externalId}`, r]));
    const copies = truth.filter((t) => t.truth.crossPostOf);
    expect(copies.length).toBe(15);
    for (const t of copies) expect(by[`${t.platform}|${t.externalId}`].duplicateOf).toBe(by[`booking|${t.truth.crossPostOf}`].id);
    expect(a.filter((r) => r.duplicateOf).length).toBe(15);
    for (const t of truth.filter((x) => x.truth.edited)) {
      const r = by[`${t.platform}|${t.externalId}`];
      expect(r.text).toBe(core.redactReviewText(core.sanitizeReviewText(t.truth.edited.text, 8000)));
      expect(r.editedAt).toBeTruthy();
    }
    for (const t of truth.filter((x) => x.truth.expectedStatus === "deleted")) expect(by[`${t.platform}|${t.externalId}`].deletedAt).toBeTruthy();
  });

  it("personal data never stored; injections stored as plain text", async () => {
    const all = (await Promise.all(spec.hotels.map((h) => stored(h.key)))).flat();
    const texts = all.map((r) => r.text).join("\n");
    for (const v of Object.values(PII)) expect(texts).not.toContain(v);
    const pii = truth.filter((t) => t.truth.pii);
    expect(pii.length).toBe(20);
    const by = Object.fromEntries(all.map((r) => [`${r.platform}|${r.externalId}`, r]));
    for (const t of pii) expect(by[`${t.platform}|${t.externalId}`].text).toMatch(/\[(phone|email|id)\]/);
    for (const t of truth.filter((x) => x.truth.injection && !x.truth.edited)) {
      const r = by[`${t.platform}|${t.externalId}`];
      expect(r.status).toBe(t.truth.expectedStatus);
      expect(r.text.length).toBeGreaterThan(0);
    }
  });

  it("the confirmed source with no reviews stays empty; a second import changes nothing", async () => {
    const ex = await su.collection("reviewSources").getFirstListItem(`hotel = "${idOf.sepidar}" && platform = "expedia"`);
    expect(ex.status).toBe("confirmed");
    expect((await su.collection("reviews").getList(1, 1, { filter: `listing = "${ex.id}"` })).totalItems).toBe(0);
    const again = await post(sa, "/api/zarin/reviews/import", { hotel: idOf.sepidar, csv: fill(read("generated/csv/sepidar-google.csv")), platform: "google", dryRun: false });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: manifest.byHotel.sepidar });
  });
});

describe("platform-level matching (labelled mentions)", () => {
  it("each mention gets its expected hotel and verdict", () => {
    const profiles = spec.hotels.map((h) => ({
      hotelId: h.key, names: [h.profile.names.fa, h.profile.names.en].filter(Boolean), aliases: h.profile.aliases,
      cities: [h.profile.city, ...h.profile.cityAliases], negativeKeywords: h.profile.negativeKeywords,
      listings: h.listings.filter((l) => l.status === "confirmed"),
    }));
    const wrong = [];
    for (const m of mentions) {
      const r = core.matchMention({ text: m.text, url: m.url || null, platform: m.platform || null }, profiles);
      const hotel = m.truth.status === "needsReview" && m.truth.hotel === null ? null : r.hotelId;
      if (r.status !== m.truth.status || (m.truth.hotel !== null && hotel !== m.truth.hotel)) wrong.push(`${m.text}: ${r.status}/${r.hotelId}`);
      if (m.truth.candidates) expect(r.candidates.map((c) => c.hotelId).sort()).toEqual(m.truth.candidates);
    }
    expect(wrong).toEqual([]);
  });
});
