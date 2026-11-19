// F10 R2 e-mail intake on a live server: the hotel from its unguessable
// address, signed requests (shared secret or a key scoped to that hotel), the
// generic parser into "needs review", nothing usable → an excerpt, the same mail
// once, forwarding confirmations, a later CSV row settling the e-mail review,
// and no sender or recipient stored. A throw-away fictional hotel.
import * as cryptoModule from "node:crypto";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SECRET } from "./global-setup.mjs";
import { NID, errorOf, login, post, signed, superuser, url } from "./helpers.mjs";

const PASSWORD = `Em-${randomBytes(6).toString("hex")}-a1`;
const dayKey = (d) => new Date(d.getTime() + 210 * 60000).toISOString().slice(0, 10);
const yesterday = dayKey(new Date(Date.now() - 864e5));

function nationalId(prefix) {
  const d = prefix.split("").map(Number);
  const s = d.reduce((a, x, i) => a + x * (10 - i), 0) % 11;
  return prefix + String(s < 2 ? s : 11 - s);
}

async function signedV2(path, { keyId, secret }, body) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const n = randomBytes(12).toString("hex");
  const sig = createHmac("sha256", secret).update(`${ts}.${n}.${raw}`).digest("hex");
  const res = await fetch(`${url()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-zarin-key-id": keyId, "x-zarin-timestamp": String(ts), "x-zarin-nonce": n, "x-zarin-signature": sig },
    body: raw,
  });
  return { status: res.status, json: await res.json() };
}

let su;
let hotel;
let other;
let gmUser;
let gm;
let address;
const mail = (over) => ({
  to: [address], from: "Booking.com <noreply@booking.com>", subject: "Fwd: New guest review", date: new Date().toUTCString(),
  messageId: `<${randomBytes(8).toString("hex")}@mail.example>`,
  text: "---------- Forwarded message ---------\nFrom: Booking.com <noreply@booking.com>\n\nScore 4/10\nصبحانه سرد بود و صدای خیابان تا صبح می‌آمد. شماره‌ام 09121234567\nhttps://www.booking.com/reviews/fx-mail-1.html\nUnsubscribe",
  ...over,
});
const inbound = (body) => signed("/v1/reviews/inbound-email", { method: "POST", body });

beforeAll(async () => {
  su = await superuser();
  hotel = await su.collection("hotels").create({ name: "هتل آزمایشی ایمیل", city: "شیراز", status: "trial", settings: { features: { guestReviews: true } } });
  other = await su.collection("hotels").create({ name: "هتل آزمایشی دیگر", status: "trial", settings: { features: { guestReviews: true } } });
  gmUser = await su.collection("users").create({
    nationalId: nationalId("047123456"), fullName: "مدیرکل آزمایشی ایمیل", role: "generalManager", hotels: [hotel.id], primaryHotel: hotel.id,
    activeHotel: hotel.id, status: "active", password: PASSWORD, passwordConfirm: PASSWORD,
  });
  gm = await login(gmUser.nationalId, PASSWORD);
});

afterAll(async () => {
  if (gmUser) await su.collection("users").delete(gmUser.id).catch(() => {});
  for (const h of [hotel, other]) if (h) await su.collection("hotels").delete(h.id).catch(() => {});
});

describe("e-mail intake", () => {
  it("the manager creates the hotel's address (only managers; no mail domain on this server, so it is not shown)", async () => {
    const r = await post(gm, "/api/zarin/reviews/inbound-address", {});
    expect(r).toEqual({ address: "", configured: false });
    const reception = await login(NID.reception);
    expect((await errorOf(post(reception, "/api/zarin/reviews/inbound-address", {}))).status).toBe(403);
    const token = (await su.collection("reviewProfiles").getFirstListItem(`hotel = "${hotel.id}"`)).inboundToken;
    expect(token).toMatch(/^[a-z0-9]{24}$/);
    address = `Reviews <r-${token}@reviews.example.org>`;
  });

  it("signed only; an unknown address is refused", async () => {
    const res = await fetch(`${url()}/v1/reviews/inbound-email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mail()) });
    expect(res.status).toBe(401);
    expect((await inbound(mail({ to: ["r-nosuchtoken000000000000@reviews.example.org"] }))).status).toBe(404);
  });

  it("generic parser: one review waiting for a person, redacted, with its site, link and rating; the mail itself is not kept", async () => {
    const m = mail();
    const r = await inbound(m);
    expect(r.json).toMatchObject({ status: "created", kind: "generic", reviewStatus: "needsReview" });
    const list = await su.collection("reviews").getFullList({ filter: `hotel = "${hotel.id}" && channel = "email"` });
    expect(list).toHaveLength(1);
    const rv = list[0];
    expect(rv).toMatchObject({ platform: "booking", url: "https://www.booking.com/reviews/fx-mail-1.html", ratingRaw: 4, scaleMax: 10, status: "needsReview" });
    expect(rv.matchReasons).toContain("email_generic");
    expect(rv.text).toContain("صبحانه سرد بود");
    // The mail's RFC 2822 date is its day.
    expect(rv.postedAt.slice(0, 10)).toBe(dayKey(new Date(m.date)));
    expect(rv.text).not.toMatch(/0912|Unsubscribe|Forwarded|noreply/);
    expect(JSON.stringify(rv)).not.toMatch(/noreply@booking|reviews\.example\.org/);
    // The same mail again (n8n retried): taken once.
    expect((await inbound(m)).json).toEqual({ status: "duplicate" });
  });

  it("nothing usable → an excerpt for a person; a forwarding confirmation → the managers get its link", async () => {
    const r = await inbound(mail({ subject: "hi", text: "", html: "<p>ok</p>", from: "someone@mail.example" }));
    expect(r.json).toMatchObject({ kind: "unparsable", reviewStatus: "needsReview" });
    const c = await inbound(mail({ from: "Gmail Team <forwarding-noreply@google.com>", subject: "(#1) Gmail Forwarding Confirmation", text: "Confirm: https://mail-settings.google.com/mail/vf-test" }));
    expect(c.json).toEqual({ status: "confirmation" });
    const inbox = await su.collection("inbox").getFullList({ filter: `user = "${gmUser.id}"` });
    expect(inbox.some((n) => n.body.includes("https://mail-settings.google.com/mail/vf-test"))).toBe(true);
  });

  it("a later CSV row of the same review completes it and accepts it (counted once)", async () => {
    const csv = `id,date,rating,scale,text\nbk-mail-1,${dayKey(new Date())},4,10,"صبحانه سرد بود و صدای خیابان تا صبح می‌آمد. شماره‌ام [phone]"\n`;
    const r = await post(gm, "/api/zarin/reviews/import", { csv, platform: "booking", dryRun: false });
    expect(r).toMatchObject({ created: 0, updated: 1 });
    const rv = (await su.collection("reviews").getFullList({ filter: `hotel = "${hotel.id}" && channel = "email" && platform = "booking"` }))[0];
    expect(rv).toMatchObject({ externalId: "bk-mail-1", status: "active" });
  });

  it("a key scoped to another hotel cannot post for this one; a key scoped to it can", async () => {
    const otherKey = await su.send("/api/zarin/admin/integration-keys", { method: "POST", body: { label: "mail (other)", hotels: [other.id] } });
    const ownKey = await su.send("/api/zarin/admin/integration-keys", { method: "POST", body: { label: "mail (own)", hotels: [hotel.id] } });
    expect((await signedV2("/v1/reviews/inbound-email", otherKey, mail())).status).toBe(403);
    expect((await signedV2("/v1/reviews/inbound-email", ownKey, mail({ text: "Score 9/10 اتاق تمیز و دلباز بود و کارکنان مهربان بودند" }))).json).toMatchObject({ status: "created" });
    for (const k of [otherKey, ownKey]) await su.send(`/api/zarin/admin/integration-keys/${k.keyId}/revoke`, { method: "POST" });
  });

  it("flag off: mail is acknowledged and ignored", async () => {
    await su.collection("hotels").update(hotel.id, { settings: { features: { guestReviews: false } } });
    expect((await inbound(mail())).json).toEqual({ status: "ignored", reason: "feature_disabled" });
    await su.collection("hotels").update(hotel.id, { settings: { features: { guestReviews: true } } });
  });
});

