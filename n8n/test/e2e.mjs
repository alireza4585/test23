// End-to-end run of the four Zarin workflows on a real n8n against a local,
// seeded PocketBase. Bale, Kavenegar and SMTP are replaced by local mocks,
// so nothing leaves the machine. Also re-runs scripts/import-workflows.mjs
// against the live instance to check that updates keep credentials.
//
//   (cd pocketbase && npm install && ./scripts/get-pocketbase.sh)
//   cd n8n/test && npm install && npm run e2e
//
// Uses ports 5688 (n8n), 5689 (HTTP mocks) and 2526 (SMTP).
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SMTPServer } from "smtp-server";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const { startTestServer, SECRET } = await import(pathToFileURL(join(REPO, "pocketbase/scripts/test-server.mjs")));
const PocketBase = createRequire(join(REPO, "pocketbase/package.json"))("pocketbase/cjs");

const N8N_PORT = 5688;
const MOCK_PORT = 5689;
const SMTP_PORT = 2526;
const N8N = `http://127.0.0.1:${N8N_PORT}`;
const WORKFLOWS = ["01-event-router", "02-daily-management-briefing", "03-maintenance-sla-escalation", "04-smart-meter-ingestion"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(300);
  }
  return null;
}

try {
  await fetch(`${N8N}/healthz`);
  console.error(`port ${N8N_PORT} is busy (another n8n?) — stop it first`);
  process.exit(2);
} catch {}

// ------------------------------------------------------------------ mocks
const http = [];
const mock = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = raw;
    try { body = JSON.parse(raw); } catch {}
    http.push({ method: req.method, url: req.url, body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: {}, return: { status: 200 } }));
  });
}).listen(MOCK_PORT, "127.0.0.1");
const mails = [];
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ["STARTTLS"],
  onData(stream, session, cb) {
    let raw = "";
    stream.on("data", (c) => (raw += c));
    stream.on("end", () => { mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); cb(); });
  },
});
smtp.listen(SMTP_PORT, "127.0.0.1");

// -------------------------------------------------------------- PocketBase
const pbServer = await startTestServer({ webhookUrl: `${N8N}/webhook/zarin-events` });
const PB = pbServer.url;

// ------------------------------------------------------------------- n8n
const work = mkdtempSync(join(tmpdir(), "zarin-n8n-e2e-"));
console.log(`PocketBase ${PB} · n8n ${N8N} · logs in ${work}`);
const env = {
  ...process.env,
  N8N_USER_FOLDER: work, N8N_PORT: String(N8N_PORT), N8N_LISTEN_ADDRESS: "127.0.0.1",
  N8N_ENCRYPTION_KEY: "e2e-encryption-key", N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_VERSION_NOTIFICATIONS_ENABLED: "false", N8N_TEMPLATES_ENABLED: "false",
  WEBHOOK_URL: `${N8N}/`, DB_SQLITE_POOL_SIZE: "2",
  // The settings and variables docs/09-liara-runbook.md asks for:
  NODE_FUNCTION_ALLOW_BUILTIN: "crypto", N8N_BLOCK_ENV_ACCESS_IN_NODE: "false", GENERIC_TIMEZONE: "Asia/Tehran",
  ZARIN_INTEGRATION_SECRET: SECRET, ZARIN_API_BASE: PB, ZARIN_HOTEL_IDS: pbServer.hotelId,
  BALE_BOT_TOKEN: "bale-token", BALE_MANAGEMENT_CHAT_ID: "mgmt", BALE_MAINTENANCE_CHAT_ID: "mnt", BALE_ENERGY_CHAT_ID: "nrg",
  KAVENEGAR_API_KEY: "kave-key", ONCALL_MANAGER_MOBILE: "09120000001", MAINTENANCE_MANAGER_MOBILE: "09120000002",
  PROCUREMENT_EMAIL: "procurement@example.ir", ZARIN_MAIL_FROM: "no-reply@example.ir",
  ZARIN_REPORT_RECIPIENTS: "gm@example.ir,owner@example.ir",
};
const n8nBin = join(HERE, "node_modules/.bin/n8n");
const n8n = (...args) => execFileSync(n8nBin, args, { env, stdio: "pipe", timeout: 300000 }).toString();

writeFileSync(join(work, "creds.json"), JSON.stringify([
  { id: "smtpE2E00000001", name: "SMTP e2e", type: "smtp", data: { user: "", password: "", host: "127.0.0.1", port: SMTP_PORT, secure: false, disableStartTls: true } },
  { id: "hdrE2E000000001", name: "Meter key", type: "httpHeaderAuth", data: { name: "X-Meter-Key", value: "meter-secret" } },
]));
n8n("import:credentials", `--input=${join(work, "creds.json")}`);

