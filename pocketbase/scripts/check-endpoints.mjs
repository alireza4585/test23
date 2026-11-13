// Checks that PocketBase and n8n answer on their public addresses and are
// wired to each other. Read-only: nothing is created, changed or executed.
//
//   ZH_PB_URL=https://ali2.axono.ir N8N_URL=https://ali.axono.ir npm run check-endpoints
//   … npm run check-endpoints -- --superuser          also: Application URL setting, outbox delivery to n8n
//   … npm run check-endpoints -- --signed <hotelId>   also: a signed request exactly as n8n sends it
//
// --superuser asks for the superuser e-mail and password (or ZH_PB_SUPERUSER_EMAIL /
// ZH_PB_SUPERUSER_PASSWORD). --signed uses ZARIN_KEY_ID + ZARIN_KEY_SECRET (scoped
// key, v2) when both are set, otherwise ZARIN_INTEGRATION_SECRET (v1), asked for
// without echo when missing. Secrets are never printed.
import { createHmac, randomBytes } from "node:crypto";

import PocketBase from "pocketbase";

import { superuserLogin, value } from "./prompt.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const TIMEOUT_MS = 20000;
const results = [];
const report = (ok, name, detail = "") => {
  results.push(ok);
  const mark = ok === true ? "PASS" : ok === false ? "FAIL" : "INFO";
  console.log(`${mark}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/** fetch with a timeout; the error says why a connection failed (DNS, TLS, refused …). */
async function get(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, location: res.headers.get("location") };
  } catch (err) {
    const cause = err.cause?.code || err.cause?.message || err.name || err.message;
    return { status: 0, error: String(cause) };
  }
}

const base = (v) => v.replace(/\/+$/, "");
const urlCheck = (v) => (/^https:\/\/[^\s/]+$/.test(base(v)) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base(v)) ? undefined : "Use https://host (no path).");
const pbUrl = base(await value("ZH_PB_URL", { question: "PocketBase URL (e.g. https://ali2.axono.ir): ", validate: urlCheck }));
const n8nUrl = base(await value("N8N_URL", { question: "n8n URL (e.g. https://ali.axono.ir): ", validate: urlCheck }));
console.log(`PocketBase ${pbUrl} · n8n ${n8nUrl}\n`);

// ------------------------------------------------------------- PocketBase
const health = await get(`${pbUrl}/api/health`);
report(health.status === 200, "PocketBase /api/health", health.error ? `cannot connect: ${health.error}` : `HTTP ${health.status}`);
const v1 = await get(`${pbUrl}/v1/health`);
report(v1.status === 200 && v1.json?.service === "zarin-hooshmand" && v1.json?.backend === "pocketbase", "Zarin hooks answer (/v1/health)",
  v1.error ? `cannot connect: ${v1.error}` : `HTTP ${v1.status} ${v1.text?.slice(0, 120) ?? ""}`);
if (pbUrl.startsWith("https://")) {
  const plain = await get(`http://${pbUrl.slice(8)}/api/health`);
  report(null, "PocketBase over plain http", plain.error ? `no answer (${plain.error})` : `HTTP ${plain.status}${plain.location ? ` → ${plain.location}` : ""}`);
}
// Which release is deployed: a missing collection answers 404, an existing one 200 or 403 (read-only list).
const releases = [["forecasts", "AI batch 1"], ["integrationKeys", "phase 0"], ["dailyFinance", "phase 0.5"], ["aiActions", "phase 1"]];
const present = [];
for (const [col, release] of releases) {
  const r = await get(`${pbUrl}/api/collections/${col}/records?perPage=1`);
  if (r.status === 200 || r.status === 403) present.push(release);
}
report(null, "Deployed release (by collections)", present.length ? present.join(", ") : "1544bc1 or older (no AI collections)");

// ------------------------------------------------------------------- n8n
const n8nHealth = await get(`${n8nUrl}/healthz`);
report(n8nHealth.status === 200, "n8n /healthz", n8nHealth.error ? `cannot connect: ${n8nHealth.error}` : `HTTP ${n8nHealth.status} ${n8nHealth.text?.slice(0, 60) ?? ""}`);
// A GET on a POST-only production webhook is refused by n8n without running the workflow;
// the message tells whether workflow 01 is published.
const events = await get(`${n8nUrl}/webhook/zarin-events`);
const published = /POST request/i.test(events.text || "");
report(published, "Workflow 01 webhook /webhook/zarin-events is published",
  events.error ? `cannot connect: ${events.error}` : `HTTP ${events.status} ${(events.json?.message || events.text || "").slice(0, 110)}`);
// Without the X-Meter-Key header n8n refuses before the workflow runs (403 when 04 is published).
const meter = await get(`${n8nUrl}/webhook/meter-readings`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
report(meter.error ? false : meter.status === 403 ? true : null, "Workflow 04 webhook /webhook/meter-readings (needs Header Auth)",
  meter.error ? `cannot connect: ${meter.error}` : meter.status === 403 ? "HTTP 403 without the key: published and protected" : `HTTP ${meter.status} (404 = not published yet)`);

// ------------------------------------------------- superuser: settings, outbox
if (flag("superuser") && health.status === 200) {
  const pb = new PocketBase(pbUrl);
  pb.autoCancellation(false);
  await superuserLogin(pb);
  const settings = await pb.settings.getAll();
  const appUrl = base(settings.meta?.appURL || "");
  report(appUrl === pbUrl, "Settings → Application URL", appUrl ? `${appUrl}${appUrl === pbUrl ? "" : ` (expected ${pbUrl})`}` : "empty");
  const recent = await pb.collection("outbox").getList(1, 50, { sort: "-created" });
  if (!recent.items.length) {
    report(null, "Outbox (PocketBase → n8n events)", "empty: ZH_N8N_WEBHOOK_URL is not set, or nothing has happened yet");
  } else {
    const delivered = recent.items.filter((o) => o.deliveredAt);
    const failing = recent.items.filter((o) => !o.deliveredAt && o.attempts > 0);
    const last = delivered[0];
    report(failing.length === 0 && delivered.length > 0, "Outbox (PocketBase → n8n events)",
      `${delivered.length} of the last ${recent.items.length} delivered${last ? `, newest delivered ${last.deliveredAt}` : ""}` +
      (failing.length ? `; ${failing.length} failing, last error: ${String(failing[0].lastError).slice(0, 160)}` : ""));
  }
}

// ------------------------------------------- signed request (n8n → PocketBase)
const hotelId = option("signed");
if (hotelId) {
  const keyId = process.env.ZARIN_KEY_ID || "";
  const keySecret = process.env.ZARIN_KEY_SECRET || "";
  const scoped = Boolean(keyId && keySecret);
  const secret = scoped ? keySecret : await value("ZARIN_INTEGRATION_SECRET", { question: "Integration secret (ZH_INTEGRATION_SECRET): ", hidden: true });
  const ts = Math.floor(Date.now() / 1000);
  const nonce = scoped ? randomBytes(16).toString("hex") : "";
  const signature = createHmac("sha256", secret).update(scoped ? `${ts}.${nonce}.` : `${ts}.`).digest("hex");
  const headers = { "x-zarin-timestamp": String(ts), "x-zarin-signature": signature, ...(scoped ? { "x-zarin-key-id": keyId, "x-zarin-nonce": nonce } : {}) };
  const r = await get(`${pbUrl}/v1/hotels/${encodeURIComponent(hotelId)}/summary`, { headers });
  report(r.status === 200, `Signed GET /v1/hotels/${hotelId}/summary (${scoped ? "scoped key, v2" : "shared secret, v1"})`,
    r.error ? `cannot connect: ${r.error}` : r.status === 200 ? `HTTP 200, hotel «${r.json?.hotel ?? "?"}», day ${r.json?.day ?? "?"}` : `HTTP ${r.status} ${(r.json?.message || "").slice(0, 100)}`);
}

const failed = results.filter((x) => x === false).length;
console.log(`\n${results.filter((x) => x === true).length} passed, ${failed} failed, ${results.filter((x) => x === null).length} for information`);
process.exit(failed ? 1 : 0);
