// End-to-end run of the four Zarin workflows on a real n8n against a local,
// seeded PocketBase. Bale, Kavenegar and SMTP are replaced by local mocks,
// so nothing leaves the machine. Also re-runs scripts/import-workflows.mjs
// against the live instance to check that updates keep credentials.
//
//   (cd pocketbase && npm install && ./scripts/get-pocketbase.sh)
//   cd n8n/test && npm install
//   npm run e2e               # every channel configured
//   npm run e2e:no-channels   # no Bale / SMS / e-mail set up yet: runs must still succeed
//
// N8N_IMAGE=n8nio/n8n:2.26.2 runs n8n from that Docker image (host network)
// instead of the local n8n package, e.g. to match the version in production.
//
// E2E_SIGNING=scoped       n8n signs with a scoped key (ZARIN_KEY_ID / ZARIN_KEY_SECRET)
// E2E_SIGNING=scoped-only  … and PocketBase refuses the shared secret (ZH_ALLOW_SHARED_SECRET=false)
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
const { startTestServer, SECRET, SUPERUSER } = await import(pathToFileURL(join(REPO, "pocketbase/scripts/test-server.mjs")));
const SIGNING = process.env.E2E_SIGNING || "shared";
const PocketBase = createRequire(join(REPO, "pocketbase/package.json"))("pocketbase/cjs");

const CHANNELS = process.env.E2E_CHANNELS !== "none";
const N8N_PORT = 5688;
const MOCK_PORT = 5689;
const SMTP_PORT = 2526;
const N8N = `http://127.0.0.1:${N8N_PORT}`;
const WORKFLOWS = ["01-event-router", "02-daily-management-briefing", "03-maintenance-sla-escalation", "04-smart-meter-ingestion"];
const EMAIL_NODES = { "01-event-router": "Purchase request e-mail", "02-daily-management-briefing": "E-mail GM & owner" };

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
const pbServer = await startTestServer({
  webhookUrl: `${N8N}/webhook/zarin-events`,
  env: SIGNING === "scoped-only" ? { ZH_ALLOW_SHARED_SECRET: "false" } : {},
});
const PB = pbServer.url;
const su = new PocketBase(PB);
su.autoCancellation(false);
await su.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
// A scoped key for the test hotel, the way an operator creates one for n8n (npm run integration-key).
const scopedKey = SIGNING === "shared" ? null
  : await su.send("/api/zarin/admin/integration-keys", { method: "POST", body: { label: "n8n e2e", hotels: [pbServer.hotelId] } });

// ------------------------------------------------------------------- n8n
const work = mkdtempSync(join(tmpdir(), "zarin-n8n-e2e-"));
console.log(`channels: ${CHANNELS ? "all" : "none"} · signing: ${SIGNING} · PocketBase ${PB} · n8n ${N8N} · logs in ${work}`);
const channelEnv = {
  BALE_BOT_TOKEN: "bale-token", BALE_MANAGEMENT_CHAT_ID: "mgmt", BALE_MAINTENANCE_CHAT_ID: "mnt", BALE_ENERGY_CHAT_ID: "nrg",
  KAVENEGAR_API_KEY: "kave-key", ONCALL_MANAGER_MOBILE: "09120000001", MAINTENANCE_MANAGER_MOBILE: "09120000002",
  PROCUREMENT_EMAIL: "procurement@example.ir",
};
const n8nEnv = {
  N8N_USER_FOLDER: work, N8N_PORT: String(N8N_PORT), N8N_LISTEN_ADDRESS: "127.0.0.1",
  N8N_ENCRYPTION_KEY: "e2e-encryption-key", N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_VERSION_NOTIFICATIONS_ENABLED: "false", N8N_TEMPLATES_ENABLED: "false",
  WEBHOOK_URL: `${N8N}/`, DB_SQLITE_POOL_SIZE: "2",
  // The settings and variables docs/09-liara-runbook.md asks for:
  NODE_FUNCTION_ALLOW_BUILTIN: "crypto", N8N_BLOCK_ENV_ACCESS_IN_NODE: "false", GENERIC_TIMEZONE: "Asia/Tehran",
  ZARIN_INTEGRATION_SECRET: SECRET, ZARIN_API_BASE: PB, ZARIN_HOTEL_IDS: pbServer.hotelId,
  ...(scopedKey ? { ZARIN_KEY_ID: scopedKey.keyId, ZARIN_KEY_SECRET: scopedKey.secret } : {}),
  // Set on Liara before SMTP exists: the e-mail gate passes, the switched-off node no-ops.
  ZARIN_MAIL_FROM: "no-reply@example.ir", ZARIN_REPORT_RECIPIENTS: "gm@example.ir,owner@example.ir",
  ...(CHANNELS ? channelEnv : {}),
};
const env = { ...process.env, ...n8nEnv };
for (const k of Object.keys(channelEnv)) if (!CHANNELS) delete env[k];
const IMAGE = process.env.N8N_IMAGE;
const CONTAINER = "zarin-n8n-e2e";
const n8nBin = join(HERE, "node_modules/.bin/n8n");
// [command, args] for one n8n CLI call, local or in a throwaway container.
const n8nCommand = (args, name) => IMAGE
  ? ["docker", ["run", "--rm", "--network", "host", "--user", "root", "-v", `${work}:${work}`,
      ...(name ? ["--name", name] : []), ...Object.entries(n8nEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]), IMAGE, ...args]]
  : [n8nBin, args];
