// AI phase 1, F4 morning briefing on a live server: one briefing per role,
// visibility by role and finance.view, the rule-based text checked against its
// facts, the optional LLM re-wording (validated, with fallback) and what the
// LLM is sent, the rating route and the summary route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";

import { NID, errorOf, hotelId, login, post, signed, superuser } from "./helpers.mjs";

const analytics = (pb, id, body) => pb.send(`/api/zarin/admin/hotels/${id}/analytics`, { method: "POST", body });
const llm = (path, body) => fetch(`${inject("llmUrl")}${path}`, { method: "POST", body: JSON.stringify(body || {}) }).then((r) => r.json());

let su;
let settingsBefore;
beforeAll(async () => {
  su = await superuser();
  settingsBefore = (await su.collection("hotels").getOne(hotelId())).settings;
  await su.collection("hotels").update(hotelId(), { settings: { ...settingsBefore, features: { morningBriefing: true, recommendationLoop: true } } });
  await llm("/__reset");
});
afterAll(async () => {
  for (const b of await su.collection("briefings").getFullList({ filter: `hotel = "${hotelId()}"` })) await su.collection("briefings").delete(b.id);
  for (const a of await su.collection("aiActions").getFullList({ filter: `hotel = "${hotelId()}"` })) await su.collection("aiActions").delete(a.id).catch(() => {});
  await su.collection("hotels").update(hotelId(), { settings: settingsBefore });
  await llm("/__reset");
});

describe("F4 morning briefing", () => {
  it("one briefing per role with ai.insights.view, rule-based when the LLM is unavailable, numbers all backed", async () => {
    await analytics(su, hotelId(), { insights: true });
    const res = (await analytics(su, hotelId(), { briefing: true })).briefing;
    expect(Object.keys(res.roles).sort()).toEqual([
      "analyst", "energyManager", "generalManager", "hotelOwner", "housekeepingManager", "inventoryManager",
      "maintenanceManager", "operationsManager", "restaurantManager",
    ]);
    for (const [role, r] of Object.entries(res.roles)) {
      expect(r.selfCheck, role).toEqual([]);
      expect(r.source, role).toBe("rules");
      // The mock LLM answers 503 with nothing scripted: the reason is recorded.
      if (r.items) expect(r.fallbackReason, role).toMatch(/^llm_error/);
    }
    const gm = await su.collection("briefings").getFirstListItem(`hotel = "${hotelId()}" && role = "generalManager"`);
    expect(gm.text.split("\n")[0]).toBe(`گزارش صبحگاهی ${res.day}`);
    expect(gm.items.length).toBeGreaterThan(0);
    expect(gm.items.length).toBeLessThanOrEqual(7);
    expect(gm.facts.day).toBe(res.day);
  });

  it("each role reads only its own briefing; finance items only with finance.view", async () => {
    const gm = await login(NID.gm);
    const ops = await login(NID.ops);
    const mineGm = await gm.collection("briefings").getFullList();
    expect(mineGm.map((b) => b.role)).toEqual(["generalManager"]);
    const mineOps = await ops.collection("briefings").getFullList();
    expect(mineOps.map((b) => b.role)).toEqual(["operationsManager"]);
    expect(mineOps[0].containsFinance).toBe(false);
    expect(mineOps[0].items.some((i) => i.category === "revenue")).toBe(false);
    expect((await (await login(NID.housekeeper)).collection("briefings").getList(1, 1)).totalItems).toBe(0);
    const gmRec = mineGm[0];
    expect((await errorOf(ops.collection("briefings").getOne(gmRec.id))).status).toBe(404);
    // A briefing with revenue is hidden from its own role if a hotel override removes finance.view.
    const owner = await su.collection("briefings").getFirstListItem(`hotel = "${hotelId()}" && role = "hotelOwner"`);
    expect(owner.items.every((i) => !i.finance || i.category === "revenue")).toBe(true);
  });

  it("the LLM re-wording is used only when every number is backed; otherwise the rule text stays", async () => {
    await llm("/__reset");
    const good = "گزارش صبحگاهی\n1. وضعیت امروز عادی است و یک اقدام پیشنهادی در مرکز اقدام منتظر تصمیم است.";
    const bad = "گزارش صبحگاهی\n1. دیروز 987 تیکت بحرانی باز بود.";
    // Roles are generated in a fixed order (hotelOwner first): good for it, then two bad answers for the GM.
    await llm("/__script", { responses: [{ content: good }, { content: bad }, { content: bad }] });
    const res = (await analytics(su, hotelId(), { briefing: true })).briefing;
    expect(res.roles.hotelOwner.source).toBe("llm");
    expect(res.roles.generalManager.source).toBe("rules");
    expect(res.roles.generalManager.fallbackReason).toBe("unsupported_numbers: 987");
    const owner = await su.collection("briefings").getFirstListItem(`hotel = "${hotelId()}" && role = "hotelOwner"`);
    expect(owner).toMatchObject({ source: "llm", text: good, model: "mock-model" });
    // What the LLM was sent: data in a tagged block, no national IDs or phone numbers, names as [P…] tokens.
    const sent = await (await fetch(`${inject("llmUrl")}/__requests`)).json();
    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const req of sent) {
      const body = JSON.stringify(req.body);
      expect(body).toContain("<briefing_data>");
      for (const nid of Object.values(NID)) expect(body).not.toContain(nid);
      expect(body).not.toMatch(/09\d{9}/);
      expect(req.body.temperature).toBeLessThanOrEqual(0.2);
    }
    const usage = await su.collection("aiBudgets").getFirstListItem(`hotel = "${hotelId()}"`);
    expect(usage.calls).toBeGreaterThan(0);
  });

  it("rating: only by the briefing's own role", async () => {
    const gm = await login(NID.gm);
    const mine = (await gm.collection("briefings").getFullList())[0];
    expect(await post(gm, `/api/zarin/briefings/${mine.id}/rate`, { useful: true })).toEqual({ ok: true });
    expect((await su.collection("briefings").getOne(mine.id)).ratings[gm.authStore.record.id].useful).toBe(true);
    const opsRec = await su.collection("briefings").getFirstListItem(`hotel = "${hotelId()}" && role = "operationsManager"`);
    expect((await errorOf(post(gm, `/api/zarin/briefings/${opsRec.id}/rate`, { useful: false }))).status).toBe(404);
    expect((await errorOf(post(gm, `/api/zarin/briefings/${mine.id}/rate`, { useful: "yes" }))).code).toBe("invalid_body");
  });

  it("the signed summary route returns today's briefings; the flag off skips generation", async () => {
    const s = await signed(`/v1/hotels/${hotelId()}/summary`);
    expect(s.status).toBe(200);
    expect(s.json.briefings.roles.map((r) => r.role)).toContain("generalManager");
    expect(s.json.briefings.roles.find((r) => r.role === "operationsManager").containsFinance).toBe(false);
    await su.collection("hotels").update(hotelId(), { settings: { ...settingsBefore, features: {} } });
    try {
      expect((await analytics(su, hotelId(), { briefing: true })).briefing).toEqual({ skipped: "feature_disabled" });
      expect((await signed(`/v1/hotels/${hotelId()}/summary`)).json.briefings).toBeNull();
    } finally {
      await su.collection("hotels").update(hotelId(), { settings: { ...settingsBefore, features: { morningBriefing: true, recommendationLoop: true } } });
    }
  });
});
