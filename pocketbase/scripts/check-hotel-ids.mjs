// F10 guard (docs/21 §8.3): no hotel is hard-coded. Fails when a production
// hotel ID, or a fixture hotel's ID, name, alias or listing URL, appears in a
// repository file outside fixtures, tests and documentation.
//
//   npm run check:hotel-ids
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const self = "pocketbase/scripts/check-hotel-ids.mjs";
// Production hotels (real and trial): only docs may name them.
const PRODUCTION_IDS = ["j27oy3pm9rtrp9e", "c37f7qdkfoc87x0"];

const fixtures = JSON.parse(readFileSync(join(repo, "fixtures/reviews/src/hotels.json"), "utf8")).hotels;
const needles = new Set(PRODUCTION_IDS);
for (const h of fixtures) {
  needles.add(h.id);
  for (const v of [h.hotel.name, h.profile.names.fa, h.profile.names.en, ...h.profile.aliases]) if (v && v.length >= 4) needles.add(v);
  for (const l of h.listings) if (l.url) needles.add(l.url.replace(/^https?:\/\/(www\.)?/, ""));
}

const TEXT = /\.(m?js|cjs|ts|tsx|dart|json|ya?ml|kt|kts|swift|gradle|xml|html|css|sh|sql|env|txt|arb|properties|toml)$/i;
const excluded = (f) => f === self || f.startsWith("fixtures/") || f.startsWith("docs/") || /(^|\/)(test|tests|integration_test)\//.test(f) ||
  /\.md$/i.test(f) || f.includes("node_modules/") || f.endsWith("pb_hooks/lib/core.js");

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: repo, encoding: "utf8" })
  .split("\n").filter((f) => f && TEXT.test(f) && !excluded(f));
const hits = [];
for (const f of files) {
  let body;
  try { body = readFileSync(join(repo, f), "utf8"); } catch { continue; }
  const lower = body.toLowerCase();
  for (const n of needles) if (lower.includes(n.toLowerCase())) hits.push(`${f}: ${n}`);
}
if (hits.length) {
  console.error(`Hard-coded hotel identifiers outside fixtures, tests and docs (put them in data):\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`no hard-coded hotel identifiers (${files.length} files, ${needles.size} identifiers)`);
