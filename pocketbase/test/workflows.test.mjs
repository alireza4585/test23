import { describe, expect, it } from "vitest";

import { client, errorOf, hotelId, login, NID, post, roomByNumber } from "./helpers.mjs";

const today = () => new Date(Date.now() + 210 * 60e3).toISOString().slice(0, 10);

describe("housekeeping: one-tap cleaning", () => {
  it("start and finish move the task and the room together", async () => {
    const hk = await login(NID.housekeeper);
    const task = await hk.collection("tasks").getFirstListItem('roomNumber = "102"');
    expect(task.status).toBe("pending");

    await post(hk, `/api/zarin/tasks/${task.id}/transition`, {
      status: "inProgress", roomChange: { roomId: task.room, from: "vacantDirty", to: "cleaningInProgress" },
    });
    expect((await hk.collection("rooms").getOne(task.room)).status).toBe("cleaningInProgress");

    await post(hk, `/api/zarin/tasks/${task.id}/transition`, {
      status: "done", roomChange: { roomId: task.room, from: "cleaningInProgress", to: "vacantClean" },
    });
    const done = await hk.collection("tasks").getOne(task.id);
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBe("");
    expect(done.durationMinutes).toBeGreaterThanOrEqual(0);
    const room = await hk.collection("rooms").getOne(task.room);
    expect(room.status).toBe("vacantClean");
    expect(room.previousStatus).toBe("cleaningInProgress");
  });

  it("rolls back the task when the room change is not allowed", async () => {
    const hk = await login(NID.housekeeper);
    const task = await hk.collection("tasks").getFirstListItem('roomNumber = "107" && status = "pending"');
    const err = await errorOf(post(hk, `/api/zarin/tasks/${task.id}/transition`, {
      status: "inProgress", roomChange: { roomId: task.room, to: "occupied" },
    }));
    expect(err.code).toBe("transition_not_allowed");
    expect((await hk.collection("tasks").getOne(task.id)).status).toBe("pending");
  });

  it("a housekeeper cannot advance someone else's task", async () => {
    const other = await login(NID.housekeeper2);
    const hkm = await login(NID.housekeepingManager);
    const task = await hkm.collection("tasks").getFirstListItem('roomNumber = "107"');
    expect((await errorOf(post(other, `/api/zarin/tasks/${task.id}/transition`, { status: "inProgress" }))).status).toBe(404);
  });

  it("assigning a task notifies the assignee", async () => {
    const hkm = await login(NID.housekeepingManager);
    const hk2 = await login(NID.housekeeper2);
    const room = await roomByNumber(hkm, "305");
    await hkm.collection("tasks").create({
      hotel: hotelId(), day: today(), room: room.id, type: "stayoverClean", status: "pending", priority: "urgent",
      assignee: hk2.authStore.record.id,
    });
    const inbox = await hk2.collection("inbox").getFullList({ sort: "-created" });
    expect(inbox[0].title).toBe("وظیفه جدید نظافت");
    expect(inbox[0].body).toContain("305");
  });
});

describe("maintenance lifecycle", () => {
  it("report → alert → assign → resolve, with notifications and timeline", async () => {
    const hk = await login(NID.housekeeper);
    const mm = await login(NID.maintenanceManager);
    const tech = await login(NID.technician);
    const room = await roomByNumber(hk, "110");
    expect(["vacantClean", "occupied"]).toContain(room.status);
    const vacant = await roomByNumber(hk, "208");

    const ticket = await hk.collection("maintenanceTickets").create({
      hotel: hotelId(), title: "قطعی کامل برق اتاق", category: "electrical", priority: "critical", room: vacant.id,
    });
    expect((await mm.collection("rooms").getOne(vacant.id)).status).toBe("outOfOrder");
    const alert = await mm.collection("alerts").getFirstListItem(`dedupeKey = "ticket_${ticket.id}"`);
    expect(alert.severity).toBe("critical");

    expect((await errorOf(post(tech, `/api/zarin/tickets/${ticket.id}/status`, { to: "inProgress" }))).status).toBe(404);
    await post(mm, `/api/zarin/tickets/${ticket.id}/assign`, { assigneeId: tech.authStore.record.id });
    expect((await tech.collection("inbox").getFullList({ sort: "-created" }))[0].title).toBe("تیکت جدید به شما ارجاع شد");

    await post(tech, `/api/zarin/tickets/${ticket.id}/status`, { to: "inProgress" });
    expect((await errorOf(post(tech, `/api/zarin/tickets/${ticket.id}/status`, { to: "closed" }))).code).toBe("transition_not_allowed");
    await post(tech, `/api/zarin/tickets/${ticket.id}/status`, { to: "resolved", note: "فیوز تعویض شد" });

    const resolved = await mm.collection("maintenanceTickets").getOne(ticket.id);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionNote).toBe("فیوز تعویض شد");
    expect((await mm.collection("alerts").getOne(alert.id)).status).toBe("resolved");
    expect((await hk.collection("inbox").getFullList({ sort: "-created" }))[0].title).toBe("خرابی گزارش‌شده رفع شد");

    const events = await hk.collection("ticketEvents").getFullList({ filter: `ticket = "${ticket.id}"`, sort: "created" });
    expect(events.map((e) => e.type)).toEqual(["created", "assigned", "statusChanged", "statusChanged"]);
  });
});

