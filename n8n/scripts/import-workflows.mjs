// Imports (or updates, matched by name) the Zarin workflows into an n8n
// instance through its public API. Node 18+, no dependencies.
//
//   N8N_URL=https://your-n8n.example N8N_API_KEY=… node n8n/scripts/import-workflows.mjs
//
// Workflows are left inactive: pick the SMTP / Header Auth credentials on
// their nodes in the editor, then activate them there.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.N8N_URL ?? "").replace(/\/+$/, "");
const key = process.env.N8N_API_KEY ?? "";
if (!base || !key) {
  console.error("Set N8N_URL (e.g. https://your-n8n.example) and N8N_API_KEY (n8n → Settings → n8n API).");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "workflows");

async function api(method, path, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": key, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/** The public API accepts only these fields (the rest are read-only). */
function payload(workflow) {
  const { name, nodes, connections, settings } = workflow;
  return { name, nodes, connections, settings: settings ?? {} };
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let failed = 0;
for (const file of files) {
  const workflow = JSON.parse(readFileSync(join(dir, file), "utf8"));
  try {
    const existing = (await api("GET", `/workflows?name=${encodeURIComponent(workflow.name)}&limit=10`)).data ?? [];
    const match = existing.find((w) => w.name === workflow.name);
    const saved = match
      ? await api("PUT", `/workflows/${match.id}`, payload(workflow))
      : await api("POST", "/workflows", payload(workflow));
    const needsCredentials = workflow.nodes.some(
      (n) => n.type === "n8n-nodes-base.emailSend" || n.parameters?.authentication === "headerAuth",
    );
    console.log(`${match ? "updated" : "created"}  ${saved.id}  ${workflow.name}${needsCredentials ? "  (set credentials before activating)" : ""}`);
  } catch (err) {
    failed++;
    console.error(`failed   ${file}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed} workflow(s) failed.` : `\nDone. Open ${base}/home/workflows, set credentials, then activate.`);
process.exit(failed ? 1 : 0);
