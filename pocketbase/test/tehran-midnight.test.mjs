// The rule engine around Tehran midnight (UTC+03:30, no DST): demo data and
// the insights run pinned to 23:50 and 00:10 Tehran, and a run that crosses
// midnight after seeding. Mirrors "runs the rule engine on demand" in
// integration-api.test.mjs, through the superuser analytics route, which
// takes `now` (the Go server's own clock cannot be faked).
import PocketBase from "pocketbase";
import { afterAll, describe, expect, it } from "vitest";

import { SUPERUSER, startTestServer } from "../scripts/test-server.mjs";

const tehran = (iso) => new Date(`${iso}+03:30`);
const servers = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

async function runAt(seedAt, runAt) {
  const server = await startTestServer({ seedNow: seedAt });
  servers.push(server);
  const su = new PocketBase(server.url);
  su.autoCancellation(false);
  await su.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
  const run = () => su.send(`/api/zarin/admin/hotels/${server.hotelId}/analytics`, { method: "POST", body: { insights: true, now: runAt.toISOString() } });
  const first = await run();
  const insights = await su.collection("aiInsights").getFullList({ filter: `hotel = "${server.hotelId}"` });
  const second = await run();
  const after = await su.collection("aiInsights").getFullList({ filter: `hotel = "${server.hotelId}"` });
  return { first, second, insights, after };
}

describe("rule engine near Tehran midnight", () => {
  for (const [label, seedAt, at] of [
    ["23:50 Tehran", tehran("2026-10-11T23:50:00"), tehran("2026-10-11T23:50:30")],
    ["00:10 Tehran", tehran("2026-10-12T00:10:00"), tehran("2026-10-12T00:10:30")],
  ]) {
    it(`stores explainable insights at ${label}, and a re-run does not duplicate them`, async () => {
      const { first, insights, after } = await runAt(seedAt, at);
      expect(first.insightsCreated).toBeGreaterThan(0);
      const energy = insights.find((i) => i.rule === "energyIntensity");
      expect(energy).toBeTruthy();
      expect(energy.evidence.length).toBeGreaterThan(0);
      expect(energy.title).toMatch(/[0-9]/);
      expect(after.length).toBe(insights.length);
    }, 60_000);
  }

  it("uses complete past Tehran days only: crossing midnight after seeding moves the 4-day window", async () => {
    // The seed's electricity spike covers the 4 days before its own day. Run 20 s after
    // midnight, "yesterday" is the seed's day (no reading yet) and one spike day falls into
    // the comparison window, so the intensity rise is no longer detected. That is correct
    // behaviour, and the reason integration-api.test.mjs checks which Tehran day it runs on.
    const { first, insights } = await runAt(tehran("2026-10-11T23:59:50"), tehran("2026-10-12T00:00:10"));
    expect(first.insightsCreated).toBeGreaterThan(0);
    expect(insights.find((i) => i.rule === "energyIntensity")).toBeUndefined();
  }, 60_000);
});
