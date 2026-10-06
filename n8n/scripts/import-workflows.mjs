// Imports (or updates, matched by name) the Zarin workflows into an n8n
// instance through its public API. Node 18+, no dependencies.
//
//   N8N_URL=https://your-n8n.example N8N_API_KEY=… node n8n/scripts/import-workflows.mjs
//
// New workflows are created inactive: pick the SMTP / Header Auth credentials
// on their nodes in the editor, then activate them there. Re-running updates
// the existing workflows in place, keeping those credentials; an active
// workflow is republished with the new version.
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

/**
 * The public API accepts only these fields (the rest are read-only). An update
 * replaces every node, and the files carry no credentials, so the ones picked
 * in the editor are carried over by node name.
 */
function payload(workflow, existing) {
  const { name, nodes, connections, settings } = workflow;
  const picked = new Map((existing?.nodes ?? []).filter((n) => n.credentials).map((n) => [n.name, n.credentials]));
  const merged = nodes.map((n) => (n.credentials || !picked.has(n.name) ? n : { ...n, credentials: picked.get(n.name) }));
  return { name, nodes: merged, connections, settings: settings ?? {} };
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let failed = 0;
for (const file of files) {
  const workflow = JSON.parse(readFileSync(join(dir, file), "utf8"));
  try {
    const existing = (await api("GET", `/workflows?name=${encodeURIComponent(workflow.name)}&limit=10`)).data ?? [];
    const match = existing.find((w) => w.name === workflow.name);
    const body = match ? payload(workflow, await api("GET", `/workflows/${match.id}`)) : payload(workflow);
    const saved = match ? await api("PUT", `/workflows/${match.id}`, body) : await api("POST", "/workflows", body);
    const missing = body.nodes.some(
      (n) => (n.type === "n8n-nodes-base.emailSend" || n.parameters?.authentication === "headerAuth") && !n.credentials,
    );
    console.log(`${match ? "updated" : "created"}  ${saved.id}  ${workflow.name}${missing ? "  (set credentials before activating)" : ""}`);
  } catch (err) {
    failed++;
    console.error(`failed   ${file}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed} workflow(s) failed.` : `\nDone. Open ${base}/home/workflows, set credentials, then activate.`);
process.exit(failed ? 1 : 0);
