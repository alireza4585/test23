// Imports a hotel test dataset (CSV pack + workbook) into a NEW trial hotel.
//
//   npm run import-dataset -- --csv app_import_csv_S1_Normal.zip --xlsx dataset.xlsx            plan only, no server
//   ZH_PB_URL=https://….liara.run npm run import-dataset -- --csv … --xlsx … --apply           import
//   ZH_PB_URL=https://….liara.run npm run import-dataset -- --csv … --xlsx … --report <hotelId> compare again
//
// Options: --name "Parsian Azadi – TEST"  --as-of "2026-10-07 09:30" (Tehran; default: Test_Scenarios' "now")
//          --recent-days 7  --energy-days N (energy window through the API; default = --recent-days)
//          --backup-dir ./import-backups  --yes (no confirmation prompt)
//
// --apply backs up pb_data first (server backup + downloaded copy) and stops if
// that fails. History older than the last --recent-days days is written through
// the superuser import route: no alerts, notifications or room changes, and
// created/updated carry the record's real time (CSV times are Tehran → UTC).
// The last days of energy readings, tickets and stock movements go through the
// app API as the matching test users, so their alerts are real. Production
// hotels are out of reach: the import route only accepts trial hotels.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import PocketBase from "pocketbase";

import { applyPlan, backup, snapshotHotels } from "./dataset/apply.mjs";
import { buildPlan, datasetNow, readDataset } from "./dataset/load.mjs";
import { compare, toMarkdown } from "./dataset/report.mjs";
import { confirmed, serverUrl, superuserLogin, value } from "./prompt.mjs";
import { passwordError } from "./rules.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

function printPlan(p, data) {
  const c = p.counts;
  const row = (label, a, b = "", note = "") => console.log(`  ${label.padEnd(20)} ${String(a).padStart(7)}  ${String(b).padStart(7)}  ${note}`);
  console.log(`\nDataset «${data.hotel.name}» (${data.rooms.length} rooms) → new hotel «${p.name}», status trial`);
  const last = data.tickets.map((t) => t.created_at.slice(0, 10)).sort().pop();
  console.log(`As of ${p.asOf} Tehran. Last ${p.recentDays} days (${p.cutoff} … ${last}) go through the app API${p.energyDays !== p.recentDays ? ` (energy: last ${p.energyDays} days, from ${p.energyCutoff})` : ""}; CSV times are Tehran, stored as UTC (−3:30).\n`);
  console.log(`  ${"".padEnd(20)} ${"history".padStart(7)}  ${"app API".padStart(7)}`);
  row("users", c.users, "", `temporary password, must change it${p.skippedUsers.length ? `; skipped ${p.skippedUsers.length}` : ""}`);
  row("staff", c.staff);
  row("rooms", c.rooms, "", "statuses from rooms.csv, updated = status_since");
  row("inventoryItems", c.items, "", "opening stock = current − last days' movements");
  row("dailyOperations", c.dailyOperations);
  row("shifts", c.shifts);
  row("tasks", c.tasks, "", "created = started_at (or due_at)");
  row("maintenanceTickets", c.tickets.history, c.tickets.api, "created = created_at");
  row("ticketEvents", c.ticketEvents, "", "the app writes the 'created' event of API tickets");
  row("energyReadings", c.energy.history, c.energy.api);
  const r = p.replayStats;
  row("inventoryMovements", c.movements.history, c.movements.api, `created = CSV time; ${r.deferred} wait for the day's delivery, ${r.clamped} clamped, ${r.reconciled} reconciliation adjustments`);
  for (const s of p.skippedUsers) console.log(`  skipped user ${s.id} (${s.role}): ${s.why}`);
  const spikes = (t) => p.expect.spikes.filter((x) => x.type === t);
  console.log(`\nThe API part should raise: energySpike ${["electricity", "water", "gas"].map((t) => `${t} ${spikes(t).length} (${spikes(t).filter((x) => x.critical).length} critical)`).join(", ")}; criticalTicket ${p.expect.criticalTickets}; lowStock as stock crosses the reorder level.`);
  if (p.issues.length) {
    console.log(`\nData issues (${p.issues.length}):`);
    for (const i of p.issues.slice(0, 20)) console.log(`  - ${i}`);
  } else console.log("\nData checks: every room, item, employee and ticket reference resolves.");
}