const n8n = (...args) => {
  const [cmd, argv] = n8nCommand(args);
  return execFileSync(cmd, argv, { env, stdio: "pipe", timeout: 300000 }).toString();
};
if (IMAGE) console.log(`n8n from image ${IMAGE}: ${n8n("--version").trim().split("\n").pop()}`);

writeFileSync(join(work, "creds.json"), JSON.stringify([
  { id: "smtpE2E00000001", name: "SMTP e2e", type: "smtp", data: { user: "", password: "", host: "127.0.0.1", port: SMTP_PORT, secure: false, disableStartTls: true } },
  { id: "hdrE2E000000001", name: "Meter key", type: "httpHeaderAuth", data: { name: "X-Meter-Key", value: "meter-secret" } },
]));
n8n("import:credentials", `--input=${join(work, "creds.json")}`);

// Test copies: mocked endpoints, the Header Auth credential (and, with
// channels, SMTP switched on the way the runbook describes), and the schedule
// node of 02/03 turned into a webhook of the same name so it can be run on
// demand inside the running instance (connections stay unchanged).
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
    if (n.type === "n8n-nodes-base.emailSend" && CHANNELS) {
      n.credentials = { smtp: { id: "smtpE2E00000001", name: "SMTP e2e" } };
      delete n.disabled;
    }
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
const proc = spawn(...n8nCommand(["start"], CONTAINER), { env, stdio: ["ignore", "pipe", "pipe"] });
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

// Owner + API key, for the execution log and the importer re-run.
const setup = await fetch(`${N8N}/rest/owner/setup`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "owner@e2e.local", firstName: "E2E", lastName: "Owner", password: "E2e-Password-123" }),
});
const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0];
const apiKey = (await (await fetch(`${N8N}/rest/api-keys`, {
  method: "POST", headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ label: "e2e", expiresAt: null, scopes: ["workflow:read", "workflow:list", "workflow:create", "workflow:update", "execution:list", "execution:read"] }),
})).json()).data?.rawApiKey ?? "";
const api = async (path) => (await fetch(`${N8N}/api/v1${path}`, { headers: { "X-N8N-API-KEY": apiKey } })).json();
const executions = async (file, status) => (await api(`/executions?workflowId=${ids[file]}&status=${status}&limit=250`)).data ?? [];
const settled = () => until(async () => (await api("/executions?status=running&limit=1")).data?.length === 0, 60000);

const pbLogin = async (nid) => {
  const pb = new PocketBase(PB);
  pb.autoCancellation(false);
  await pb.collection("users").authWithPassword(nid, "Zarin@2026");
  return pb;
};
const flush = async () => {
  if (SIGNING === "scoped-only") {
    // The shared secret is refused: deliver through the outbox cron itself (superuser API).
    for (let i = 0; i < 20; i++) {
      await su.send("/api/crons/zarin_outbox", { method: "POST" });
      const pending = await su.collection("outbox").getList(1, 1, { filter: "deliveredAt = '' && attempts < 8" });
      if (pending.totalItems === 0) return;
      await wait(500);
    }
    return;
  }
  for (let delivered = 1; delivered > 0;) {
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(`${PB}/v1/outbox/flush`, {
      method: "POST", body: "",
      headers: { "x-zarin-timestamp": String(ts), "x-zarin-signature": createHmac("sha256", SECRET).update(`${ts}.`).digest("hex") },
    });
    delivered = (await res.json()).delivered;
  }
};
const run = async (n) => (await fetch(`${N8N}/webhook/e2e-0${n}`, { method: "POST" })).status;
const toBale = (chat) => http.filter((r) => r.url.startsWith("/bale/botbale-token/sendMessage") && r.body?.chat_id === chat);
const sms = () => http.filter((r) => r.url.startsWith("/kavenegar/v1/kave-key/sms/send.json"));

