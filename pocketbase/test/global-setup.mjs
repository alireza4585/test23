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

/**
 * OpenAI-compatible mock LLM. It records every request (so tests can check
 * what would be sent to a provider) and answers with the responses a test
 * scripted via POST /__script; with nothing scripted it answers 503, so the
 * assistant falls back to its rule-based answer exactly as with no provider.
 */
function startMockLlm() {
  let requests = [];
  let script = [];
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/__requests") return json(res, 200, requests);
      if (req.url === "/__reset") {
        requests = [];
        script = [];
        return json(res, 200, {});
      }
      if (req.url === "/__script") {
        script = script.concat(JSON.parse(raw).responses || []);
        return json(res, 200, {});
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        requests.push({ headers: req.headers, body: JSON.parse(raw) });
        const next = script.shift();
        if (!next) return json(res, 503, { error: "no scripted response" });
        return json(res, next.status || 200, {
          model: "mock-model",
          choices: [{ message: { role: "assistant", content: next.content ?? "" }, finish_reason: next.finishReason || "stop" }],
          usage: next.usage || { prompt_tokens: 100, completion_tokens: 20 },
        });
      }
      json(res, 404, {});
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

export default async function setup({ provide }) {
  const n8n = await startMockN8n();
  const llm = await startMockLlm();
  const seededAt = new Date();
  const pb = await startTestServer({
    seedNow: seededAt,
    keepData: process.env.KEEP_PB_DATA === "1",
    webhookUrl: `${n8n.url}/webhook/zarin-events`,
    env: { ZH_AI_PROVIDER: "openai_compatible", ZH_AI_BASE_URL: llm.url, ZH_AI_MODEL: "mock-model" },
  });
  provide("pbUrl", pb.url);
  provide("pbDir", pb.dir);
  provide("seededAt", seededAt.toISOString());
  provide("hotelId", pb.hotelId);
  provide("n8nUrl", n8n.url);
  provide("llmUrl", llm.url);
  return async () => {
    await pb.stop();
    n8n.server.close();
    llm.server.close();
  };
}