describe("workflow 08 (n8n)", () => {
  const wf = JSON.parse(readFileSync(new URL("../../n8n/workflows/08-reviews-email.json", import.meta.url), "utf8"));
  const w05 = JSON.parse(readFileSync(new URL("../../n8n/workflows/05-purchase-order-followup.json", import.meta.url), "utf8"));
  const node = (w, name) => w.nodes.find((n) => n.name === name);
  // Runs a Code node's JavaScript as n8n would, with $env and $input.
  const runCode = (code, env, items) => new Function("$env", "$input", "require", code)(env, { all: () => items }, (m) => (m === "crypto" ? cryptoModule : null));

  it("inactive, no credentials, the same signing as the other workflows", () => {
    expect(wf.active).toBe(false);
    expect(wf.nodes.every((n) => !n.credentials)).toBe(true);
    expect(node(wf, "Sign request").parameters.jsCode).toBe(node(w05, "Sign request").parameters.jsCode);
    expect(node(wf, "POST inbound e-mail").parameters.url).toBe("={{ $env.ZARIN_API_BASE }}/v1/reviews/inbound-email");
    expect(node(wf, "Reviews mailbox (IMAP)").parameters).toMatchObject({ postProcessAction: "read", downloadAttachments: false });
  });

  it("its code nodes turn an auto-forwarded mail into a signed request the server accepts; other domains are skipped", async () => {
    const token = (await su.collection("reviewProfiles").getFirstListItem(`hotel = "${hotel.id}"`)).inboundToken;
    const env = { ZARIN_REVIEWS_MAIL_DOMAIN: "reviews.example.org", ZARIN_INTEGRATION_SECRET: SECRET };
    const imapItem = {
      json: {
        from: { text: "Booking.com <noreply@booking.com>" }, to: { text: "hotel-owner@hotel.example" }, subject: "Fwd: New review",
        date: new Date().toISOString(), messageId: `<${randomBytes(6).toString("hex")}@mail.example>`,
        text: "Score 7/10\nاتاق دلباز بود و پذیرش سریع بود و تخت راحت بود", headers: { "delivered-to": `r-${token}@reviews.example.org` },
      },
    };
    const skipped = runCode(node(wf, "Mail → review payload").parameters.jsCode, env, [{ json: { ...imapItem.json, headers: {} } }]);
    expect(skipped).toEqual([]);
    const payload = runCode(node(wf, "Mail → review payload").parameters.jsCode, env, [imapItem]);
    const [signedItem] = runCode(node(wf, "Sign request").parameters.jsCode, env, payload);
    const res = await fetch(`${url()}/v1/reviews/inbound-email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-zarin-timestamp": signedItem.json.zarinTimestamp, "x-zarin-signature": signedItem.json.zarinSignature, "x-zarin-key-id": "", "x-zarin-nonce": "" },
      body: signedItem.json.rawBody,
    });
    expect(await res.json()).toMatchObject({ status: "created", kind: "generic", reviewStatus: "needsReview" });
  });
});
