// One seeded PocketBase for the whole Node test run, plus a mock n8n webhook
// that verifies event signatures exactly like n8n/workflows/01-event-router
// ("Verify signature" re-serializes the parsed body before hashing).
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

import { SECRET, SUPERUSER, startTestServer } from "../scripts/test-server.mjs";

export { SECRET, SUPERUSER };

function startMockN8n() {
  const received = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/received") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(received));
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const ts = req.headers["x-zarin-timestamp"];
      const sig = req.headers["x-zarin-signature"];
      const hmac = (body) => createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
      const body = JSON.parse(raw);
      received.push({ raw, type: body.type, hotelId: body.hotelId, data: body.data, signatureOk: sig === hmac(JSON.stringify(body)) });
      // Answer slowly, like a real n8n run, so overlapping flushes race.
      setTimeout(() => {
        res.writeHead(200);
        res.end("ok");
      }, 100);
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

export default async function setup({ provide }) {
  const n8n = await startMockN8n();
  const pb = await startTestServer({
    keepData: process.env.KEEP_PB_DATA === "1",
    webhookUrl: `${n8n.url}/webhook/zarin-events`,
  });
  provide("pbUrl", pb.url);
  provide("hotelId", pb.hotelId);
  provide("n8nUrl", n8n.url);
  return async () => {
    await pb.stop();
    n8n.server.close();
  };
}
