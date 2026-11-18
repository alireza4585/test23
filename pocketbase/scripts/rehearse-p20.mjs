// Rehearses deploying P2.0 (and later stages) over a database in the
// production state, and checks that the APK already in use keeps working.
// Local only: it starts throw-away PocketBase servers and never contacts any
// other host.
//
//   node scripts/rehearse-p20.mjs --prod <pocketbase dir at the deployed commit> \
//     --stage p20=<pocketbase dir> [--stage head=<dir>] [--stage control=<the deployed dir>] \
//     [--after "<command run against each stage, ZH_PB_TEST_URL set>"] [--out report.json]
//
// Each directory holds pb_hooks/, pb_migrations/, scripts/ and bin/pocketbase.
//
// 1. A server from --prod is seeded (the demo hotel stands in for the real
//    hotel) and a second, trial hotel is built next to it: the demo hotel's
//    records cloned through the admin importer, revenue, 365 days of weather,
//    the phase 1 flags, and the nightly analytics. Every role gets its own
//    single-hotel account in the trial hotel; two accounts belong to both
//    hotels (one with a primary hotel, one without).
// 2. Snapshot: for every account, the profile (/api/zarin/me) and the ids it
//    can list in every collection.
// 3. For every stage: the data directory is copied, the stage's code serves it
//    (pending migrations run at start), the snapshot is taken again and
//    compared, --after runs, then the stage's migrations are reverted
//    (migrate down) and the deployed code serves it again: the snapshot must
//    match the first one.
//
// "App view" is what the APK of the deployed commit shows: the records of the
// hotel it uses (primaryHotel, else the first membership). For single-hotel
// accounts everything must be identical; for two-hotel accounts the app view
// must be identical and the API may show less (only the active hotel).
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, createWriteStream, existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const stages = argv.flatMap((a, i) => (a === "--stage" ? [argv[i + 1]] : [])).map((s) => { const [name, dir] = s.split("="); return { name, dir: resolve(dir) }; });
const PROD = opt("prod") && resolve(opt("prod"));
if (!PROD || !stages.length) {
  console.error("usage: node scripts/rehearse-p20.mjs --prod <dir> --stage name=<dir> [--stage …] [--after cmd] [--out file]");
  process.exit(2);
}
const PocketBase = createRequire(join(PROD, "package.json"))("pocketbase/cjs");
const { startTestServer, SUPERUSER, SECRET } = await import(pathToFileURL(join(PROD, "scripts/test-server.mjs")));
const { ACCOUNTS, PASSWORD } = await import(pathToFileURL(join(PROD, "scripts/seed.mjs")));
const IMPORT_ORDER = ["rooms", "staff", "shifts", "tasks", "maintenanceTickets", "ticketEvents", "energyReadings", "dailyOperations", "inventoryItems", "inventoryMovements", "weatherDaily"];
const SKIP = new Set(["id", "hotel", "created", "updated", "collectionId", "collectionName", "expand"]);
const log = (...a) => console.log(...a);

/** A checksum-valid synthetic national ID (never written anywhere). */
function nationalId(nine) {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(nine[i]) * (10 - i);
  const r = sum % 11;
  return `${nine}${r < 2 ? r : 11 - r}`;
}
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