// Test copies: mocked endpoints, credentials attached, and the schedule node
// of 02/03 turned into a webhook of the same name so it can be run on demand
// inside the running instance (connections stay unchanged).
const wfDir = join(work, "wf");
mkdirSync(wfDir);
const ids = {};
for (const [i, file] of WORKFLOWS.entries()) {
  const text = readFileSync(join(REPO, `n8n/workflows/${file}.json`), "utf8")
    .replaceAll("https://tapi.bale.ai", `http://127.0.0.1:${MOCK_PORT}/bale`)
    .replaceAll("https://api.kavenegar.com", `http://127.0.0.1:${MOCK_PORT}/kavenegar`);
  const w = JSON.parse(text);
  w.id = `zarinE2Ewf0000${i + 1}`;
  ids[file] = w.id;
  for (const n of w.nodes) {
    if (n.type === "n8n-nodes-base.emailSend") n.credentials = { smtp: { id: "smtpE2E00000001", name: "SMTP e2e" } };
    if (n.parameters?.authentication === "headerAuth") n.credentials = { httpHeaderAuth: { id: "hdrE2E000000001", name: "Meter key" } };
    if (n.type === "n8n-nodes-base.scheduleTrigger") {
      Object.assign(n, {
        type: "n8n-nodes-base.webhook", typeVersion: 2, webhookId: `e2e-0${i + 1}`,
        parameters: { httpMethod: "POST", path: `e2e-0${i + 1}`, responseMode: "onReceived", options: {} },
      });
    }
  }
  writeFileSync(join(wfDir, `${file}.json`), JSON.stringify(w));
}
n8n("import:workflow", "--separate", `--input=${wfDir}`);
for (const id of Object.values(ids)) n8n("publish:workflow", `--id=${id}`);

const log = createWriteStream(join(work, "n8n.log"));
const proc = spawn(n8nBin, ["start"], { env, stdio: ["ignore", "pipe", "pipe"] });
proc.stdout.pipe(log);
proc.stderr.pipe(log);
check("n8n starts", !!(await until(async () => {
  try { return (await fetch(`${N8N}/healthz`)).ok; } catch { return false; }
}, 180000)));
// /healthz answers before production webhooks are registered: wait until the
// meter webhook rejects unauthenticated calls (403 instead of 404).
check("production webhooks registered", !!(await until(async () => {
  try { return (await fetch(`${N8N}/webhook/meter-readings`, { method: "POST" })).status === 403; } catch { return false; }
}, 120000)));
await wait(2000);

const pbLogin = async (nid) => {
  const pb = new PocketBase(PB);
  pb.autoCancellation(false);
  await pb.collection("users").authWithPassword(nid, "Zarin@2026");
  return pb;
};
const flush = async () => {
  for (let delivered = 1; delivered > 0;) {
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(`${PB}/v1/outbox/flush`, {
      method: "POST", body: "",
      headers: { "x-zarin-timestamp": String(ts), "x-zarin-signature": createHmac("sha256", SECRET).update(`${ts}.`).digest("hex") },
    });
    delivered = (await res.json()).delivered;
  }
};