describe("inventory ledger", () => {
  it("applies movements atomically and raises / clears low-stock alerts", async () => {
    const hkm = await login(NID.housekeepingManager);
    const inv = await login(NID.inventory);
    const item = await inv.collection("inventoryItems").getFirstListItem('sku = "LN-SH02"');
    expect(item.quantity).toBe(260);

    expect((await errorOf(post(hkm, `/api/zarin/inventory/${item.id}/movements`, { type: "issue", delta: -261 }))).code)
      .toBe("insufficient_stock");
    await post(hkm, `/api/zarin/inventory/${item.id}/movements`, { type: "issue", delta: -150, reason: "تعویض ملحفه" });
    const low = await inv.collection("alerts").getFirstListItem(`dedupeKey = "lowstock_${item.id}"`);
    expect(low.status).toBe("open");

    await post(inv, `/api/zarin/inventory/${item.id}/movements`, { type: "receive", delta: 300 });
    expect((await inv.collection("alerts").getOne(low.id)).status).toBe("resolved");

    const after = await inv.collection("inventoryItems").getOne(item.id);
    expect(after.quantity).toBe(410);
    const ledger = await inv.collection("inventoryMovements").getFullList({ filter: `item = "${item.id}"`, sort: "created" });
    expect(ledger.map((m) => [m.quantityBefore, m.delta, m.quantityAfter])).toEqual([[260, -150, 110], [110, 300, 410]]);
    expect(after.lastMovement).toBe(ledger[1].id);
  });

  it("rejects movements from roles without inventory.move", async () => {
    const reception = await login(NID.reception);
    const inv = await login(NID.inventory);
    const item = (await inv.collection("inventoryItems").getFullList())[0];
    expect((await errorOf(post(reception, `/api/zarin/inventory/${item.id}/movements`, { type: "issue", delta: -1 }))).status)
      .toBe(403);
  });
});