async function serve(code, dir) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const out = createWriteStream(join(dir, `serve-${Date.now()}.log`));
  const proc = spawn(join(code, "bin/pocketbase"), ["serve", `--http=127.0.0.1:${port}`, "--automigrate=false", "--dir", dir, "--hooksDir", join(code, "pb_hooks"), "--migrationsDir", join(code, "pb_migrations")], {
    env: { ...process.env, ZH_INTEGRATION_SECRET: SECRET, ZH_AI_PROVIDER: "none", ZH_N8N_WEBHOOK_URL: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.pipe(out);
  proc.stderr.pipe(out);
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch {}
    if (i > 300) throw new Error(`server did not start (${dir})`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, stop: () => new Promise((r) => { proc.once("exit", r); proc.kill(); }) };
}

async function superuser(url) {
  const su = new PocketBase(url);
  su.autoCancellation(false);
  await su.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
  return su;
}

// ------------------------------------------------------ production state
async function buildProductionState(url, seedHotel) {
  const su = await superuser(url);
  const seedSettings = (await su.collection("hotels").getOne(seedHotel)).settings || {};
  const trial = await su.collection("hotels").create({
    name: "Rehearsal trial", city: "Tehran", stars: 5, roomCount: 40, status: "trial",
    settings: { ...seedSettings, features: { energyBaseline: true, recommendationLoop: true, morningBriefing: true } },
  });
  const password = `Rh-${randomBytes(9).toString("hex")}-a1`;
  const accounts = ACCOUNTS.map(([nid, role]) => ({ label: `real:${role}:${nid.slice(-2)}`, nid, password: PASSWORD, hotel: seedHotel, role }));
  // One trial account per demo account (not superAdmin), mapped for the cloned relations.
  const base = 300000000 + (Date.now() % 100000) * 1000;
  const userMap = new Map();
  let k = 0;
  const seedUsers = await su.collection("users").getFullList({ filter: `hotels.id ?= "${seedHotel}"` });
  for (const u of seedUsers.filter((x) => x.role !== "superAdmin")) {
    const nid = nationalId(String(base + k++));
    const rec = await su.collection("users").create({
      nationalId: nid, fullName: `آزمون ${u.role}`, role: u.role, hotels: [trial.id], primaryHotel: trial.id, status: "active", password, passwordConfirm: password,
    });
    userMap.set(u.id, rec.id);
    accounts.push({ label: `trial:${u.role}:${k}`, nid, password, hotel: trial.id, role: u.role });
  }
  // Two-hotel accounts: with a primary hotel (the real one), and without (first membership: trial).
  for (const [label, hotels, primary] of [["both:gm:primaryReal", [seedHotel, trial.id], seedHotel], ["both:gm:noPrimary", [trial.id, seedHotel], ""]]) {
    const nid = nationalId(String(base + k++));
    await su.collection("users").create({ nationalId: nid, fullName: `آزمون ${label}`, role: "generalManager", hotels, primaryHotel: primary, status: "active", password, passwordConfirm: password });
    accounts.push({ label, nid, password, hotel: primary || hotels[0], role: "generalManager", twoHotels: true });
  }

  // Clone the demo hotel's records into the trial hotel (the importer writes quietly).
  const schema = new Map((await su.collections.getFullList()).map((c) => [c.name, c]));
  const idMap = new Map();
  const cloned = {};
  for (const name of IMPORT_ORDER) {
    const c = schema.get(name);
    if (!c) continue;
    const rows = await su.collection(name).getFullList({ filter: `hotel = "${seedHotel}"`, sort: "created", batch: 1000 });
    const records = rows.map((r) => {
      const fields = {};
      for (const f of c.fields) {
        if (SKIP.has(f.name) || f.type === "autodate" || f.type === "file" || f.type === "password" || f.hidden) continue;
        let v = r[f.name];
        if (f.type === "relation") {
          const target = [...schema.values()].find((x) => x.id === f.collectionId)?.name;
          const map = (id) => (target === "users" ? userMap.get(id) : target === "hotels" ? trial.id : idMap.get(id)) || "";
          v = Array.isArray(v) ? v.map(map).filter(Boolean) : v ? map(v) : v;
        }
        fields[f.name] = v;
      }
      return { created: r.created, updated: r.updated, fields, sourceId: r.id };
    });
    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500);
      const res = await su.send("/api/zarin/admin/import", { method: "POST", body: { hotel: trial.id, collection: name, records: batch.map(({ sourceId, ...r }) => r) } });
      (res.ids || []).forEach((id, j) => idMap.set(batch[j].sourceId, id));
    }
    cloned[name] = records.length;
  }
  // 365 days of weather (as imported on the trial hotel), if the demo had none.
  if (!cloned.weatherDaily) {
    const today = Date.now();
    const rows = [];
    for (let d = 365; d >= 1; d--) {
      const day = new Date(today - d * 864e5).toISOString().slice(0, 10);
      const t = 18 + 12 * Math.sin(((new Date(day).getUTCMonth() + 1 - 4) / 12) * 2 * Math.PI);
      rows.push({ fields: { day, tMean: Math.round(t * 10) / 10, source: "import" } });
    }
    for (let i = 0; i < rows.length; i += 500) await su.send("/api/zarin/admin/import", { method: "POST", body: { hotel: trial.id, collection: "weatherDaily", records: rows.slice(i, i + 500) } });
    cloned.weatherDaily = rows.length;
  }
  // Revenue lives in dailyFinance (server-written; the superuser may create it).
  let fin = 0;
  if (schema.has("dailyFinance")) {
    for (const r of await su.collection("dailyFinance").getFullList({ filter: `hotel = "${seedHotel}"`, batch: 1000 })) {
      const { id, collectionId, collectionName, created, updated, migratedFrom, updatedBy, ...rest } = r;
      await su.collection("dailyFinance").create({ ...rest, hotel: trial.id });
      fin++;
    }
  }
  cloned.dailyFinance = fin;
  // The nightly jobs, as on the trial hotel in production (phase 1 flags on).
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const nightly = await su.send(`/api/zarin/admin/hotels/${trial.id}/analytics`, { method: "POST", body: { rollup: { from: day(60), to: day(1) }, energy: true, insights: true, briefing: true, sla: true } });
  log(`trial hotel ${trial.id}: cloned ${JSON.stringify(cloned)}; nightly: insights ${nightly.insightsCreated}, energy ${nightly.energy ? "run" : "—"}`);
  return { trial: trial.id, accounts };
}