try {
  // ---------------------------------------------------- 01 event router
  await flush(); // seed-time events (energy spikes, critical tickets)
  const hk = await pbLogin("0102345678");
  await hk.collection("maintenanceTickets").create({
    hotel: pbServer.hotelId, title: "E2E: شوفاژ لابی کار نمی‌کند", category: "hvac", priority: "critical", area: "لابی",
  });
  await flush();
  const toBale = (chat) => http.filter((r) => r.url.startsWith("/bale/botbale-token/sendMessage") && r.body?.chat_id === chat);
  const sms = () => http.filter((r) => r.url.startsWith("/kavenegar/v1/kave-key/sms/send.json"));
  check("01 alert → Bale management group", !!(await until(() => toBale("mgmt").length > 0)));
  check("01 critical ticket → Bale maintenance group", !!(await until(() => toBale("mnt").some((m) => String(m.body.text).includes("E2E")))));
  check("01 critical alert → SMS on-call manager", !!(await until(() => sms().some((r) => JSON.stringify(r).includes("09120000001")))));
  check("01 energy anomaly → Bale energy group", !!(await until(() => toBale("nrg").length > 0)));

  const inv = await pbLogin("0078912342");
  const item = await inv.collection("inventoryItems").getFirstListItem('sku = "LN-SH02"');
  await inv.send(`/api/zarin/inventory/${item.id}/movements`, { method: "POST", body: { type: "issue", delta: -200 } });
  await flush();
  const procMail = await until(() => mails.find((m) => m.to.includes("procurement@example.ir")));
  check("01 low stock → purchase request e-mail", !!procMail?.raw.includes("LN-SH02"));

  await fetch(`${N8N}/webhook/zarin-events`, {
    method: "POST", headers: { "content-type": "application/json", "x-zarin-timestamp": String(Math.floor(Date.now() / 1000)), "x-zarin-signature": "00" },
    body: JSON.stringify({ type: "alert.raised", hotelId: pbServer.hotelId, data: { severity: "critical", title: "FORGED" } }),
  });
  await wait(2500);
  check("01 forged event does not reach Bale", !http.some((r) => JSON.stringify(r.body).includes("FORGED")));

  // ------------------------------------------------- 02 morning briefing
  const run = async (n) => (await fetch(`${N8N}/webhook/e2e-0${n}`, { method: "POST" })).status;
  const before02 = http.length;
  await run(2);
  const briefing = await until(() => mails.find((m) => m.to.includes("gm@example.ir")));
  check("02 briefing e-mail to GM & owner (RTL)", !!briefing && /dir=(3D)?"rtl"/.test(briefing.raw));
  check("02 briefing → Bale management group", !!(await until(() => http.slice(before02).some((r) => r.body?.chat_id === "mgmt"))));

  // ---------------------------------------------- 03 SLA escalation
  const before03 = http.length;
  await run(3);
  const mm = await pbLogin("0056789122");
  const escalated = await until(async () => (await mm.collection("inbox").getFullList({ sort: "-created" })).find((n) => /خارج از SLA/.test(n.title)));
  check("03 overdue tickets → in-app notification to managers", !!escalated, escalated?.title ?? "");
  check("03 critical overdue → SMS maintenance manager", !!(await until(() => http.slice(before03).some((r) => JSON.stringify(r).includes("09120000002")))));

  // ---------------------------------------------- 04 smart-meter ingestion
  const meterBody = JSON.stringify({ readings: [{ hotelId: pbServer.hotelId, meterId: "MTR-E1", type: "electricity", day: "2026-03-01", value: 2777.5 }] });
  const noKey = await fetch(`${N8N}/webhook/meter-readings`, { method: "POST", headers: { "content-type": "application/json" }, body: meterBody });
  check("04 webhook rejects requests without the meter key", noKey.status === 403, `HTTP ${noKey.status}`);
  await fetch(`${N8N}/webhook/meter-readings`, { method: "POST", headers: { "content-type": "application/json", "X-Meter-Key": "meter-secret" }, body: meterBody });
  const energy = await pbLogin("0045678911");
  const reading = await until(async () => (await energy.collection("energyReadings").getList(1, 1, { filter: 'day = "2026-03-01" && type = "electricity"' })).items[0]);
  check("04 meter reading stored in PocketBase", reading?.consumption === 2777.5 && reading?.source === "smartMeter");

  // ----------------------------- each event reached the channels once
  const sends = http.filter((r) => r.url.startsWith("/bale/") || r.url.startsWith("/kavenegar/")).map((r) => JSON.stringify(r));
  check("no duplicate Bale / SMS sends", new Set(sends).size === sends.length, `${sends.length} sends`);

  // ------------- importer re-run: updates in place, keeps credentials
  const rest = `${N8N}/rest`;
  const setup = await fetch(`${rest}/owner/setup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@e2e.local", firstName: "E2E", lastName: "Owner", password: "E2e-Password-123" }),
  });
  const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0];
  const apiKey = (await (await fetch(`${rest}/api-keys`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ label: "e2e", expiresAt: null, scopes: ["workflow:read", "workflow:list", "workflow:create", "workflow:update"] }),
  })).json()).data?.rawApiKey ?? "";
  let importOut = "";
  try {
    importOut = execFileSync("node", [join(REPO, "n8n/scripts/import-workflows.mjs")], {
      env: { ...process.env, N8N_URL: N8N, N8N_API_KEY: apiKey }, stdio: "pipe",
    }).toString();
  } catch (e) { importOut = `${e.stdout}${e.stderr}`; }
  const get = async (file) => (await fetch(`${N8N}/api/v1/workflows/${ids[file]}`, { headers: { "X-N8N-API-KEY": apiKey } })).json();
  const [w01, w02, w04] = await Promise.all([get(WORKFLOWS[0]), get(WORKFLOWS[1]), get(WORKFLOWS[3])]);
  const cred = (w, node) => w.nodes?.find((n) => n.name === node)?.credentials ?? {};
  check("importer updates all four in place", (importOut.match(/^updated/gm) ?? []).length === 4, importOut.trim().split("\n").pop());
  check("importer keeps SMTP / Header Auth credentials",
    !!cred(w01, "Purchase request e-mail").smtp && !!cred(w02, "E-mail GM & owner").smtp && !!cred(w04, "Meter gateway webhook").httpHeaderAuth);
  check("active workflows stay active after update", w01.active === true && w04.active === true);
  const again = await fetch(`${N8N}/webhook/meter-readings`, { method: "POST", headers: { "content-type": "application/json", "X-Meter-Key": "meter-secret" }, body: meterBody });
  check("04 webhook still answers after update", again.status === 200, `HTTP ${again.status}`);
} catch (err) {
  console.error("harness error:", err);
  results.push({ name: "harness", ok: false });
} finally {
  const exited = new Promise((r) => proc.once("exit", r));
  proc.kill();
  if (!(await Promise.race([exited.then(() => true), wait(20000).then(() => false)]))) proc.kill("SIGKILL");
  await pbServer.stop();
  mock.close();
  smtp.close();
  writeFileSync(join(work, "http.json"), JSON.stringify(http, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed (logs: ${work})`);
  process.exit(failed ? 1 : 0);
}
