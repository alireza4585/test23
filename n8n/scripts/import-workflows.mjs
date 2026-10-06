// Imports (or updates, matched by name) the Zarin workflows into an n8n
// instance through its public API. Node 18+, no dependencies.
//
//   N8N_URL=https://your-n8n.example N8N_API_KEY=… node n8n/scripts/import-workflows.mjs
//
// New workflows are created inactive. Channels whose variables are empty are
// skipped, so they can be activated before Bale / SMS / e-mail are set up;
// the e-mail nodes start switched off until an SMTP credential is picked.
// Re-running updates the existing workflows in place, keeping credentials
// (and the on/off state of nodes that have one); an active workflow is
// republished with the new version.
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
 * in the editor are carried over by node name. A node configured that way
 * also keeps its on/off state: the files ship the e-mail nodes switched off
 * (they need an SMTP credential before n8n lets the workflow be published),
 * and switching one on in the editor must survive later updates.
 */
function payload(workflow, existing) {
  const { name, nodes, connections, settings } = workflow;
  const configured = new Map((existing?.nodes ?? []).filter((n) => n.credentials).map((n) => [n.name, n]));
  const merged = nodes.map((n) => {
    const old = configured.get(n.name);
    if (!old || n.credentials) return n;
    const { disabled, ...rest } = n;
    return { ...rest, credentials: old.credentials, ...(old.disabled ? { disabled: true } : {}) };
  });
  return { name, nodes: merged, connections, settings: settings ?? {} };
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let failed = 0;
for (const file of files) {
  const workflow = JSON.parse(readFileSync(join(dir, file), "utf8"));
  try {
    const existing = (await api("GET", `/workflows?name=${encodeURIComponent(workflow.name)}&limit=10`)).data ?? [];
    const match = existing.find((w) => w.name === workflow.name && !w.isArchived);
    const body = match ? payload(workflow, await api("GET", `/workflows/${match.id}`)) : payload(workflow);
    const saved = match ? await api("PUT", `/workflows/${match.id}`, body) : await api("POST", "/workflows", body);
    const needs = (n) => n.type === "n8n-nodes-base.emailSend" || n.parameters?.authentication === "headerAuth";
    const missing = body.nodes.some((n) => needs(n) && !n.disabled && !n.credentials);
    const off = body.nodes.filter((n) => needs(n) && n.disabled && !n.credentials).map((n) => n.name);
    const notes = [missing && "set credentials before activating", off.length && `switched off until SMTP is set: ${off.join(", ")}`];
    console.log(`${match ? "updated" : "created"}  ${saved.id}  ${workflow.name}${notes.filter(Boolean).map((t) => `  (${t})`).join("")}`);
  } catch (err) {
    failed++;
    console.error(`failed   ${file}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed} workflow(s) failed.` : `\nDone. Open ${base}/home/workflows to review credentials and activate.`);
process.exit(failed ? 1 : 0);
