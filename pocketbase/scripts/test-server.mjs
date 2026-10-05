// Throw-away PocketBase with this repo's migrations + hooks and the demo
// seed. Used by the Node test suite and, from the command line, by the
// Flutter adapter integration tests:
//
//   node scripts/test-server.mjs        # prints ZH_PB_TEST_URL=… and keeps running
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import PocketBase from "pocketbase";

import { seed } from "./seed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SUPERUSER = { email: "ci@zarin.local", password: "ci-Password-123" };
export const SECRET = "test-integration-secret";

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

export async function startTestServer({ keepData = false } = {}) {
  const bin = resolve(root, process.env.PB_BIN ?? "bin/pocketbase");
  if (!existsSync(bin)) {
    throw new Error(`PocketBase binary not found at ${bin}. Run scripts/get-pocketbase.sh or set PB_BIN.`);
  }
  const dir = mkdtempSync(join(tmpdir(), "zarin-pb-"));
  const paths = ["--dir", dir, "--hooksDir", join(root, "pb_hooks"), "--migrationsDir", join(root, "pb_migrations")];
  execFileSync(bin, ["migrate", "up", ...paths], { stdio: "pipe" });
  execFileSync(bin, ["superuser", "upsert", SUPERUSER.email, SUPERUSER.password, "--dir", dir], { stdio: "pipe" });

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const log = createWriteStream(join(dir, "serve.log"));
  const proc = spawn(bin, ["serve", `--http=127.0.0.1:${port}`, "--automigrate=false", ...paths], {
    env: { ...process.env, ZH_INTEGRATION_SECRET: SECRET, ZH_AI_PROVIDER: "none", ZH_N8N_WEBHOOK_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.pipe(log);
  proc.stderr.pipe(log);

  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {}
    if (i > 100) throw new Error(`PocketBase did not start (log: ${join(dir, "serve.log")})`);
    await new Promise((r) => setTimeout(r, 100));
  }

  // Tests sign in many accounts quickly; keep the production rate limits on
  // but exempt the local test client.
  const su = new PocketBase(url);
  su.autoCancellation(false);
  await su.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
  const settings = await su.settings.getAll();
  await su.settings.update({ rateLimits: { ...settings.rateLimits, excludedIPs: ["127.0.0.1"] } });

  const { hotelId } = await seed({ url, ...SUPERUSER, log: () => {} });

  const stop = async () => {
    proc.kill();
    if (keepData) console.log(`PocketBase data kept in ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  };
  return { url, hotelId, dir, stop };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startTestServer({ keepData: process.env.KEEP_PB_DATA === "1" });
  console.log(`ZH_PB_TEST_URL=${server.url}`);
  console.log(`ZH_PB_TEST_HOTEL=${server.hotelId}`);
  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