describe("user administration", () => {
  it("HR provisions staff; the new user must change the temporary password", async () => {
    const hr = await login(NID.hr);
    const { uid } = await post(hr, "/api/zarin/users", {
      hotelId: hotelId(), nationalId: "۰۲۰۱۳۱۳۷۵۸", fullName: "پرستو امینی", role: "housekeepingStaff", temporaryPassword: "Temp-2026a",
    });
    expect(uid).toBeTruthy();

    const fresh = await login("0201313758", "Temp-2026a");
    const me = await fresh.send("/api/zarin/me", {});
    expect(me.mustChangePassword).toBe(true);
    expect(me.permissions).toContain("housekeeping.viewOwn");
    expect(me.staffId).toBeTruthy();

    await fresh.collection("users").update(uid, { oldPassword: "Temp-2026a", password: "Mine-2026b", passwordConfirm: "Mine-2026b" });
    const again = await login("0201313758", "Mine-2026b");
    expect((await again.send("/api/zarin/me", {})).mustChangePassword).toBe(false);
  });

  it("enforces who may assign which role", async () => {
    const hr = await login(NID.hr);
    const gm = await login(NID.gm);
    const body = { hotelId: hotelId(), nationalId: "0201392941", fullName: "مدیر جدید", temporaryPassword: "Temp-2026a" };
    expect((await errorOf(post(hr, "/api/zarin/users", { ...body, role: "generalManager" }))).code).toBe("role_not_assignable");
    expect((await errorOf(post(gm, "/api/zarin/users", { ...body, role: "hotelOwner" }))).code).toBe("role_not_assignable");
    expect((await errorOf(post(hr, "/api/zarin/users", { ...body, nationalId: "0201392940", role: "receptionStaff" }))).code)
      .toBe("invalid_national_id");
    expect((await errorOf(post(hr, "/api/zarin/users", { ...body, nationalId: NID.reception, role: "receptionStaff" }))).code)
      .toBe("national_id_exists");
    expect((await errorOf(post(hr, "/api/zarin/users", { ...body, role: "receptionStaff", temporaryPassword: "short" }))).code)
      .toBe("weak_password");
  });

  it("suspending a user blocks sign-in and invalidates existing sessions", async () => {
    const hr = await login(NID.hr);
    const { uid } = await post(hr, "/api/zarin/users", {
      hotelId: hotelId(), nationalId: "0201472139", fullName: "کارمند موقت", role: "restaurantStaff", temporaryPassword: "Temp-2026a",
    });
    const temp = await login("0201472139", "Temp-2026a");
    await post(hr, `/api/zarin/users/${uid}/status`, { hotelId: hotelId(), status: "suspended" });

    expect((await errorOf(temp.send("/api/zarin/me", {}))).status).toBe(401);
    expect((await errorOf(client().collection("users").authWithPassword("0201472139", "Temp-2026a"))).status).toBe(403);
    expect((await errorOf(post(hr, `/api/zarin/users/${hr.authStore.record.id}/status`, { hotelId: hotelId(), status: "suspended" }))).code)
      .toBe("cannot_manage_user");
  });

  it("role changes re-derive permissions on the server", async () => {
    const gm = await login(NID.gm);
    const { uid } = await post(gm, "/api/zarin/users", {
      hotelId: hotelId(), nationalId: "0201551322", fullName: "انباردار", role: "restaurantStaff", temporaryPassword: "Temp-2026a",
    });
    await post(gm, `/api/zarin/users/${uid}/role`, { hotelId: hotelId(), role: "inventoryManager" });
    const user = await login("0201551322", "Temp-2026a");
    const me = await user.send("/api/zarin/me", {});
    expect(me.role).toBe("inventoryManager");
    expect(me.permissions).toContain("inventory.manage");
  });

  it("registers device sessions and signs out everywhere", async () => {
    const pb = await login(NID.analyst);
    await post(pb, "/api/zarin/sessions", { deviceId: "device-analyst-1", platform: "android", model: "Pixel", appVersion: "1.0.0" });
    const sessions = await pb.collection("sessions").getFullList();
    expect(sessions.map((s) => s.deviceId)).toContain("device-analyst-1");
    const { revoked } = await post(pb, "/api/zarin/sessions/revoke", {});
    expect(revoked).toBeGreaterThanOrEqual(1);
    expect((await errorOf(pb.send("/api/zarin/me", {}))).status).toBe(401);
  });
});

describe("audit & alerts", () => {
  it("records client changes with a field diff", async () => {
    const gm = await login(NID.gm);
    const room = await roomByNumber(gm, "502");
    await gm.collection("rooms").update(room.id, { note: "تعویض فرش" });
    const log = await gm.collection("auditLogs").getFirstListItem(`resourceId = "${room.id}" && action = "rooms.update"`);
    expect(log.actor.role).toBe("generalManager");
    expect(log.changes.note).toEqual({ from: "", to: "تعویض فرش" });
  });

  it("an energy reading above baseline raises an alert", async () => {
    const energy = await login(NID.energy);
    const reading = await energy.collection("energyReadings").create({
      hotel: hotelId(), type: "gas", day: today(), consumption: 520, source: "smartMeter",
    });
    expect(reading.source).toBe("manual");
    expect(reading.unit).toBe("m³");
    expect(reading.recordedBy).toBe(energy.authStore.record.id);
    const alert = await energy.collection("alerts").getFirstListItem(`dedupeKey = "energy_${today()}_gas"`);
    expect(alert.severity).toBe("critical");
  });
});

describe("AI assistant", () => {
  it("answers from hotel data (rule-based when no LLM is configured)", async () => {
    const gm = await login(NID.gm);
    const reply = await post(gm, "/api/zarin/ai/ask", { hotelId: hotelId(), question: "چرا مصرف برق زیاد شده؟", locale: "fa" });
    expect(reply.model).toBe("rules");
    expect(reply.answer).toContain("برق");
    expect(reply.answer).toMatch(/[۰-۹]/);
    expect(reply.dataPoints).toHaveLength(3);
  });

  it("is limited to roles with ai.assistant.use", async () => {
    const hk = await login(NID.housekeeper);
    expect((await errorOf(post(hk, "/api/zarin/ai/ask", { hotelId: hotelId(), question: "سلام" }))).code).toBe("missing_permission");
  });
});
