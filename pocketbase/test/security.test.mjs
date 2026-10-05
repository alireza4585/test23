import { beforeAll, describe, expect, it } from "vitest";

import { client, errorOf, hotelId, login, NID, post, roomByNumber, superuser } from "./helpers.mjs";

describe("authentication", () => {
  it("signs in with the national ID and never returns it", async () => {
    const pb = await login(NID.housekeeper);
    const me = await pb.send("/api/zarin/me", {});
    expect(me.role).toBe("housekeepingStaff");
    expect(me.permissions).toContain("housekeeping.complete");
    expect(me.permissions).not.toContain("energy.view");
    expect(me.nationalIdMasked).toBe("010•••••78");
    expect(JSON.stringify(pb.authStore.record)).not.toContain(NID.housekeeper);
  });

  it("rejects a wrong password and unknown IDs alike", async () => {
    const wrong = await errorOf(client().collection("users").authWithPassword(NID.gm, "nope-123456"));
    const unknown = await errorOf(client().collection("users").authWithPassword("0000000001", "nope-123456"));
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
  });
});

describe("tenant isolation", () => {
  let otherHotel;
  let otherGm;

  beforeAll(async () => {
    const su = await superuser();
    otherHotel = await su.collection("hotels").create({ name: "Other hotel", status: "active" });
    await su.collection("rooms").create({ hotel: otherHotel.id, number: "101", status: "vacantClean" });
    await su.collection("users").create({
      nationalId: "0201234564", fullName: "Other GM", role: "generalManager", hotels: [otherHotel.id],
      primaryHotel: otherHotel.id, status: "active", password: "Other-Pass-1", passwordConfirm: "Other-Pass-1",
    });
    otherGm = await login("0201234564", "Other-Pass-1");
  });

  it("users only see their own hotel's data", async () => {
    const gm = await login(NID.gm);
    expect((await gm.collection("rooms").getList(1, 1)).totalItems).toBe(60);
    expect((await otherGm.collection("rooms").getList(1, 1)).totalItems).toBe(1);
    expect((await otherGm.collection("maintenanceTickets").getList(1, 1)).totalItems).toBe(0);
    expect((await otherGm.collection("users").getFullList()).map((u) => u.fullName)).toEqual(["Other GM"]);
  });

  it("cannot write into another hotel", async () => {
    const err = await errorOf(otherGm.collection("rooms").create({ hotel: hotelId(), number: "999", status: "vacantClean" }));
    expect(err.status).toBe(400);
  });

  it("cannot link records across hotels", async () => {
    const gm = await login(NID.gm);
    const foreignRoom = await otherGm.collection("rooms").getFirstListItem('number = "101"');
    const err = await errorOf(gm.collection("tasks").create({
      hotel: hotelId(), day: "2026-10-05", room: foreignRoom.id, type: "checkoutClean", status: "pending",
    }));
    expect(err.code).toBe("cross_hotel_reference");
  });
});