try {
  // ---------------------------------------------------- 01 event router
  await flush(); // seed-time events (energy spikes, critical tickets)
  const hk = await pbLogin("0102345678");
  await hk.collection("maintenanceTickets").create({
    hotel: pbServer.hotelId, title: "E2E: شوفاژ لابی کار نمی‌کند", category: "hvac", priority: "critical", area: "لابی",
  });
  await flush();
  const inv = await pbLogin("0078912342");
  const item = await inv.collection("inventoryItems").getFirstListItem('sku = "LN-SH02"');
  await inv.send(`/api/zarin/inventory/${item.id}/movements`, { method: "POST", body: { type: "issue", delta: -200 } });
  await flush();
  if (CHANNELS) {
    check("01 alert → Bale management group", !!(await until(() => toBale("mgmt").length > 0)));
    check("01 critical ticket → Bale maintenance group", !!(await until(() => toBale("mnt").some((m) => String(m.body.text).includes("E2E")))));
    check("01 critical alert → SMS on-call manager", !!(await until(() => sms().some((r) => JSON.stringify(r).includes("09120000001")))));
    check("01 energy anomaly → Bale energy group", !!(await until(() => toBale("nrg").length > 0)));
    const procMail = await until(() => mails.find((m) => m.to.includes("procurement@example.ir")));
    check("01 low stock → purchase request e-mail", !!procMail?.raw.includes("LN-SH02"));
  } else {
    check("01 runs succeed with no channel set up", !!(await until(async () => (await executions(WORKFLOWS[0], "success")).length >= 3)));
  }

  // ------------------- AI phase 1: action events (01) and per-role briefings (02)
  const hotelBefore = await su.collection("hotels").getOne(pbServer.hotelId);
  await su.collection("hotels").update(pbServer.hotelId, {
    settings: { ...hotelBefore.settings, features: { ...(hotelBefore.settings?.features || {}), morningBriefing: true, recommendationLoop: true } },
  });
  await su.send(`/api/zarin/admin/hotels/${pbServer.hotelId}/analytics`, { method: "POST", body: { insights: true, briefing: true } });
  const stored = await su.collection("briefings").getFullList({ filter: su.filter("hotel = {:h}", { h: pbServer.hotelId }) });
  const gmBriefing = stored.find((b) => b.role === "generalManager");
  check("P1 briefings stored per role (rule-based)", !!gmBriefing?.items.length && stored.every((b) => b.source === "rules"), `${stored.length} roles`);
  await flush(); // action.proposed of high-priority actions, briefing.ready (not routed: 02 sends at 07:15)
  const signedEvent = async (body) => {
    const raw = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000);
    await fetch(`${N8N}/webhook/zarin-events`, {
      method: "POST", body: raw,
      headers: { "content-type": "application/json", "x-zarin-timestamp": String(ts), "x-zarin-signature": createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex") },
    });
  };
  const runsBeforeActions = (await executions(WORKFLOWS[0], "success")).length;
  const actionEvent = (type, department, actionId) => ({
    id: `${type}:${pbServer.hotelId}:${actionId}`, type, hotelId: pbServer.hotelId, occurredAt: new Date().toISOString(),
    data: { actionId, type: "createTicket", department, priority: "high", roles: ["generalManager"] },
  });
  await signedEvent(actionEvent("action.proposed", "energy", "e2eaction00001"));
  await signedEvent(actionEvent("action.reminder", "housekeeping", "e2eaction00002"));
  if (CHANNELS) {
    check("01 action.proposed → Bale group of its department", !!(await until(() => toBale("nrg").some((m) => String(m.body.text).includes("e2eaction00001")))));
    check("01 action.reminder (housekeeping) → Bale management group", !!(await until(() => toBale("mgmt").some((m) => String(m.body.text).includes("e2eaction00002") && String(m.body.text).includes("یادآوری")))));
  } else {
    check("01 action events succeed with no channel set up", !!(await until(async () => (await executions(WORKFLOWS[0], "success")).length >= runsBeforeActions + 2)));
  }

  // ------------------------------------------------- 02 morning briefing
  const before02 = http.length;
  await run(2);
  if (CHANNELS) {
    const briefing = await until(() => mails.find((m) => m.to.includes("gm@example.ir")));
    // Mostly-Persian bodies are sent base64-encoded, the rest quoted-printable.
    const body = (raw) => {
      const split = raw.search(/\r?\n\r?\n/);
      const text = raw.slice(split).trim();
      return /Content-Transfer-Encoding: base64/i.test(raw.slice(0, split)) ? Buffer.from(text, "base64").toString("utf8") : text;
    };
    check("02 briefing e-mail to GM & owner (RTL)", !!briefing && /dir=(3D)?"rtl"/.test(body(briefing.raw)));
    check("02 e-mail carries the GM's stored briefing", !!briefing && !!gmBriefing && body(briefing.raw).includes(gmBriefing.text.split("\n")[1].slice(0, 20)));
    check("02 briefing → Bale management group", !!(await until(() => http.slice(before02).some((r) => r.body?.chat_id === "mgmt"))));
    check("02 management group gets the GM's stored briefing", !!(await until(() => http.slice(before02).some((r) => r.body?.chat_id === "mgmt" && r.body.text === gmBriefing?.text))));
    // Department briefings with items and no finance go to their own group, word for word.
    const groupOf = { energyManager: "nrg", maintenanceManager: "mnt" };
    const due = stored.filter((b) => groupOf[b.role] && b.items.length && !b.containsFinance);
    check("02 department briefings → their Bale groups", due.length > 0 &&
      !!(await until(() => due.every((b) => http.slice(before02).some((r) => r.body?.chat_id === groupOf[b.role] && r.body.text === b.text)))),
      due.map((b) => b.role).join(", "));
  } else {
    check("02 run succeeds with no channel set up", !!(await until(async () => (await executions(WORKFLOWS[1], "success")).length > 0)));
  }

  await settled();
  await su.collection("hotels").update(pbServer.hotelId, { settings: hotelBefore.settings });

  // ---------------------------------------------- 03 SLA escalation
  const before03 = http.length;
  await run(3);
  const mm = await pbLogin("0056789122");
  const escalated = await until(async () => (await mm.collection("inbox").getFullList({ sort: "-created" })).find((n) => /خارج از SLA/.test(n.title)));
  check("03 overdue tickets → in-app notification to managers", !!escalated, escalated?.title ?? "");
  if (CHANNELS) {
    check("03 critical overdue → SMS maintenance manager", !!(await until(() => http.slice(before03).some((r) => JSON.stringify(r).includes("09120000002")))));
  } else {
    check("03 run succeeds with no channel set up", !!(await until(async () => (await executions(WORKFLOWS[2], "success")).length > 0)));
  }
  // A second run with the same late tickets inside 4 hours: nothing new.
  await settled();
  const slaInbox = async () => (await mm.collection("inbox").getFullList()).filter((n) => /خارج از SLA/.test(n.title)).length;
  const slaSms = () => http.filter((r) => JSON.stringify(r).includes("09120000002")).length;
  const [inboxBefore, smsBefore, runsBefore] = [await slaInbox(), slaSms(), (await executions(WORKFLOWS[2], "success")).length];
  await run(3);
  await until(async () => (await executions(WORKFLOWS[2], "success")).length > runsBefore);
  await settled();
  check("03 repeat run: no duplicate notification or SMS", (await slaInbox()) === inboxBefore && slaSms() === smsBefore,
    `${await slaInbox()} vs ${inboxBefore} notifications, ${slaSms()} vs ${smsBefore} SMS`);

  // ---------------------------------------------- 04 smart-meter ingestion
  const meterBody = JSON.stringify({ readings: [{ hotelId: pbServer.hotelId, meterId: "MTR-E1", type: "electricity", day: "2026-03-01", value: 2777.5 }] });
  const noKey = await fetch(`${N8N}/webhook/meter-readings`, { method: "POST", headers: { "content-type": "application/json" }, body: meterBody });
  check("04 webhook rejects requests without the meter key", noKey.status === 403, `HTTP ${noKey.status}`);
  await fetch(`${N8N}/webhook/meter-readings`, { method: "POST", headers: { "content-type": "application/json", "X-Meter-Key": "meter-secret" }, body: meterBody });
  const energy = await pbLogin("0045678911");
  const reading = await until(async () => (await energy.collection("energyReadings").getList(1, 1, { filter: 'day = "2026-03-01" && type = "electricity"' })).items[0]);
  check("04 meter reading stored in PocketBase", reading?.consumption === 2777.5 && reading?.source === "smartMeter");

  // ------------- 01 signed event of a hotel not in ZARIN_HOTEL_IDS: dropped
  const runs01 = (await executions(WORKFLOWS[0], "success")).length;
  const other = JSON.stringify({ type: "alert.raised", hotelId: "otherhotel00001", data: { severity: "critical", title: "OTHER-HOTEL" } });
  const ots = Math.floor(Date.now() / 1000);
  await fetch(`${N8N}/webhook/zarin-events`, {
    method: "POST", body: other,
    headers: { "content-type": "application/json", "x-zarin-timestamp": String(ots), "x-zarin-signature": createHmac("sha256", SECRET).update(`${ots}.${other}`).digest("hex") },
  });
  check("01 events of other hotels are dropped", !!(await until(async () => (await executions(WORKFLOWS[0], "success")).length > runs01)) &&
    !http.some((r) => JSON.stringify(r.body).includes("OTHER-HOTEL")));

  // --------------------------------------------- channels and run log
  await settled();
  await wait(1000);
  const sends = http.filter((r) => r.url.startsWith("/bale/") || r.url.startsWith("/kavenegar/")).map((r) => JSON.stringify(r));
  if (CHANNELS) check("no duplicate Bale / SMS sends", new Set(sends).size === sends.length, `${sends.length} sends`);
  else check("nothing sent to Bale / SMS / e-mail", sends.length === 0 && mails.length === 0, `${sends.length} sends, ${mails.length} mails`);
  const failed = (await Promise.all(WORKFLOWS.map((f) => executions(f, "error")))).flat();
  check("no failed executions", failed.length === 0, failed.map((e) => `${e.workflowId}#${e.id}`).join(" "));
  if (scopedKey) {
    const key = await su.collection("integrationKeys").getFirstListItem(su.filter("keyId = {:k}", { k: scopedKey.keyId }));
    check("n8n signed with the scoped key (v2)", !!key.lastUsedAt);
  }
  if (SIGNING === "scoped-only") {
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(`${PB}/v1/hotels/${pbServer.hotelId}/summary`, {
      headers: { "x-zarin-timestamp": String(ts), "x-zarin-signature": createHmac("sha256", SECRET).update(`${ts}.`).digest("hex") },
    });
    check("shared-secret requests are refused", res.status === 401, `HTTP ${res.status}`);
  }

  // forged event: rejected by the signature check (this run fails on purpose)
  await fetch(`${N8N}/webhook/zarin-events`, {
    method: "POST", headers: { "content-type": "application/json", "x-zarin-timestamp": String(Math.floor(Date.now() / 1000)), "x-zarin-signature": "00" },
    body: JSON.stringify({ type: "alert.raised", hotelId: pbServer.hotelId, data: { severity: "critical", title: "FORGED" } }),
  });
  check("01 forged event is rejected", !!(await until(async () => (await executions(WORKFLOWS[0], "error")).length === 1)) &&
    !http.some((r) => JSON.stringify(r.body).includes("FORGED")));

  // ------- importer re-run: updates in place, keeps credentials and state
  let importOut = "";
  try {
    importOut = execFileSync("node", [join(REPO, "n8n/scripts/import-workflows.mjs")], {
      env: { ...process.env, N8N_URL: N8N, N8N_API_KEY: apiKey }, stdio: "pipe",
    }).toString();
  } catch (e) { importOut = `${e.stdout}${e.stderr}`; }
  const [w01, w02, w04] = await Promise.all([0, 1, 3].map((i) => api(`/workflows/${ids[WORKFLOWS[i]]}`)));
  const node = (w, name) => w.nodes?.find((n) => n.name === name) ?? {};
  const mailNodes = [node(w01, EMAIL_NODES[WORKFLOWS[0]]), node(w02, EMAIL_NODES[WORKFLOWS[1]])];
  check("importer updates all four in place", (importOut.match(/^updated/gm) ?? []).length === 4, importOut.trim().split("\n").pop());
  check("importer keeps the Header Auth credential", !!node(w04, "Meter gateway webhook").credentials?.httpHeaderAuth);
  if (CHANNELS) check("importer keeps SMTP credentials and switched-on e-mail nodes", mailNodes.every((n) => n.credentials?.smtp && !n.disabled));
  else check("e-mail nodes stay switched off until SMTP is set", mailNodes.every((n) => n.disabled === true && !n.credentials));
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
  if (IMAGE) try { execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" }); } catch {}
  await pbServer.stop();
  mock.close();
  smtp.close();
  writeFileSync(join(work, "http.json"), JSON.stringify(http, null, 1));
  writeFileSync(join(work, "mails.json"), JSON.stringify(mails, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed (logs: ${work})`);
  process.exit(failed ? 1 : 0);
}
