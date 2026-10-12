// AI phase 0: scoped integration keys (v2 signing with nonce) next to the
// shared secret, and route validation on the integration API.
import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NID, errorOf, hotelId, login, signed, superuser, url } from "./helpers.mjs";

const nonce = () => randomBytes(16).toString("hex");

async function signedV2(path, { keyId, secret, method = "GET", body, n = nonce(), timestamp } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${ts}.${n}.${raw}`).digest("hex");
  const res = await fetch(`${url()}${path}`, {
    method,
    headers: {
      "content-type": "application/json", "x-zarin-key-id": keyId, "x-zarin-timestamp": String(ts),
      "x-zarin-nonce": n, "x-zarin-signature": sig,
    },
    body: raw || undefined,
  });
  return { status: res.status, json: await res.json() };
}

let su;
let key;
let otherHotel;
let otherKey;

beforeAll(async () => {
  su = await superuser();
  key = await su.send("/api/zarin/admin/integration-keys", { method: "POST", body: { label: "ai-worker (test)", hotels: [hotelId()] } });
  otherHotel = await su.collection("hotels").create({ name: "Other hotel (keys test)", status: "trial", settings: {} });
  otherKey = await su.send("/api/zarin/admin/integration-keys", { method: "POST", body: { label: "other", hotels: [otherHotel.id] } });
});

afterAll(async () => {
  await su.collection("hotels").delete(otherHotel.id);
});

describe("Scoped integration keys", () => {
  it("are created by superusers only, and the secret is returned once", async () => {
    expect(key.keyId).toMatch(/^zk_[a-z0-9]{16}$/);
    expect(key.secret).toHaveLength(48);
    const gm = await login(NID.gm);
    expect((await errorOf(gm.send("/api/zarin/admin/integration-keys", { method: "POST", body: { hotels: [hotelId()] } }))).status).toBeGreaterThanOrEqual(401);
    expect((await errorOf(gm.collection("integrationKeys").getList(1, 1))).status).toBe(403);
    const stored = await su.collection("integrationKeys").getFirstListItem(`keyId = "${key.keyId}"`);
    expect(stored.secretEnc).toBeTruthy();
    expect(stored.secretEnc).not.toContain(key.secret);
  });

  it("sign requests for the hotels in their scope", async () => {
    const res = await signedV2(`/v1/hotels/${hotelId()}/summary`, key);
    expect(res.status).toBe(200);
    expect(res.json.hotelId).toBe(hotelId());
  });

  it("reject a replayed nonce", async () => {
    const n = nonce();
    expect((await signedV2(`/v1/hotels/${hotelId()}/maintenance/overdue`, { ...key, n })).status).toBe(200);
    const again = await signedV2(`/v1/hotels/${hotelId()}/maintenance/overdue`, { ...key, n });
    expect(again.status).toBe(401);
    expect(again.json.data.code.code).toBe("replayed_request");
  });

  it("reject other hotels, global routes, bad signatures, stale timestamps and missing nonces", async () => {
    const foreign = await signedV2(`/v1/hotels/${hotelId()}/summary`, otherKey);
    expect(foreign.status).toBe(403);
    expect(foreign.json.data.code.code).toBe("key_not_allowed_for_hotel");
    expect((await signedV2("/v1/outbox/flush", { ...key, method: "POST" })).status).toBe(403);
    expect((await signedV2(`/v1/hotels/${hotelId()}/summary`, { ...key, secret: "wrong-secret" })).status).toBe(401);
    expect((await signedV2(`/v1/hotels/${hotelId()}/summary`, { ...key, timestamp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    expect((await signedV2(`/v1/hotels/${hotelId()}/summary`, { ...key, n: "short" })).status).toBe(401);
  });

  it("stop working when revoked", async () => {
    const temp = await su.send("/api/zarin/admin/integration-keys", { method: "POST", body: { label: "temp", hotels: [hotelId()] } });
    expect((await signedV2(`/v1/hotels/${hotelId()}/summary`, temp)).status).toBe(200);
    await su.send(`/api/zarin/admin/integration-keys/${temp.keyId}/revoke`, { method: "POST" });
    expect((await signedV2(`/v1/hotels/${hotelId()}/summary`, temp)).status).toBe(401);
  });

  it("leave the shared secret working for the existing workflows", async () => {
    expect((await signed(`/v1/hotels/${hotelId()}/summary`)).status).toBe(200);
  });

  it("purge reports conversations and nonces", async () => {
    const res = await signed("/v1/maintenance/purge", { method: "POST" });
    expect(res.status).toBe(200);
    expect(typeof res.json.nonces).toBe("number");
  });
});

describe("Route validation on the integration API", () => {
  const insight = (id, route) => ({ id, title: "Test insight", recommendation: "Check it", category: "energy", route });

  it("rejects insight routes that leave the app", async () => {
    for (const route of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/energy/../../x", "/a b"]) {
      const res = await signed(`/v1/hotels/${hotelId()}/insights`, { method: "POST", body: insight("route-test", route) });
      expect(res.status).toBe(400);
      expect(res.json.data.code.code).toBe("invalid_route");
    }
  });

  it("keeps in-app routes", async () => {
    const res = await signed(`/v1/hotels/${hotelId()}/insights`, { method: "POST", body: insight("route-ok", "/inventory/abc123?tab=moves") });
    expect(res.status).toBe(200);
    const rec = await su.collection("aiInsights").getOne(res.json.id);
    expect(rec.route).toBe("/inventory/abc123?tab=moves");
    await su.collection("aiInsights").delete(rec.id);
  });

  it("drops an invalid notification route instead of storing it", async () => {
    const res = await signed(`/v1/hotels/${hotelId()}/notifications`, {
      method: "POST",
      body: { roles: ["generalManager"], title: "route test", body: "x", route: "//evil.example/phish" },
    });
    expect(res.status).toBe(200);
    const n = await su.collection("notifications").getFirstListItem(`hotel = "${hotelId()}" && title = "route test"`);
    expect(n.route).toBe("");
  });
});