describe("role-based access", () => {
  it("staff only see what their role allows", async () => {
    const hk = await login(NID.housekeeper);
    const tasks = await hk.collection("tasks").getFullList();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.assignee === hk.authStore.record.id)).toBe(true);
    for (const col of ["energyReadings", "dailyOperations", "inventoryItems", "auditLogs", "dailyMetrics", "aiInsights"]) {
      expect((await hk.collection(col).getList(1, 1)).totalItems, col).toBe(0);
    }
    expect((await hk.collection("users").getFullList()).length).toBe(1);
  });

  it("managers see colleagues in the user directory, without national IDs", async () => {
    const hr = await login(NID.hr);
    const users = await hr.collection("users").getFullList();
    expect(users.length).toBeGreaterThanOrEqual(15);
    expect(users.every((u) => u.hotels.includes(hotelId()))).toBe(true);
    expect(users.every((u) => u.nationalId === undefined && /•/.test(u.nationalIdMasked))).toBe(true);
  });

  it("alerts are filtered by audience role", async () => {
    const gm = await login(NID.gm);
    const hk = await login(NID.housekeeper);
    const mm = await login(NID.maintenanceManager);
    expect((await gm.collection("alerts").getFullList()).length).toBeGreaterThan(0);
    expect((await hk.collection("alerts").getFullList()).length).toBe(0);
    const mmAlerts = await mm.collection("alerts").getFullList();
    expect(mmAlerts.every((a) => a.audienceRoles.includes("maintenanceManager"))).toBe(true);
  });

  it("nobody can grant themselves a role, permissions or hotels", async () => {
    const hk = await login(NID.housekeeper);
    const id = hk.authStore.record.id;
    for (const patch of [{ role: "generalManager" }, { permissions: [] }, { hotels: [] }, { status: "active" }, { mustChangePassword: false }]) {
      const err = await errorOf(hk.collection("users").update(id, patch));
      expect(err.code, JSON.stringify(patch)).toBe("field_not_allowed");
    }
    expect((await hk.send("/api/zarin/me", {})).role).toBe("housekeepingStaff");
  });

  it("room transitions follow the role policy", async () => {
    const hk = await login(NID.housekeeper);
    const reception = await login(NID.reception);
    const dirty = await roomByNumber(hk, "107");
    const clean = await roomByNumber(hk, "110");
    expect((await post(hk, `/api/zarin/rooms/${dirty.id}/status`, { to: "cleaningInProgress" })).status).toBe("cleaningInProgress");
    expect((await errorOf(post(hk, `/api/zarin/rooms/${clean.id}/status`, { to: "occupied" }))).code).toBe("transition_not_allowed");
    expect((await post(reception, `/api/zarin/rooms/${clean.id}/status`, { to: "occupied" })).status).toBe("occupied");
    expect((await errorOf(post(reception, `/api/zarin/rooms/${dirty.id}/status`, { to: "vacantClean" }))).code).toBe("transition_not_allowed");
    expect((await errorOf(post(hk, `/api/zarin/rooms/${dirty.id}/status`, { to: "vacantClean", from: "vacantDirty" }))).code).toBe("stale_room_status");
  });

  it("staff cannot edit rooms directly", async () => {
    const hk = await login(NID.housekeeper);
    const room = await roomByNumber(hk, "301");
    await expect(hk.collection("rooms").update(room.id, { status: "vacantClean" })).rejects.toBeTruthy();
  });

  it("stock can only change through the ledger", async () => {
    const inv = await login(NID.inventory);
    const item = (await inv.collection("inventoryItems").getFullList())[0];
    expect((await errorOf(inv.collection("inventoryItems").update(item.id, { quantity: 9999 }))).code).toBe("use_stock_movement");
  });

  it("ticket fields are stamped by the server", async () => {
    const hk = await login(NID.housekeeper);
    const room = await roomByNumber(hk, "303");
    const t = await hk.collection("maintenanceTickets").create({
      hotel: hotelId(), title: "شیر آب چکه می‌کند", category: "plumbing", priority: "low", room: room.id,
      status: "closed", assignee: hk.authStore.record.id, reportedBy: "someone-else", slaDueAt: "2030-01-01 00:00:00.000Z",
    });
    expect(t.status).toBe("open");
    expect(t.assignee).toBe("");
    expect(t.reportedBy).toBe(hk.authStore.record.id);
    expect(t.roomNumber).toBe("303");
    const due = new Date(t.slaDueAt.replace(" ", "T")).getTime();
    expect(Math.abs(due - (Date.now() + 72 * 3600e3))).toBeLessThan(60e3);
  });

  it("staff without permission cannot use admin routes", async () => {
    const hk = await login(NID.housekeeper);
    const err = await errorOf(post(hk, "/api/zarin/users", {
      hotelId: hotelId(), nationalId: "0011223344", fullName: "x y z", role: "housekeepingStaff", temporaryPassword: "Temp-1234",
    }));
    expect(err.code).toBe("missing_permission");
  });
});
