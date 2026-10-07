import { describe, expect, it } from "vitest";

import { client, errorOf, hotelId, login, NID, superuser } from "./helpers.mjs";

/** A valid national ID from 9 digits (Iranian check-digit rule). */
function nationalId(nine) {
  const sum = [...nine].reduce((s, d, i) => s + Number(d) * (10 - i), 0) % 11;
  return `${nine}${sum < 2 ? sum : 11 - sum}`;
}

const importRecords = (pb, body) => pb.send("/api/zarin/admin/import", { method: "POST", body });

describe("superuser import into a trial hotel", () => {
  it("refuses production hotels, other collections and non-superusers", async () => {
    const su = await superuser();
    const seeded = await su.collection("hotels").getOne(hotelId());
    expect(seeded.status).not.toBe("trial");
    expect((await errorOf(importRecords(su, { hotel: hotelId(), collection: "rooms", records: [{ fields: { number: "X1", status: "vacantClean" } }] }))).code)
      .toBe("import_requires_trial_hotel");
    const trial = await su.collection("hotels").create({ name: "Import guard", status: "trial", settings: {} });
    expect((await errorOf(importRecords(su, { hotel: trial.id, collection: "users", records: [{ fields: {} }] }))).code).toBe("collection_not_importable");
    expect((await errorOf(importRecords(su, { hotel: trial.id, collection: "rooms", records: [{ fields: { number: "X1", status: "vacantClean" }, created: "yesterday" }] }))).code)
      .toBe("invalid_timestamp");
    const gm = await login(NID.gm);
    expect((await errorOf(importRecords(gm, { hotel: trial.id, collection: "rooms", records: [{ fields: { number: "X1", status: "vacantClean" } }] }))).status)
      .toBeGreaterThanOrEqual(401);
    expect((await errorOf(importRecords(client(), { hotel: trial.id, collection: "rooms", records: [{ fields: { number: "X1", status: "vacantClean" } }] }))).status)
      .toBe(401);
  });

  it("keeps history quiet and dated, while live writes still alert", async () => {
    const su = await superuser();
    const hotel = await su.collection("hotels").create({
      name: "Import test", status: "trial",
      settings: { energyDailyBaseline: { electricity: 1000, water: 10, gas: 10 } },
    });
    const H = hotel.id;
    const [roomId] = (await importRecords(su, {
      hotel: H, collection: "rooms",
      records: [{ fields: { number: "101", floor: 1, type: "double", status: "vacantClean" }, updated: "2026-10-01 08:00:00.000Z" }],
    })).ids;
    expect((await su.collection("rooms").getOne(roomId)).updated).toBe("2026-10-01 08:00:00.000Z");

    // A critical ticket in a vacant room and an energy spike, imported as history.
    const [ticketId] = (await importRecords(su, {
      hotel: H, collection: "maintenanceTickets",
      records: [{
        fields: { title: "Chiller trip", category: "hvac", priority: "critical", status: "inProgress", room: roomId, roomNumber: "101", slaDueAt: "2025-10-07 04:09:04.512Z" },
        created: "2025-10-07 02:09:04.512Z",
      }],
    })).ids;
    await importRecords(su, { hotel: H, collection: "energyReadings", records: [{ fields: { type: "electricity", day: "2025-10-07", consumption: 5000, unit: "kWh", source: "smartMeter" } }] });
    const ticket = await su.collection("maintenanceTickets").getOne(ticketId);
    expect(ticket.created).toBe("2025-10-07 02:09:04.512Z");
    expect(ticket.updated).toBe("2025-10-07 02:09:04.512Z");
    expect((await su.collection("alerts").getList(1, 1, { filter: `hotel = "${H}"` })).totalItems).toBe(0);
    expect((await su.collection("ticketEvents").getList(1, 1, { filter: `ticket = "${ticketId}"` })).totalItems).toBe(0);
    expect((await su.collection("rooms").getOne(roomId)).status).toBe("vacantClean");
    const log = await su.collection("auditLogs").getFirstListItem(`hotel = "${H}" && action = "import.maintenanceTickets"`);
    expect(log.changes).toEqual({ mode: "create", count: 1 });

    // A live ticket through the app API alerts as usual; closing it through
    // the importer resolves that alert, as the status route would.
    const nine = String(Date.now()).slice(-9);
    const tech = await su.collection("users").create({
      nationalId: nationalId(nine), fullName: "Import tester", role: "maintenanceManager", hotels: [H], primaryHotel: H,
      status: "active", password: "Import-2026a", passwordConfirm: "Import-2026a",
    });
    const asTech = await su.collection("users").impersonate(tech.id, 600);
    const live = await asTech.collection("maintenanceTickets").create({ hotel: H, title: "Pump failure", category: "plumbing", priority: "high", area: "Plant room" });
    const alert = await su.collection("alerts").getFirstListItem(`hotel = "${H}" && dedupeKey = "ticket_${live.id}"`);
    expect(alert.status).toBe("open");
    await importRecords(su, {
      hotel: H, collection: "maintenanceTickets", mode: "update",
      records: [{ id: live.id, fields: { status: "closed", resolvedAt: "2026-10-02 10:00:00.000Z" }, created: "2026-10-02 06:00:00.000Z" }],
    });
    expect((await su.collection("alerts").getOne(alert.id)).status).toBe("resolved");
    const updated = await su.collection("maintenanceTickets").getOne(live.id);
    expect(updated.created).toBe("2026-10-02 06:00:00.000Z");
    expect(updated.status).toBe("closed");

    // Updates only reach records of the same hotel.
    const otherRoom = (await su.collection("rooms").getList(1, 1, { filter: `hotel = "${hotelId()}"` })).items[0];
    expect((await errorOf(importRecords(su, { hotel: H, collection: "rooms", mode: "update", records: [{ id: otherRoom.id, fields: { note: "x" } }] }))).code)
      .toBe("other_hotel");
  });

  it("runs rollup, insights and the SLA check on demand", async () => {
    const su = await superuser();
    const res = await su.send(`/api/zarin/admin/hotels/${hotelId()}/analytics`, {
      method: "POST", body: { rollup: { from: "2026-01-01", to: "2026-01-03" }, insights: true, sla: true, now: "2026-01-04T06:00:00Z" },
    });
    expect(res.rolledUp).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(typeof res.insightsCreated).toBe("number");
    expect(res.now).toBe("2026-01-04T06:00:00.000Z");
    expect((await su.collection("dailyMetrics").getList(1, 1, { filter: `hotel = "${hotelId()}" && day = "2026-01-02"` })).totalItems).toBe(1);
    const gm = await login(NID.gm);
    expect((await errorOf(gm.send(`/api/zarin/admin/hotels/${hotelId()}/analytics`, { method: "POST", body: { sla: true } }))).status)
      .toBeGreaterThanOrEqual(401);
  });

  it("insights see the last week's tasks however many older tasks there are", async () => {
    const su = await superuser();
    const H = (await su.collection("hotels").create({ name: "Big hotel", status: "trial", settings: {} })).id;
    const task = (day, start, minutes) => ({
      fields: {
        kind: "housekeeping", day, roomNumber: "101", type: "checkoutClean", status: "done", priority: "normal",
        startedAt: `${day} ${start}:00.000Z`, completedAt: new Date(Date.parse(`${day}T${start}:00Z`) + minutes * 6e4).toISOString().replace("T", " "),
      },
    });
    // 30 days of a 475-room hotel: more tasks than one query returns. On time, except the last week's.
    const old = Array.from({ length: 10500 }, (_, i) => task(`2026-09-${String(10 + (i % 18)).padStart(2, "0")}`, "08:00", 35));
    for (let i = 0; i < old.length; i += 500) await importRecords(su, { hotel: H, collection: "tasks", records: old.slice(i, i + 500) });
    await importRecords(su, { hotel: H, collection: "tasks", records: Array.from({ length: 8 }, (_, i) => task(`2026-10-0${1 + (i % 6)}`, "09:00", 50)) });
    await su.send(`/api/zarin/admin/hotels/${H}/analytics`, { method: "POST", body: { insights: true, now: "2026-10-07T06:00:00Z" } });
    const insight = await su.collection("aiInsights").getFirstListItem(`hotel = "${H}" && rule = "hkEfficiency"`);
    expect(insight.title).toContain("43٪"); // 50 min against the 35-minute target
  }, 120000);
});