try {
  const csv = opt("csv");
  const xlsx = opt("xlsx");
  if (!csv || !xlsx) {
    console.error("Usage: npm run import-dataset -- --csv <pack.zip|folder> --xlsx <workbook.xlsx> [--apply | --report <hotelId>]");
    process.exit(1);
  }
  const data = readDataset({ csv: resolve(csv), xlsx: resolve(xlsx) });
  const plan = buildPlan(data, {
    name: opt("name", "Parsian Azadi – TEST"), asOf: opt("as-of", datasetNow(data)), recentDays: Number(opt("recent-days", 7)),
    energyDays: Number(opt("energy-days", opt("recent-days", 7))),
  });
  printPlan(plan, data);
  const reportId = opt("report");
  if (!flag("apply") && !reportId) {
    console.log("\nPlan only: nothing was written. Add --apply to import.");
    process.exit(0);
  }

  const pb = new PocketBase(await serverUrl());
  pb.autoCancellation(false);
  await superuserLogin(pb);
  const outDir = resolve(opt("backup-dir", "import-backups"));
  const writeReport = async (hotelId) => {
    const rows = await compare(pb, hotelId, plan, data.scenarios);
    const md = toMarkdown(rows, `# ${plan.name} (${hotelId}) vs Test_Scenarios, as of ${plan.asOf} Tehran`);
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, `import-report-${hotelId}.md`);
    writeFileSync(path, `${md}\n`);
    console.log(`\n${md}\n\nReport saved to ${path}`);
  };
  if (reportId) {
    await writeReport(reportId);
    process.exit(0);
  }

  // ------------------------------------------------------------ pre-flight
  try {
    await pb.send("/api/zarin/admin/import", { method: "POST", body: {} });
  } catch (err) {
    if (err?.status === 404) throw new Error("the server's hooks are older than this script: copy pb_hooks / pb_migrations first (runbook step 2)");
    if (err?.response?.data?.code?.code !== "collection_not_importable") throw err;
  }
  const same = await pb.collection("hotels").getFullList({ filter: pb.filter("name = {:n}", { n: plan.name }), fields: "id,status" });
  if (same.length) {
    throw new Error(`a hotel named «${plan.name}» already exists (${same.map((h) => `${h.id}, ${h.status}`).join("; ")}). `
      + `Remove it first with: HOTEL_ID=${same[0].id} npm run reset-demo`);
  }
  const nids = plan.users.map((u) => u.fields.nationalId);
  const taken = [];
  for (let i = 0; i < nids.length; i += 40) {
    const chunk = nids.slice(i, i + 40);
    const filter = chunk.map((_, k) => `nationalId = {:n${k}}`).join(" || ");
    const params = Object.fromEntries(chunk.map((v, k) => [`n${k}`, v]));
    taken.push(...(await pb.collection("users").getFullList({ filter: pb.filter(filter, params), fields: "nationalIdMasked" })).map((u) => u.nationalIdMasked));
  }
  if (taken.length) throw new Error(`${taken.length} test national IDs already belong to users on this server (${taken.slice(0, 5).join(", ")}…)`);
  const before = await snapshotHotels(pb, null);
  console.log(`\nOther hotels on ${pb.baseURL} (must stay untouched): ${Object.entries(before).map(([id, h]) => `${h.name} (${id}, ${h.status})`).join("; ") || "none"}`);

  const password = await value("TEST_USERS_TEMP_PASSWORD", {
    question: `Temporary password for the ${plan.users.length} test users (8+ characters, letters and digits): `,
    hidden: true, confirm: true, validate: passwordError,
  });
  if (!flag("yes") && !(await confirmed(`\nBack up pb_data, then import into ${pb.baseURL}? Type "yes" to start: `))) {
    console.log("Nothing was written.");
    process.exit(0);
  }

  await backup(pb, outDir, console.log);
  let result;
  try {
    result = await applyPlan(pb, plan, { password });
  } catch (err) {
    const created = (await pb.collection("hotels").getFullList({ filter: pb.filter("name = {:n}", { n: plan.name }), fields: "id" }))[0];
    console.error(`\nImport stopped: ${err?.response?.message ?? err?.message ?? err}`);
    if (err?.response?.data) console.error(JSON.stringify(err.response.data));
    if (created) console.error(`Remove the partial test hotel with: HOTEL_ID=${created.id} npm run reset-demo   (or restore the backup above)`);
    process.exit(1);
  }

  const after = await snapshotHotels(pb, result.hotelId);
  const changed = Object.entries(before).filter(([id, b]) => JSON.stringify(b) !== JSON.stringify(after[id]));
  console.log(changed.length ? `\n⚠ Other hotels changed: ${changed.map(([id]) => id).join(", ")}` : "\nOther hotels: unchanged ✓");
  await writeReport(result.hotelId);
  console.log(`\nTest hotel ${result.hotelId}. Test users sign in with their national ID and the temporary password, then must change it.`);
  console.log(`To remove the test hotel and its users later: HOTEL_ID=${result.hotelId} npm run reset-demo`);
} catch (err) {
  console.error(`\n${err?.response?.message ?? err?.message ?? err}`);
  process.exit(1);
}