// --------------------------------------------------------------- snapshot
async function snapshot(url, accounts, collections) {
  const out = {};
  for (const a of accounts) {
    const pb = new PocketBase(url);
    pb.autoCancellation(false);
    const s = { me: null, cols: {}, error: null };
    try {
      await pb.collection("users").authWithPassword(a.nid, a.password);
      const me = await pb.send("/api/zarin/me");
      s.me = { role: me.role, status: me.status, hotels: me.hotels, primaryHotel: me.primaryHotel || "", permissions: [...(me.permissions || [])].sort(), financeView: !!me.financeView };
      // The hotel the APK of the deployed commit uses: primaryHotel, else the first membership.
      s.appHotel = s.me.primaryHotel || (s.me.hotels || [])[0] || "";
      for (const c of collections) {
        try {
          const rows = await pb.collection(c).getFullList({ fields: "id,hotel,hotels", batch: 1000 });
          // users: keyed by the app's hotel when they belong to it (the APK lists the staff of its hotel).
          const hotelOf = (r) => r.hotel ?? (Array.isArray(r.hotels) ? (r.hotels.includes(s.appHotel) ? s.appHotel : r.hotels[0] || "") : "");
          s.cols[c] = rows.map((r) => `${hotelOf(r)}/${r.id}`).sort();
        } catch (e) {
          s.cols[c] = `error ${e.status}`;
        }
      }
    } catch (e) {
      s.error = `${e.status} ${e.message}`;
    }
    out[a.label] = s;
  }
  return out;
}

function compare(before, after, accounts) {
  const rows = [];
  for (const a of accounts) {
    const b = before[a.label];
    const x = after[a.label];
    const issues = [];
    if (x.error) issues.push(`sign-in: ${x.error}`);
    if (JSON.stringify(b.me) !== JSON.stringify(x.me)) issues.push(`profile ${JSON.stringify(b.me)} → ${JSON.stringify(x.me)}`);
    if (b.appHotel !== x.appHotel) issues.push(`app hotel ${b.appHotel} → ${x.appHotel}`);
    let fewer = 0;
    for (const [c, ids] of Object.entries(b.cols)) {
      const now = x.cols[c];
      if (typeof ids === "string" || typeof now === "string") {
        if (ids !== now) issues.push(`${c}: ${typeof ids === "string" ? ids : ids.length} → ${typeof now === "string" ? now : now.length}`);
        continue;
      }
      const inApp = (l) => l.filter((k) => !k.includes("/") || k.startsWith("/") || k.startsWith(`${b.appHotel}/`));
      const same = JSON.stringify(ids) === JSON.stringify(now);
      const sameApp = JSON.stringify(inApp(ids)) === JSON.stringify(inApp(now));
      if (!sameApp) issues.push(`${c}: app view ${inApp(ids).length} → ${inApp(now).length}`);
      else if (!same) {
        if (!a.twoHotels) issues.push(`${c}: ${ids.length} → ${now.length}`);
        else fewer += ids.length - now.length;
      }
    }
    rows.push({ account: a.label, ok: issues.length === 0, apiOnlyFewer: fewer, issues });
  }
  return rows;
}

// ------------------------------------------------------------------- main
const report = { startedAt: new Date().toISOString(), stages: {} };
log(`deployed code: ${PROD}`);
const base = await startTestServer({ keepData: true });
let accounts;
let trialId;
try {
  ({ trial: trialId, accounts } = await buildProductionState(base.url, base.hotelId));
} finally {
  await base.stop();
}
const golden = mkdtempSync(join(tmpdir(), "zarin-rehearsal-"));
cpSync(base.dir, golden, { recursive: true });

