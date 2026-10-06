import { describe, expect, inject, it } from "vitest";

import { hotelId, login, NID, signed, superuser, url } from "./helpers.mjs";

const v1 = (path) => `/v1/hotels/${hotelId()}${path}`;

describe("integration API v1 (n8n / IoT)", () => {
  it("health is public", async () => {
    const res = await fetch(`${url()}/v1/health`);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects unsigned, wrongly signed and replayed requests", async () => {
    expect((await fetch(`${url()}${v1("/summary")}`)).status).toBe(401);
    expect((await signed(v1("/summary"), { secret: "wrong-secret" })).status).toBe(401);
    const stale = Math.floor(Date.now() / 1000) - 600;
    expect((await signed(v1("/summary"), { timestamp: stale })).status).toBe(401);
  });

  it("summary returns yesterday's KPIs, open alerts and insights", async () => {
    const { status, json } = await signed(v1("/summary"));
    expect(status).toBe(200);
    expect(json.hotel).toBe("هتل بزرگ زرین");
    expect(json.metrics.occupancyRate).toBeGreaterThan(50);
    expect(json.metrics.electricityVsBaselinePct).toBeGreaterThan(0);
    expect(json.alerts.length).toBeGreaterThan(0);
    expect(json.narrative).toBeUndefined();
  });

  it("narrative is null when no LLM is configured", async () => {
    const { json } = await signed(`${v1("/summary")}?narrative=fa`);
    expect(json.narrative).toBeNull();
  });

  it("lists SLA breaches for escalation", async () => {
    const { json } = await signed(v1("/maintenance/overdue"));
    const titles = json.tickets.map((t) => t.title);
    expect(titles).toContain("کولر گازی اتاق ۴۰۵ کار نمی‌کند");
    expect(json.tickets.every((t) => t.overdueMinutes > 0)).toBe(true);
  });

  it("delivers notifications to roles", async () => {
    const { json } = await signed(v1("/notifications"), {
      method: "POST",
      body: { roles: ["maintenanceManager"], title: "۲ خرابی خارج از SLA", body: "تست", severity: "critical", category: "maintenance", route: "/maintenance" },
    });
    expect(json.recipients).toBe(1);
    const mm = await login(NID.maintenanceManager);
    expect((await mm.collection("inbox").getFullList({ sort: "-created" }))[0].title).toBe("۲ خرابی خارج از SLA");
  });

  it("ingests smart-meter readings idempotently, in the manual-entry shape", async () => {
    const body = { type: "water", day: "2026-01-15", consumption: 41.5, meterId: "MTR-W1", source: "smartMeter" };
    const first = await signed(v1("/energy/readings"), { method: "POST", body });
    const second = await signed(v1("/energy/readings"), { method: "POST", body: { ...body, consumption: 42 } });
    expect(second.json.id).toBe(first.json.id);
    const su = await superuser();
    const rec = await su.collection("energyReadings").getOne(first.json.id);
    expect(rec).toMatchObject({ type: "water", unit: "m³", consumption: 42, source: "smartMeter", meterId: "MTR-W1" });
    expect((await signed(v1("/energy/readings"), { method: "POST", body: { ...body, consumption: -1 } })).status).toBe(400);
  });

  it("rolls up daily metrics (idempotent backfill)", async () => {
    const first = await signed(`${v1("/metrics/rollup")}?day=2026-01-01`, { method: "POST", body: {} });
    expect(first.status).toBe(200);
    const yesterday = await signed(v1("/metrics/rollup"), { method: "POST", body: {} });
    expect(yesterday.json.metrics.occupancyRate).toBeGreaterThan(50);
    await signed(v1("/metrics/rollup"), { method: "POST", body: {} });
    const gm = await login(NID.gm);
    const rows = await gm.collection("dailyMetrics").getFullList({ filter: `day = "${yesterday.json.day}"` });
    expect(rows).toHaveLength(1);
    expect(rows[0].data.energy.electricity).toBeGreaterThan(0);
    expect(rows[0].revpar).toBe(yesterday.json.metrics.revpar);
  });

  it("runs the rule engine on demand and stores explainable insights", async () => {
    const { json } = await signed(v1("/insights/run"), { method: "POST", body: {} });
    expect(json.created).toBeGreaterThan(0);
    const gm = await login(NID.gm);
    const insights = await gm.collection("aiInsights").getFullList();
    const energy = insights.find((i) => i.rule === "energyIntensity");
    expect(energy).toBeTruthy();
    expect(energy.evidence.length).toBeGreaterThan(0);
    expect(energy.title).toMatch(/[0-9]/);
    // Re-running updates instead of duplicating.
    await signed(v1("/insights/run"), { method: "POST", body: {} });
    expect((await gm.collection("aiInsights").getFullList()).length).toBe(insights.length);
  });

  it("accepts external (model) insights", async () => {
    const { json } = await signed(v1("/insights"), {
      method: "POST",
      body: { id: "forecast-7d", category: "energy", title: "پیش‌بینی مصرف هفته آینده", summary: "…", recommendation: "…", confidence: 0.7 },
    });
    const gm = await login(NID.gm);
    expect((await gm.collection("aiInsights").getOne(json.id)).source).toBe("external");
  });

  it("delivers queued events to n8n with signatures n8n can verify", async () => {
    const hk = await login(NID.housekeeper);
    await hk.collection("maintenanceTickets").create({
      hotel: hotelId(), title: "آسانسور شماره ۲ متوقف شد", category: "appliance", priority: "high", area: "لابی",
    });
    let delivered = 1;
    while (delivered > 0) delivered = (await signed("/v1/outbox/flush", { method: "POST", body: {} })).json.delivered;
    const events = await (await fetch(`${inject("n8nUrl")}/received`)).json();
    const ticket = events.find((ev) => ev.type === "maintenance.ticket.created" && ev.data.title === "آسانسور شماره ۲ متوقف شد");
    expect(ticket).toBeTruthy();
    expect(ticket.data.priority).toBe("high");
    expect(events.some((ev) => ev.type === "alert.raised")).toBe(true);
    expect(events.every((ev) => ev.signatureOk)).toBe(true);
  });

  it("delivers each event once when flushes overlap", async () => {
    const hk = await login(NID.housekeeper);
    const titles = ["نشت آب اتاق ۲۰۱", "نشت آب اتاق ۲۰۲", "نشت آب اتاق ۲۰۳"];
    for (const title of titles) {
      await hk.collection("maintenanceTickets").create({ hotel: hotelId(), title, category: "plumbing", priority: "high", area: "طبقه ۲" });
    }
    const flush = () => signed("/v1/outbox/flush", { method: "POST", body: {} });
    const runs = await Promise.all([flush(), flush(), flush(), flush()]);
    expect(runs.every((r) => r.status === 200)).toBe(true);
    let delivered = 1;
    while (delivered > 0) delivered = (await flush()).json.delivered;

    const events = await (await fetch(`${inject("n8nUrl")}/received`)).json();
    for (const title of titles) {
      expect(events.filter((ev) => ev.type === "maintenance.ticket.created" && ev.data.title === title)).toHaveLength(1);
    }
    const bodies = events.map((ev) => ev.raw);
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});
