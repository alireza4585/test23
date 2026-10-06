// Fallback when no n8n API key is at hand: paste into the browser's DevTools
// console on the n8n tab (signed in), then call
//   await zarinUpdate("<workflow id from the address bar>", <contents of the JSON file>)
// It updates that workflow from a file in n8n/workflows the way
// import-workflows.mjs does: credentials picked in the editor, and the on/off
// state of nodes that have one, are kept. Every request carries the
// browser-id header the editor uses; without it n8n signs you out.
async function zarinUpdate(id, wf) {
  const h = { "content-type": "application/json", "browser-id": localStorage.getItem("n8n-browserId") };
  const cur = (await (await fetch(`/rest/workflows/${id}`, { headers: h })).json()).data;
  const keep = new Map(cur.nodes.filter((n) => n.credentials).map((n) => [n.name, n]));
  const nodes = wf.nodes.map((n) => {
    const old = keep.get(n.name);
    if (!old || n.credentials) return n;
    const { disabled, ...rest } = n;
    return { ...rest, credentials: old.credentials, ...(old.disabled ? { disabled: true } : {}) };
  });
  const res = await fetch(`/rest/workflows/${id}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ name: wf.name, nodes, connections: wf.connections, settings: wf.settings, versionId: cur.versionId }),
  });
  const out = await res.json();
  console.log(res.status, out.data ? `${out.data.nodes.length} nodes` : out.message);
}