const prodServer = await serve(PROD, golden);
const collections = (await (await superuser(prodServer.url)).collections.getFullList()).filter((c) => !c.system && c.type !== "view").map((c) => c.name).sort();
const before = await snapshot(prodServer.url, accounts, collections);
await prodServer.stop();
report.accounts = accounts.map(({ label, role, hotel, twoHotels }) => ({ label, role, hotel, twoHotels: !!twoHotels }));
report.collections = collections.length;
log(`snapshot of the deployed state: ${accounts.length} accounts × ${collections.length} collections`);

const migrationsOf = (dir) => readdirSync(join(dir, "pb_migrations")).filter((f) => f.endsWith(".js")).sort();
const prodMigrations = new Set(migrationsOf(PROD));
for (const st of stages) {
  const added = migrationsOf(st.dir).filter((m) => !prodMigrations.has(m));
  const dir = mkdtempSync(join(tmpdir(), `zarin-stage-${st.name}-`));
  cpSync(golden, dir, { recursive: true });
  const t0 = Date.now();
  const server = await serve(st.dir, dir);
  const upMs = Date.now() - t0;
  const after = await snapshot(server.url, accounts, collections);
  const rows = compare(before, after, accounts);
  await server.stop();
  // --after writes (the APK's own test suite does): it gets its own copy, so the
  // rollback below starts from exactly what the stage made of the database.
  let afterCmd = null;
  if (opt("after")) {
    const runDir = mkdtempSync(join(tmpdir(), `zarin-stage-${st.name}-after-`));
    cpSync(dir, runDir, { recursive: true });
    const run = await serve(st.dir, runDir);
    // Asynchronous on purpose: a blocked event loop would stop draining the
    // server's log pipe, and the server would hang on its next log line.
    const code = await new Promise((done) => {
      const child = spawn("bash", ["-c", opt("after")], { env: { ...process.env, ZH_PB_TEST_URL: run.url, ZH_PB_SUPERUSER_EMAIL: SUPERUSER.email, ZH_PB_SUPERUSER_PASSWORD: SUPERUSER.password }, stdio: "inherit" });
      child.on("exit", done);
    });
    afterCmd = code === 0 ? "passed" : `failed (exit ${code})`;
    await run.stop();
  }
  // Roll back: revert the stage's migrations, then serve with the deployed code.
  const t1 = Date.now();
  // (a stage with no new migrations — the deployed code itself, as a control — has nothing to revert)
  if (added.length) execFileSync(join(st.dir, "bin/pocketbase"), ["migrate", "down", String(added.length), "--dir", dir, "--hooksDir", join(st.dir, "pb_hooks"), "--migrationsDir", join(st.dir, "pb_migrations")], { input: "y\n", stdio: ["pipe", "pipe", "pipe"] });
  const downMs = Date.now() - t1;
  const back = await serve(PROD, dir);
  const restored = compare(before, await snapshot(back.url, accounts, collections), accounts);
  await back.stop();
  report.stages[st.name] = { migrations: added, upMs, downMs, accounts: rows, after: afterCmd, rollback: restored };
  const bad = rows.filter((r) => !r.ok);
  const badBack = restored.filter((r) => !r.ok);
  log(`\n== stage ${st.name}: +${added.join(", ")} (start ${upMs} ms, down ${downMs} ms)`);
  log(`   accounts unchanged: ${rows.length - bad.length}/${rows.length}${bad.length ? "" : " ✓"}`);
  for (const r of bad) log(`   ✗ ${r.account}: ${r.issues.join("; ")}`);
  for (const r of rows.filter((x) => x.ok && x.apiOnlyFewer)) log(`   · ${r.account}: app view identical; API lists ${r.apiOnlyFewer} fewer records (the other hotel)`);
  log(`   --after: ${afterCmd ?? "—"}`);
  log(`   after migrate down + deployed code: ${restored.length - badBack.length}/${restored.length} identical to the start${badBack.length ? "" : " ✓"}`);
  for (const r of badBack) log(`   ✗ ${r.account}: ${r.issues.join("; ")}`);
}
if (opt("out")) writeFileSync(opt("out"), JSON.stringify(report, null, 2));
void existsSync;
void trialId;
