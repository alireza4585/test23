// F10 R2: evaluate the review analysis on a labelled set, on a throw-away local
// PocketBase (this repo's migrations and hooks; nothing is deployed or kept).
//
//   node scripts/reviews-eval.mjs --set synthetic --method rules
//   node scripts/reviews-eval.mjs --set synthetic --method llm      # needs ZH_AI_* (see below)
//   node scripts/reviews-eval.mjs --set human --method llm          # fixtures/reviews/eval/human/reviews.jsonl
//
// With --method llm the server uses the same gateway as production, from these
// environment variables (set them in your shell, never in a file in the repo):
//   ZH_AI_PROVIDER=openai_compatible  ZH_AI_BASE_URL=<Liara AI base URL>
//   ZH_AI_MODEL=<model>  ZH_AI_API_KEY=<key>  [ZH_AI_TIMEOUT_SECONDS=90]
// The report (Markdown) is printed and written to --out (default:
// fixtures/reviews/eval/results/<set>-<method>-<date>.md). It holds metrics only.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ACCOUNTS, PASSWORD } from "./seed.mjs";
import { evaluate, loadSet, report } from "./lib/reviews-eval.mjs";
import { SUPERUSER, startTestServer } from "./test-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const setName = opt("--set", "synthetic");
const method = opt("--method", "rules");
const limit = Number(opt("--limit", "0")) || 0;

const files = {
  synthetic: join(root, "fixtures/reviews/generated/eval-synthetic.jsonl"),
  human: join(root, "fixtures/reviews/eval/human/reviews.jsonl"),
};
if (!files[setName]) { console.error("--set synthetic | human"); process.exit(2); }
if (method !== "rules" && method !== "llm") { console.error("--method rules | llm"); process.exit(2); }
const env = {};
if (method === "llm") {
  for (const k of ["ZH_AI_PROVIDER", "ZH_AI_BASE_URL", "ZH_AI_MODEL", "ZH_AI_API_KEY", "ZH_AI_TIMEOUT_SECONDS"]) if (process.env[k]) env[k] = process.env[k];
  if (!env.ZH_AI_PROVIDER || !env.ZH_AI_MODEL) {
    console.error("--method llm needs ZH_AI_PROVIDER and ZH_AI_MODEL (and ZH_AI_BASE_URL / ZH_AI_API_KEY) in the environment.");
    process.exit(2);
  }
} else {
  env.ZH_AI_PROVIDER = "none";
}

let set;
try { set = loadSet(files[setName]); } catch (err) {
  console.error(`cannot read the ${setName} set (${files[setName]}): ${err.message}`);
  process.exit(2);
}
const server = await startTestServer({ env });
try {
  const sa = ACCOUNTS.find((a) => a[1] === "superAdmin");
  const r = await evaluate({ url: server.url, email: SUPERUSER.email, password: SUPERUSER.password, saNationalId: sa[0], saPassword: PASSWORD, set, setName, limit });
  if (method === "llm" && r.analysed.llm === 0) console.error(`warning: the LLM analysed nothing (fallback: ${JSON.stringify(r.fallbackReasons)})`);
  const text = report(r);
  const out = opt("--out", join(root, `fixtures/reviews/eval/results/${setName}-${r.method}-${new Date().toISOString().slice(0, 10)}.md`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(text);
  console.log(`written: ${out}`);
} finally {
  await server.stop();
}
