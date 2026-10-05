/**
 * End-to-end checks of the Cloud Functions code against the Auth + Firestore
 * emulators with the seeded demo hotel. Handlers are invoked through the v2
 * `.run()` entry points (the same code the Functions runtime executes).
 *
 *   npm run test:integration
 */
import { CallableRequest } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";

import { adminCreateUser, adminSetUserStatus } from "../../src/admin/users";
import { runInsightsForHotel } from "../../src/analytics/scheduled";
import { authRegisterSession } from "../../src/auth/sessions";
import { auth, dayKey, db } from "../../src/lib/admin";
import { auditHotelWrites } from "../../src/triggers/audit";
import { onEnergyReadingWritten, onTicketCreated } from "../../src/triggers/operations";

const HOTEL = "zarin-grand-tehran";
const email = (nid: string) => `${nid}@id.zarinhooshmand.app`;

async function caller(nid: string) {
  const user = await auth.getUserByEmail(email(nid));
  return { uid: user.uid, token: { ...user.customClaims, uid: user.uid } };
}

function callable<T>(who: Awaited<ReturnType<typeof caller>>, data: T): CallableRequest<T> {
  return { data, auth: { uid: who.uid, token: who.token as never, rawToken: "" }, rawRequest: {} as never, acceptsStreaming: false };
}

describe("Zarin backend against emulators", () => {
  it("seeded accounts carry role + tenant claims", async () => {
    const hk = await caller("0102345678");
    expect(hk.token.role).toBe("housekeepingStaff");
    expect(hk.token.hotelIds).toEqual([HOTEL]);
  });

  it("registers a device session and stamps last login", async () => {
    const hk = await caller("0102345678");
    await authRegisterSession.run(callable(hk, { deviceId: "device-hk-0001", platform: "android", model: "Pixel 9" }));
    const session = await db.doc(`users/${hk.uid}/sessions/device-hk-0001`).get();
    expect(session.get("platform")).toBe("android");
    const member = await db.doc(`hotels/${HOTEL}/members/${hk.uid}`).get();
    expect(member.get("lastLoginAt")).toBeTruthy();
  });

  it("GM provisions staff by national ID; HR cannot escalate; duplicates are rejected", async () => {
    const gm = await caller("0012345679");
    const created = await adminCreateUser.run(callable(gm, {
      hotelId: HOTEL, nationalId: "0179123459", fullName: "کارمند جدید", role: "housekeepingStaff", temporaryPassword: "Temp1234x",
    }));
    const user = await auth.getUser(created.uid);
    expect(user.email).toBe(email("0179123459"));
    expect(user.customClaims).toMatchObject({ role: "housekeepingStaff", hotelIds: [HOTEL] });
    expect((await db.doc(`users/${created.uid}`).get()).get("mustChangePassword")).toBe(true);

    await expect(adminCreateUser.run(callable(gm, {
      hotelId: HOTEL, nationalId: "0179123459", fullName: "Dup", role: "housekeepingStaff", temporaryPassword: "Temp1234x",
    }))).rejects.toMatchObject({ code: "invalid-argument" });

    const hr = await caller("0089123451");
    await expect(adminCreateUser.run(callable(hr, {
      hotelId: HOTEL, nationalId: "0181234564", fullName: "Escalation", role: "generalManager", temporaryPassword: "Temp1234x",
    }))).rejects.toMatchObject({ code: "permission-denied" });

    await adminSetUserStatus.run(callable(gm, { hotelId: HOTEL, uid: created.uid, status: "suspended" }));
    expect((await auth.getUser(created.uid)).disabled).toBe(true);
  });

  it("critical fault → alert + manager inbox + room taken out of order", async () => {
    const hk = await caller("0102345678");
    const ref = db.doc(`hotels/${HOTEL}/maintenanceTickets/smoke-critical`);
    await ref.set({
      title: "Burst pipe", category: "plumbing", priority: "critical", status: "open",
      reportedById: hk.uid, reportedByName: "فاطمه حسینی", roomId: "room-102", roomNumber: "102",
      photoPaths: [], createdAt: new Date(),
    });
    await onTicketCreated.run({ data: await ref.get(), params: { hotelId: HOTEL, ticketId: "smoke-critical" } } as never);

    const alert = await db.doc(`hotels/${HOTEL}/alerts/ticket_smoke-critical`).get();
    expect(alert.get("severity")).toBe("critical");
    expect(alert.get("audienceRoles")).toContain("maintenanceManager");
    expect((await db.doc(`hotels/${HOTEL}/rooms/room-102`).get()).get("status")).toBe("outOfOrder");
    const mm = await caller("0056789122");
    const inbox = await db.collection(`users/${mm.uid}/inbox`).get();
    expect(inbox.size).toBeGreaterThan(0);

    // Idempotent: a retried trigger must not raise a second alert / notification.
    await onTicketCreated.run({ data: await ref.get(), params: { hotelId: HOTEL, ticketId: "smoke-critical" } } as never);
    expect((await db.collection(`users/${mm.uid}/inbox`).get()).size).toBe(inbox.size);
  });

  it("energy reading above baseline raises an energy alert", async () => {
    const ref = db.doc(`hotels/${HOTEL}/energyReadings/2030-01-01_electricity`);
    await ref.set({ type: "electricity", unit: "kWh", day: "2030-01-01", consumption: 3600, source: "manual" });
    const snap = await ref.get();
    await onEnergyReadingWritten.run({ data: { before: snap, after: snap }, params: { hotelId: HOTEL, readingId: snap.id } } as never);
    const alert = await db.doc(`hotels/${HOTEL}/alerts/energy_2030-01-01_electricity`).get();
    expect(alert.get("type")).toBe("energySpike");
  });

  it("audit trigger records the real principal and field diff", async () => {
    const ref = db.doc(`hotels/${HOTEL}/rooms/room-101`);
    const before = await ref.get();
    await ref.update({ status: "occupied" });
    const after = await ref.get();
    await auditHotelWrites.run({
      data: { before, after },
      params: { hotelId: HOTEL, collectionId: "rooms", docId: "room-101" },
      authType: "unknown",
      authId: "uid-from-token",
    } as never);
    const logs = await db.collection(`hotels/${HOTEL}/auditLogs`).where("action", "==", "rooms.update").get();
    const entry = logs.docs.find((d) => d.get("resource").id === "room-101")!;
    expect(entry.get("actor").uid).toBe("uid-from-token");
    expect(entry.get("changes").status).toEqual({ from: "vacantClean", to: "occupied" });
  });

  it("rule engine turns seeded history into explainable insights", async () => {
    await runInsightsForHotel(HOTEL, dayKey(new Date()), new Date());
    const insight = await db.doc(`hotels/${HOTEL}/aiInsights/energyIntensity_electricity`).get();
    expect(insight.exists).toBe(true);
    expect(insight.get("evidence").length).toBeGreaterThan(0);
    expect(insight.get("status")).toBe("active");
  });
});
