// AI phase 2, P2.0: permissions per active hotel. A user who belongs to two
// hotels works in one at a time; permissions (financeView included) follow the
// override of the active hotel, and REST, realtime-backed lists and routes see
// only the active hotel. Synthetic users and a throw-away second hotel.
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { errorOf, hotelId, login, post, superuser } from "./helpers.mjs";

const NID_MULTI = "2".repeat(9) + "1";
// Generated per run: no password is written into the repository.
const PASSWORD = `Mh-${randomBytes(6).toString("hex")}-a1`;
const DAY = "2025-06-14";

let su;
let h2;
let user;
let override;
beforeAll(async () => {
  su = await superuser();
  h2 = await su.collection("hotels").create({ name: "هتل دوم آزمایشی", status: "trial", settings: {} });
  // The second hotel does not let its general manager see revenue.
  const gmPerms = await su.collection("permissions").getFullList({ filter: `code != "finance.view"` });
  override = await su.collection("roleOverrides").create({ hotel: h2.id, role: "generalManager", permissions: gmPerms.map((p) => p.id) });
  await su.collection("rooms").create({ hotel: h2.id, number: "H2-101", floor: 1, type: "double", status: "vacantClean" });
  await su.collection("dailyFinance").create({ hotel: h2.id, day: DAY, roomRevenue: 1000, fnbRevenue: 0, otherRevenue: 0 });
  await su.collection("dailyFinance").create({ hotel: hotelId(), day: DAY, roomRevenue: 2000, fnbRevenue: 0, otherRevenue: 0 });
  user = await su.collection("users").create({
    nationalId: NID_MULTI, fullName: "مدیرکل دو هتل", role: "generalManager", hotels: [hotelId(), h2.id], primaryHotel: hotelId(),
    status: "active", password: PASSWORD, passwordConfirm: PASSWORD,
  });
});
afterAll(async () => {
  if (user) await su.collection("users").delete(user.id).catch(() => {});
  for (const f of await su.collection("dailyFinance").getFullList({ filter: `day = "${DAY}"` })) await su.collection("dailyFinance").delete(f.id);
  if (override) await su.collection("roleOverrides").delete(override.id).catch(() => {});
  if (h2) await su.collection("hotels").delete(h2.id).catch(() => {});
});

const hotelsOf = (records) => [...new Set(records.map((r) => r.hotel))].sort();

describe("P2.0 active hotel", () => {
  it("a new user starts in the primary hotel, with that hotel's permissions", async () => {
    expect(user.activeHotel).toBe(hotelId());
    expect(user.financeView).toBe(true);
    const pb = await login(NID_MULTI, PASSWORD);
    const me = await pb.send("/api/zarin/me", {});
    expect(me).toMatchObject({ activeHotel: hotelId(), hotels: [hotelId(), h2.id] });
    expect(me.permissions).toContain("finance.view");
    // Records of the active hotel only, although the user belongs to both.
    expect(hotelsOf(await pb.collection("rooms").getFullList())).toEqual([hotelId()]);
    expect(hotelsOf(await pb.collection("dailyFinance").getFullList({ filter: `day = "${DAY}"` }))).toEqual([hotelId()]);
    // Both hotels are listed, so the app can offer the switch.
    expect((await pb.collection("hotels").getFullList()).map((h) => h.id).sort()).toEqual([hotelId(), h2.id].sort());
    // Routes refuse the other hotel until the user switches.
    const other = await errorOf(post(pb, "/api/zarin/operations/daily", { hotelId: h2.id, day: DAY, roomsAvailable: 10, roomsOccupied: 5 }));
    expect([other.status, other.code]).toEqual([403, "hotel_not_active"]);
  });

  it("switching recomputes the permissions from the second hotel's override, at once", async () => {
    const pb = await login(NID_MULTI, PASSWORD);
    const me = await post(pb, "/api/zarin/me/active-hotel", { hotelId: h2.id });
    expect(me.activeHotel).toBe(h2.id);
    expect(me.permissions).not.toContain("finance.view");
    expect((await su.collection("users").getOne(user.id)).financeView).toBe(false);
    // Same token, next request: the second hotel's rooms, no revenue anywhere.
    expect(hotelsOf(await pb.collection("rooms").getFullList())).toEqual([h2.id]);
    expect(await pb.collection("dailyFinance").getFullList({ filter: `day = "${DAY}"` })).toEqual([]);
    const first = await errorOf(post(pb, "/api/zarin/operations/daily", { hotelId: hotelId(), day: DAY, roomsAvailable: 10, roomsOccupied: 5 }));
    expect(first.code).toBe("hotel_not_active");
    const audit = await su.collection("auditLogs").getFirstListItem(`action = "users.activeHotel" && resourceId = "${user.id}"`);
    expect(audit.changes).toEqual({ from: hotelId(), to: h2.id });
    // And back: finance.view returns with the first hotel.
    expect((await post(pb, "/api/zarin/me/active-hotel", { hotelId: hotelId() })).permissions).toContain("finance.view");
    expect(hotelsOf(await pb.collection("dailyFinance").getFullList({ filter: `day = "${DAY}"` }))).toEqual([hotelId()]);
  });

  it("only member hotels; the field cannot be set through REST", async () => {
    const pb = await login(NID_MULTI, PASSWORD);
    const stranger = await su.collection("hotels").create({ name: "هتل بیگانه", status: "trial", settings: {} });
    try {
      const r = await errorOf(post(pb, "/api/zarin/me/active-hotel", { hotelId: stranger.id }));
      expect([r.status, r.code]).toEqual([403, "not_hotel_member"]);
      const patch = await errorOf(pb.collection("users").update(user.id, { activeHotel: h2.id }));
      expect(patch.status).toBe(400);
      expect((await su.collection("users").getOne(user.id)).activeHotel).toBe(hotelId());
    } finally {
      await su.collection("hotels").delete(stranger.id);
    }
  });

  it("leaving the active hotel falls back to the primary hotel", async () => {
    const pb = await login(NID_MULTI, PASSWORD);
    await post(pb, "/api/zarin/me/active-hotel", { hotelId: h2.id });
    const after = await su.collection("users").update(user.id, { hotels: [hotelId()] });
    expect(after.activeHotel).toBe(hotelId());
    expect(after.financeView).toBe(true);
    expect(hotelsOf(await pb.collection("rooms").getFullList())).toEqual([hotelId()]);
  });

  it("every hotel rule reads the active hotel, none the membership list (except listing hotels)", async () => {
    const left = [];
    for (const c of await su.collections.getFullList()) {
      for (const k of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
        const rule = c[k] || "";
        if (!rule.includes("@request.auth.hotels")) continue;
        if (c.name === "hotels" && (k === "listRule" || k === "viewRule")) continue;
        left.push(`${c.name}.${k}`);
      }
    }
    expect(left).toEqual([]);
  });
});
