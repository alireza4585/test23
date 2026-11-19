// End-to-end run of workflow 08 (F10 reviews by e-mail) on a real n8n, with a
// local GreenMail as the shared reviews mailbox and a local, seeded PocketBase.
// Nothing leaves the machine.
//
//   (cd pocketbase && npm install && ./scripts/get-pocketbase.sh)
//   cd n8n/test && npm install
//   N8N_IMAGE=n8nio/n8n:2.26.2 npm run e2e:reviews-mail     # needs Docker (GreenMail runs in Docker)
//
// The catch-all mailbox is simulated the way a real MTA delivers a forwarded
// notification: the envelope goes to the shared mailbox, the original To: stays
// the hotel's own address, and X-Original-To carries r-<token>@<domain>.
// Uses ports 5688 (n8n), 3025 (SMTP) and 3143 (IMAP).
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import nodemailer from "nodemailer";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const { startTestServer, SECRET, SUPERUSER } = await import(pathToFileURL(join(REPO, "pocketbase/scripts/test-server.mjs")));
const { ACCOUNTS, PASSWORD } = await import(pathToFileURL(join(REPO, "pocketbase/scripts/seed.mjs")));
const PocketBase = createRequire(join(REPO, "pocketbase/package.json"))("pocketbase/cjs");

const DOMAIN = "reviews.example.org";
const N8N_PORT = 5688;
const N8N = `http://127.0.0.1:${N8N_PORT}`;
const MAILBOX = { user: "reviews", password: `pw${randomBytes(6).toString("hex")}` };
const GREENMAIL = "zarin-greenmail-e2e";
const IMAGE = process.env.N8N_IMAGE;
const CONTAINER = "zarin-n8n-mail-e2e";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(500);
  }
  return null;
}

// --------------------------------------------------------------- GreenMail
try { execFileSync("docker", ["rm", "-f", GREENMAIL], { stdio: "ignore" }); } catch {}
execFileSync("docker", ["run", "-d", "--rm", "--name", GREENMAIL, "--network", "host",
  "-e", `GREENMAIL_OPTS=-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=127.0.0.1 -Dgreenmail.users=${MAILBOX.user}:${MAILBOX.password}@${DOMAIN} -Dgreenmail.verbose`,
  "greenmail/standalone:2.1.3"], { stdio: "pipe" });

// -------------------------------------------------------------- PocketBase
const pbServer = await startTestServer({ env: { ZH_REVIEWS_MAIL_DOMAIN: DOMAIN } });
const PB = pbServer.url;
const su = new PocketBase(PB);
su.autoCancellation(false);
await su.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
const hotel = await su.collection("hotels").getOne(pbServer.hotelId);
await su.collection("hotels").update(hotel.id, { settings: { ...hotel.settings, features: { guestReviews: true } } });
const gm = new PocketBase(PB);
gm.autoCancellation(false);
await gm.collection("users").authWithPassword(ACCOUNTS.find((a) => a[1] === "generalManager")[0], PASSWORD);
const { address } = await gm.send("/api/zarin/reviews/inbound-address", { method: "POST", body: {} });
check("the hotel's forwarding address is on the reviews domain", address.endsWith(`@${DOMAIN}`) && address.startsWith("r-"), address.replace(/r-\w+/, "r-…"));

// ------------------------------------------------------------------- n8n
const work = mkdtempSync(join(tmpdir(), "zarin-n8n-mail-e2e-"));
const n8nEnv = {
  N8N_USER_FOLDER: work, N8N_PORT: String(N8N_PORT), N8N_LISTEN_ADDRESS: "127.0.0.1", N8N_ENCRYPTION_KEY: "e2e-encryption-key",
  N8N_DIAGNOSTICS_ENABLED: "false", N8N_VERSION_NOTIFICATIONS_ENABLED: "false", N8N_TEMPLATES_ENABLED: "false", DB_SQLITE_POOL_SIZE: "2",
  NODE_FUNCTION_ALLOW_BUILTIN: "crypto", N8N_BLOCK_ENV_ACCESS_IN_NODE: "false", GENERIC_TIMEZONE: "Asia/Tehran",
  ZARIN_INTEGRATION_SECRET: SECRET, ZARIN_API_BASE: PB, ZARIN_REVIEWS_MAIL_DOMAIN: DOMAIN,
};
const env = { ...process.env, ...n8nEnv };
const n8nBin = join(HERE, "node_modules/.bin/n8n");
const n8nCommand = (args, name) => IMAGE
  ? ["docker", ["run", "--rm", "--network", "host", "--user", "root", "-v", `${work}:${work}`,
      ...(name ? ["--name", name] : []), ...Object.entries(n8nEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]), IMAGE, ...args]]
  : [n8nBin, args];
