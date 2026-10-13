// The weather adapter with each provider setting (own servers: the provider
// is fixed per process by ZH_WEATHER_PROVIDER). Synthetic data only.
import PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPERUSER, startTestServer } from "../scripts/test-server.mjs";
import { startMockWeather, temperature } from "./weather-fixture.mjs";

const NOW = "2026-10-07T06:00:00Z";

async function su(url) {
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  await pb.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
  return pb;
}

async function refresh(pb) {
  const hotel = await pb.collection("hotels").create({
    name: "Weather provider", status: "trial", settings: { location: { lat: 35.7, lon: 51.4 }, features: { energyBaseline: true } },
  });
  const res = await pb.send(`/api/zarin/admin/hotels/${hotel.id}/analytics`, { method: "POST", body: { energy: true, now: NOW } });
  return { hotelId: hotel.id, weather: res.energy.weather };
}

describe("weather providers", () => {
  let mock;
  const servers = [];
  beforeAll(async () => {
    mock = await startMockWeather();
  });
  afterAll(async () => {
    for (const s of servers) await s.stop();
    mock.server.close();
  });

  it("nasa_power: parses the POWER shape and skips its -999 'missing' values", async () => {
    const server = await startTestServer({ env: { ZH_WEATHER_PROVIDER: "nasa_power", ZH_WEATHER_BASE_URL: mock.url } });
    servers.push(server);
    const pb = await su(server.url);
    const { hotelId, weather } = await refresh(pb);
    expect(weather).toMatchObject({ provider: "nasa_power", from: "2025-10-07", to: "2026-10-06", fetched: 364, written: 364 });
    const requests = await (await fetch(`${mock.url}/__requests`)).json();
    expect(requests.at(-1)).toMatchObject({ path: "/api/temporal/daily/point", query: { start: "20251007", end: "20261006", parameters: "T2M,T2M_MAX,T2M_MIN", latitude: "35.7", longitude: "51.4" } });
    const row = await pb.collection("weatherDaily").getFirstListItem(`hotel = "${hotelId}" && day = "2026-03-01"`);
    expect(row).toMatchObject({ tMean: temperature("2026-03-01"), source: "nasa_power", hasRange: true });
    expect((await pb.collection("weatherDaily").getList(1, 1, { filter: `hotel = "${hotelId}" && day = "2026-10-06"` })).totalItems).toBe(0);
  });

  it("none (the default): nothing is fetched", async () => {
    const before = (await (await fetch(`${mock.url}/__requests`)).json()).length;
    const server = await startTestServer({ env: { ZH_WEATHER_BASE_URL: mock.url } });
    servers.push(server);
    const { weather } = await refresh(await su(server.url));
    expect(weather).toEqual({ provider: "none", skipped: "provider_none" });
    expect((await (await fetch(`${mock.url}/__requests`)).json()).length).toBe(before);
  });
});
