// Editor-level checks on a given n8n Docker image (default: the version on
// Liara), which the API-based e2e cannot see:
//   1. which workflow variants the editor lets you publish (e-mail node on
//      without SMTP, 04 without Header Auth, the files as shipped);
//   2. the DevTools-console fallback n8n/scripts/console-update.js: it upgrades
//      the first version imported on Liara and keeps its SMTP credential;
//   3. without the browser-id header n8n answers 401 and signs you out.
//
//   docker + Playwright with Chromium:  npm run browser-check
//   N8N_IMAGE=n8nio/n8n:<version> to test another version; CHROMIUM_PATH to
//   use an installed Chromium instead of Playwright's own.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const IMAGE = process.env.N8N_IMAGE ?? "n8nio/n8n:2.26.2";
const PORT = 5698;
const N8N = `http://127.0.0.1:${PORT}`;
const work = mkdtempSync(join(tmpdir(), "n8n-browser-"));
const env = {
  N8N_USER_FOLDER: work, N8N_PORT: String(PORT), N8N_LISTEN_ADDRESS: "127.0.0.1", N8N_ENCRYPTION_KEY: "browser-check",
  N8N_DIAGNOSTICS_ENABLED: "false", N8N_VERSION_NOTIFICATIONS_ENABLED: "false", N8N_TEMPLATES_ENABLED: "false",
  N8N_RUNNERS_BROKER_PORT: "5699", N8N_SECURE_COOKIE: "false",
};
const dockerArgs = (args, name) => ["run", "--rm", "--network", "host", "--user", "root", "-v", `${work}:${work}`,
  ...(name ? ["--name", name] : []), ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), IMAGE, ...args];
const n8n = (...args) => execFileSync("docker", dockerArgs(args), { stdio: "pipe", timeout: 300000 }).toString();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };

const load = (f) => JSON.parse(readFileSync(`${REPO}/n8n/workflows/${f}.json`, "utf8"));
const shipped = { ...load("01-event-router"), id: "brCheck00000001", name: "A · 01 as shipped" };
const enabled = load("01-event-router");
for (const n of enabled.nodes) if (n.type === "n8n-nodes-base.emailSend") delete n.disabled;
Object.assign(enabled, { id: "brCheck00000002", name: "B · 01 e-mail switched on, no SMTP" });
const meter = { ...load("04-smart-meter-ingestion"), id: "brCheck00000003", name: "C · 04 without Header Auth" };
const brief = { ...load("02-daily-management-briefing"), id: "brCheck00000004", name: "D · 02 as shipped" };
// E: the pre-gate version of 01 (as first imported on Liara), SMTP picked and switched on.
const old = JSON.parse(execFileSync("git", ["-C", REPO, "show", "2ffa1b4:n8n/workflows/01-event-router.json"]).toString());
for (const n of old.nodes) if (n.type === "n8n-nodes-base.emailSend") n.credentials = { smtp: { id: "brSmtp000000001", name: "SMTP check" } };
Object.assign(old, { id: "brCheck00000005", name: "E · 01 old version with SMTP" });
mkdirSync(join(work, "wf"));
for (const w of [shipped, enabled, meter, brief, old]) writeFileSync(join(work, "wf", `${w.id}.json`), JSON.stringify(w));
writeFileSync(join(work, "creds.json"), JSON.stringify([{ id: "brSmtp000000001", name: "SMTP check", type: "smtp", data: { host: "127.0.0.1", port: 2599, secure: false, user: "", password: "" } }]));
console.log(`image ${IMAGE}: n8n ${n8n("--version").trim().split("\n").pop()}`);
n8n("import:credentials", `--input=${join(work, "creds.json")}`);
n8n("import:workflow", "--separate", `--input=${join(work, "wf")}`);

const proc = spawn("docker", dockerArgs(["start"], "zarin-browser-check"), { stdio: ["ignore", "pipe", "pipe"] });
const log = createWriteStream(join(work, "n8n.log"));
proc.stdout.pipe(log);
proc.stderr.pipe(log);
for (let i = 0; i < 400; i++) {
  try { if ((await fetch(`${N8N}/signin`)).ok) break; } catch {}
  await wait(500);
}
await fetch(`${N8N}/rest/owner/setup`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "owner@check.local", firstName: "Check", lastName: "Owner", password: "Check-Password-123" }),
});

// The fallback docs/09-liara-runbook.md gives for the DevTools console, verbatim.
const SNIPPET = readFileSync(join(REPO, "n8n/scripts/console-update.js"), "utf8");

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
try {
  await page.goto(`${N8N}/signin`);
  await page.locator("input[type=email], input[name=emailOrLdapLoginId]").first().fill("owner@check.local");
  await page.locator("input[type=password]").first().fill("Check-Password-123");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 30000 });

  const publishState = async (id) => {
    await page.goto(`${N8N}/workflow/${id}`);
    const button = page.getByRole("button", { name: /^Publish/ }).first();
    await button.waitFor({ timeout: 60000 });
    await wait(2500);
    return (await button.isDisabled()) ? "blocked" : "allowed";
  };
  check("A · 01 as shipped can be published", (await publishState(shipped.id)) === "allowed");
  check("B · 01 with e-mail on and no SMTP is blocked", (await publishState(enabled.id)) === "blocked");
  check("C · 04 without Header Auth is blocked", (await publishState(meter.id)) === "blocked");
  check("D · 02 as shipped can be published", (await publishState(brief.id)) === "allowed");

  // Documented console update of E with the current 01 file.
  await page.goto(`${N8N}/workflow/${old.id}`);
  await page.getByRole("button", { name: /^Publish/ }).first().waitFor({ timeout: 60000 });
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.evaluate(`(async () => { ${SNIPPET}\n await zarinUpdate(${JSON.stringify(old.id)}, ${JSON.stringify(load("01-event-router"))}); })()`);
  await wait(3000);
  check("console update answers 200", logs.some((l) => /^200 16 nodes/.test(l)), logs.join(" | "));
  const after = await page.evaluate(async (id) => (await (await fetch(`/rest/workflows/${id}`, { headers: { "browser-id": localStorage.getItem("n8n-browserId") } })).json()).data, old.id);
  const mail = after.nodes.find((n) => n.name === "Purchase request e-mail");
  check("update brings the gates", after.nodes.some((n) => n.name === "Bale configured? · management") && after.nodes.length === 16);
  check("update keeps the SMTP credential and the node switched on", !!mail?.credentials?.smtp && !mail.disabled);
  check("updated workflow can be published", (await publishState(old.id)) === "allowed");

  // Without the browser-id header: 401, and the login cookie is cleared.
  const without = await page.evaluate(async (id) => {
    const r1 = await fetch(`/rest/workflows/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
    const r2 = await fetch(`/rest/workflows/${id}`, { headers: { "browser-id": localStorage.getItem("n8n-browserId") } });
    return [r1.status, r2.status];
  }, old.id);
  check("without browser-id: 401 and signed out", without[0] === 401 && without[1] === 401, `PATCH ${without[0]}, then GET ${without[1]}`);
} catch (err) {
  console.error("check error:", err.message);
  await page.screenshot({ path: join(work, "browser-error.png") });
  results.push(false);
} finally {
  await browser.close();
  try { execFileSync("docker", ["rm", "-f", "zarin-browser-check"], { stdio: "ignore" }); } catch {}
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