const n8n = (...args) => {
  const [cmd, argv] = n8nCommand(args);
  return execFileSync(cmd, argv, { env, stdio: "pipe", timeout: 300000 }).toString();
};
console.log(`PocketBase ${PB} · n8n ${IMAGE ?? "local package"} · logs in ${work}`);

writeFileSync(join(work, "creds.json"), JSON.stringify([
  { id: "imapE2E00000001", name: "Zarin reviews mailbox", type: "imap", data: { user: MAILBOX.user, password: MAILBOX.password, host: "127.0.0.1", port: 3143, secure: false, allowUnauthorizedCerts: true } },
]));
n8n("import:credentials", `--input=${join(work, "creds.json")}`);
const wf = JSON.parse(readFileSync(join(REPO, "n8n/workflows/08-reviews-email.json"), "utf8"));
wf.id = "zarinE2Ewf00008";
for (const n of wf.nodes) if (n.type === "n8n-nodes-base.emailReadImap") n.credentials = { imap: { id: "imapE2E00000001", name: "Zarin reviews mailbox" } };
mkdirSync(join(work, "wf"));
writeFileSync(join(work, "wf", "08.json"), JSON.stringify(wf));
n8n("import:workflow", "--separate", `--input=${join(work, "wf")}`);
n8n("publish:workflow", `--id=${wf.id}`);

const log = createWriteStream(join(work, "n8n.log"));
const proc = spawn(...n8nCommand(["start"], CONTAINER), { env, stdio: ["ignore", "pipe", "pipe"] });
proc.stdout.pipe(log);
proc.stderr.pipe(log);

const smtp = nodemailer.createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });
const forwarded = (over) => ({
  from: "Booking.com <noreply@booking.com>",
  to: "owner@hotel.example",
  envelope: { from: "owner@hotel.example", to: `${MAILBOX.user}@${DOMAIN}` },
  subject: "Fwd: A guest reviewed your property",
  text: "---------- Forwarded message ---------\nFrom: Booking.com <noreply@booking.com>\n\nScore 6/10\nThe breakfast was cold and the room was noisy at night.\nhttps://www.booking.com/reviews/e2e-mail-1.html\nUnsubscribe",
  messageId: `<${randomBytes(8).toString("hex")}@mail.example>`,
  headers: { "X-Original-To": address },
  ...over,
});
const emailReviews = () => su.collection("reviews").getFullList({ filter: su.filter("hotel = {:h} && channel = 'email'", { h: hotel.id }) });

try {
  check("n8n starts", !!(await until(async () => {
    try { return (await fetch(`${N8N}/healthz`)).ok; } catch { return false; }
  }, 180000)));
  await wait(5000);
  const first = forwarded();
  await smtp.sendMail(first);
  const got = await until(async () => (await emailReviews()).length >= 1 && (await emailReviews()));
  check("a forwarded notification becomes one review waiting for a person", !!got && got.length === 1 && got[0].status === "needsReview",
    got ? `${got[0].platform} · ${got[0].ratingRaw}/${got[0].scaleMax} · ${got[0].status}` : "no review after 90 s");
  if (got) {
    check("site, link and rating from the mail", got[0].platform === "booking" && got[0].url === "https://www.booking.com/reviews/e2e-mail-1.html" && got[0].ratingRaw === 6);
    check("no sender, recipient or forwarding header stored", !/noreply@booking|owner@hotel|Forwarded|Unsubscribe/.test(JSON.stringify(got[0])));
  }
  // The same mail again (a client re-sent it): one review.
  await smtp.sendMail({ ...first });
  // Mail to the mailbox without a hotel address: skipped by n8n.
  await smtp.sendMail(forwarded({ headers: {}, messageId: `<${randomBytes(8).toString("hex")}@mail.example>`, text: "Score 9/10 spam text for nobody" }));
  // A second, different review.
  await smtp.sendMail(forwarded({ messageId: `<${randomBytes(8).toString("hex")}@mail.example>`, text: "Score 9/10\nLovely staff and a quiet room, would come back." }));
  const two = await until(async () => (await emailReviews()).length >= 2 && (await emailReviews()), 60000);
  await wait(8000);
  const all = await emailReviews();
  check("each mail once; a mail without a hotel address is skipped", !!two && all.length === 2, `${all.length} e-mail reviews`);
} catch (err) {
  console.error("harness error:", err);
  results.push({ name: "harness", ok: false });
} finally {
  const exited = new Promise((r) => proc.once("exit", r));
  proc.kill();
  if (!(await Promise.race([exited.then(() => true), wait(20000).then(() => false)]))) proc.kill("SIGKILL");
  if (IMAGE) try { execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" }); } catch {}
  try { execFileSync("docker", ["rm", "-f", GREENMAIL], { stdio: "ignore" }); } catch {}
  await pbServer.stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
