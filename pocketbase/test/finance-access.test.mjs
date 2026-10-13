// AI phase 0.5: revenue is readable only with finance.view, through REST and
// realtime alike, and recordable write-only with finance.record.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NID, errorOf, hotelId, login, post, superuser, url } from "./helpers.mjs";

const NO_FINANCE = {
  operationsManager: NID.ops, energyManager: NID.energy, maintenanceManager: NID.maintenanceManager,
  housekeepingManager: NID.housekeepingManager, inventoryManager: NID.inventory, hrManager: NID.hr,
  restaurantManager: NID.restaurantManager, receptionStaff: NID.reception,
};
const FINANCE = { generalManager: NID.gm, hotelOwner: NID.owner, analyst: NID.analyst };
const REVENUE_KEYS = ["roomRevenue", "fnbRevenue", "otherRevenue", "adr", "revpar", "totalRevenue"];
const tehranDay = (d) => new Date(d.getTime() + 210 * 60e3).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Minimal PocketBase realtime client over fetch (SSE): collects events for [topic]. */
async function subscribe(token, topic) {
  const ctrl = new AbortController();
  const res = await fetch(`${url()}/api/realtime`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const events = [];
  let buffer = "";
  let clientId = null;
  const pump = (async () => {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += dec.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const name = /^event:(.*)$/m.exec(block)?.[1]?.trim();
          const data = /^data:(.*)$/m.exec(block)?.[1];
          if (name === "PB_CONNECT") clientId = JSON.parse(data).clientId;
          else if (name) events.push({ name, data: JSON.parse(data) });
        }
      }
    } catch {
      // aborted
    }
  })();
  for (let i = 0; i < 50 && !clientId; i++) await new Promise((r) => setTimeout(r, 20));
  const sub = await fetch(`${url()}/api/realtime`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token },
    body: JSON.stringify({ clientId, subscriptions: [topic] }),
  });
  expect(sub.status).toBe(204);
  return { events, close: () => { ctrl.abort(); return pump; } };
}

let su;
beforeAll(async () => {
  su = await superuser();
  // Forecasts (incl. revenue series), insights (incl. the revenue category) and a finance rollup.
  await su.send(`/api/zarin/admin/hotels/${hotelId()}/analytics`, {
    method: "POST",
    body: { forecasts: true, insights: true, rollup: { from: addDays(tehranDay(new Date()), -3), to: addDays(tehranDay(new Date()), -1) } },
  });
});

describe("revenue is invisible without finance.view (REST)", () => {
  for (const [role, nid] of Object.entries(NO_FINANCE)) {
    it(`${role}: no revenue in dailyOperations, dailyMetrics, dailyFinance, forecasts, insights`, async () => {
      const pb = await login(nid);
      for (const r of await pb.collection("dailyOperations").getFullList()) {
        for (const k of REVENUE_KEYS) expect(r[k], `dailyOperations.${k}`).toBeUndefined();
      }
      for (const r of await pb.collection("dailyMetrics").getFullList()) {
        for (const k of REVENUE_KEYS) {
          expect(r[k], `dailyMetrics.${k}`).toBeUndefined();
          expect(r.data?.[k], `dailyMetrics.data.${k}`).toBeUndefined();
        }
      }
      expect((await pb.collection("dailyFinance").getList(1, 1)).totalItems).toBe(0);
      expect((await pb.collection("forecasts").getList(1, 1, { filter: `series = "roomRevenue" || series = "totalRevenue"` })).totalItems).toBe(0);
      expect((await pb.collection("forecastRuns").getList(1, 1, { filter: `series = "roomRevenue" || series = "totalRevenue"` })).totalItems).toBe(0);
      expect((await pb.collection("aiInsights").getList(1, 1, { filter: `category = "revenue"` })).totalItems).toBe(0);
    });
  }

  it("the same data is there for finance roles", async () => {
    for (const nid of Object.values(FINANCE)) {
      const pb = await login(nid);
      expect((await pb.collection("dailyFinance").getList(1, 1)).totalItems).toBeGreaterThan(0);
      expect((await pb.collection("forecasts").getList(1, 1, { filter: `series = "roomRevenue"` })).totalItems).toBeGreaterThan(0);
      expect((await pb.collection("aiInsights").getList(1, 1, { filter: `category = "revenue"` })).totalItems).toBeGreaterThan(0);
    }
    const ops = await login(NID.ops);
    expect((await ops.collection("forecasts").getList(1, 1, { filter: `series = "occupancy"` })).totalItems).toBeGreaterThan(0);
  });

  it("a finance row cannot be read by id either", async () => {
    const row = (await su.collection("dailyFinance").getList(1, 1)).items[0];
    expect((await errorOf((await login(NID.ops)).collection("dailyFinance").getOne(row.id))).status).toBe(404);
    expect((await (await login(NID.gm)).collection("dailyFinance").getOne(row.id)).roomRevenue).toBeGreaterThan(0);
  });

  it("users cannot grant themselves financeView", async () => {
    const ops = await login(NID.ops);
    expect((await errorOf(ops.collection("users").update(ops.authStore.record.id, { financeView: true }))).status).toBe(400);
  });
});

describe("reports with revenue", () => {
  it("are marked by the server and hidden from roles without finance.view", async () => {
    const gm = await login(NID.gm);
    const ops = await login(NID.ops);
    const day = tehranDay(new Date());
    const mine = await gm.collection("reports").create({ hotel: hotelId(), type: "executiveSummary", from: day, to: day, containsFinance: false });
    const theirs = await ops.collection("reports").create({ hotel: hotelId(), type: "executiveSummary", from: day, to: day, containsFinance: true });
    const energy = await gm.collection("reports").create({ hotel: hotelId(), type: "energy", from: day, to: day });
    try {
      expect((await su.collection("reports").getOne(mine.id)).containsFinance).toBe(true);
      expect((await su.collection("reports").getOne(theirs.id)).containsFinance).toBe(false);
      const seen = (await ops.collection("reports").getFullList()).map((r) => r.id);
      expect(seen).not.toContain(mine.id);
      expect(seen).toEqual(expect.arrayContaining([theirs.id, energy.id]));
      expect((await gm.collection("reports").getFullList()).map((r) => r.id)).toContain(mine.id);
    } finally {
      for (const r of [mine, theirs, energy]) await su.collection("reports").delete(r.id);
    }
  });
});

describe("revenue is recorded write-only", () => {
  const day = addDays(tehranDay(new Date()), -1);
  const revenue = { roomRevenue: 123_000_000, fnbRevenue: 45_600_000, otherRevenue: 7_800_000 };

  it("reception records revenue, never sees it, and the GM does", async () => {
    const reception = await login(NID.reception);
    const res = await post(reception, "/api/zarin/operations/daily", {
      hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 44, guests: 70, revenue,
    });
    expect(res).toEqual({ day, financeRecorded: true });
    const ops = await reception.collection("dailyOperations").getFirstListItem(`day = "${day}"`);
    expect(ops.financeRecorded).toBe(true);
    expect(ops.roomsOccupied).toBe(44);
    for (const k of REVENUE_KEYS) expect(ops[k]).toBeUndefined();
    expect((await reception.collection("dailyFinance").getList(1, 1)).totalItems).toBe(0);

    const gm = await login(NID.gm);
    const fin = await gm.collection("dailyFinance").getFirstListItem(`day = "${day}"`);
    expect([fin.roomRevenue, fin.fnbRevenue, fin.otherRevenue]).toEqual([123_000_000, 45_600_000, 7_800_000]);
    expect(fin.updatedByName).toBeTruthy();
    // The operations record itself keeps no revenue (superuser view).
    const raw = await su.collection("dailyOperations").getOne(ops.id);
    expect([raw.roomRevenue, raw.fnbRevenue, raw.otherRevenue]).toEqual([0, 0, 0]);
    // The audit log says revenue was entered, not how much.
    const log = await su.collection("auditLogs").getFirstListItem(`action = "operations.recordDaily" && resourceId = "${ops.id}"`, { sort: "-created" });
    expect(log.changes.revenueEntered).toBe(true);
    expect(JSON.stringify(log.changes)).not.toContain("123000000");
  });

  it("a correction is a new entry; occupancy alone leaves revenue as it is", async () => {
    const ops = await login(NID.ops);
    await post(ops, "/api/zarin/operations/daily", { hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 45 });
    const gm = await login(NID.gm);
    expect((await gm.collection("dailyFinance").getFirstListItem(`day = "${day}"`)).roomRevenue).toBe(123_000_000);
    await post(ops, "/api/zarin/operations/daily", {
      hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 45, revenue: { ...revenue, roomRevenue: 120_000_000 },
    });
    expect((await gm.collection("dailyFinance").getFirstListItem(`day = "${day}"`)).roomRevenue).toBe(120_000_000);
  });

  it("needs operations.recordDaily, and finance.record for revenue", async () => {
    const hk = await login(NID.housekeepingManager);
    expect((await errorOf(post(hk, "/api/zarin/operations/daily", { hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 40 }))).code).toBe("missing_permission");
    const bad = await errorOf(post(await login(NID.reception), "/api/zarin/operations/daily", {
      hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 40, revenue: { roomRevenue: -1, fnbRevenue: 0, otherRevenue: 0 },
    }));
    expect(bad.code).toBe("invalid_revenue");
    const future = await errorOf(post(await login(NID.reception), "/api/zarin/operations/daily", {
      hotelId: hotelId(), day: addDays(tehranDay(new Date()), 2), roomsAvailable: 58, roomsOccupied: 40,
    }));
    expect(future.code).toBe("invalid_day");
  });

  it("a hotel can take finance.record away from a role with roleOverrides", async () => {
    const recordDaily = await su.collection("permissions").getFirstListItem(`code = "operations.recordDaily"`);
    const keep = await su.collection("permissions").getFullList({ filter: `code = "notifications.view" || code = "rooms.view" || code = "rooms.updateStatus" || code = "maintenance.report" || code = "maintenance.viewOwn" || code = "staff.viewOwnShifts"` });
    const override = await su.collection("roleOverrides").create({
      hotel: hotelId(), role: "receptionStaff", permissions: [recordDaily.id, ...keep.map((p) => p.id)],
    });
    const nid = "1".repeat(9) + "0"; // check digit is not validated by this collection's rules
    let user;
    try {
      user = await su.collection("users").create({
        nationalId: nid, fullName: "پذیرش بدون ثبت درآمد", role: "receptionStaff", hotels: [hotelId()], primaryHotel: hotelId(),
        status: "active", password: "Reception-2026a", passwordConfirm: "Reception-2026a",
      });
      const pb = await login(nid, "Reception-2026a");
      const denied = await errorOf(post(pb, "/api/zarin/operations/daily", {
        hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 41, revenue,
      }));
      expect(denied.code).toBe("missing_permission");
      expect((await post(pb, "/api/zarin/operations/daily", { hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 41 })).financeRecorded).toBe(true);

    } finally {
      if (user) await su.collection("users").delete(user.id);
      await su.collection("roleOverrides").delete(override.id);
    }
  });

  it("older app versions cannot write dailyOperations through REST (no silent revenue loss)", async () => {
    // PocketBase drops hidden fields from a user's body; the write is refused instead.
    const reception = await login(NID.reception);
    const day2 = addDays(day, -1);
    const row = await reception.collection("dailyOperations").getFirstListItem(`day = "${day2}"`);
    const before = await su.collection("dailyFinance").getFirstListItem(`day = "${day2}"`);
    expect((await errorOf(reception.collection("dailyOperations").update(row.id, { roomsOccupied: 40, roomRevenue: 99_000_000 }))).status).toBeGreaterThanOrEqual(400);
    expect((await errorOf(reception.collection("dailyOperations").create({ hotel: hotelId(), day: addDays(day, -60), roomsAvailable: 58, roomsOccupied: 40 }))).status).toBeGreaterThanOrEqual(400);
    expect((await su.collection("dailyFinance").getFirstListItem(`day = "${day2}"`)).roomRevenue).toBe(before.roomRevenue);
    expect((await su.collection("dailyOperations").getOne(row.id)).roomsOccupied).toBe(row.roomsOccupied);
  });

  it("superuser scripts and the importer still write revenue; it moves to dailyFinance", async () => {
    const day3 = addDays(day, -70);
    const row = await su.collection("dailyOperations").create({
      hotel: hotelId(), day: day3, roomsAvailable: 58, roomsOccupied: 40, roomRevenue: 99_000_000, fnbRevenue: 1, otherRevenue: 1, source: "seed",
    });
    expect([row.roomRevenue, row.financeRecorded]).toEqual([0, true]);
    expect((await su.collection("dailyFinance").getFirstListItem(`day = "${day3}"`)).roomRevenue).toBe(99_000_000);
  });
});

describe("revenue is invisible without finance.view (realtime)", () => {
  const subs = [];
  afterAll(async () => {
    for (const s of subs) await s.close();
  });

  it("dailyFinance events reach the GM, not the operations manager", async () => {
    const ops = await login(NID.ops);
    const gm = await login(NID.gm);
    const opsSub = await subscribe(ops.authStore.token, "dailyFinance");
    const gmSub = await subscribe(gm.authStore.token, "dailyFinance");
    const opsOpsSub = await subscribe(ops.authStore.token, "dailyOperations");
    subs.push(opsSub, gmSub, opsOpsSub);
    const day = addDays(tehranDay(new Date()), -2);
    await post(await login(NID.reception), "/api/zarin/operations/daily", {
      hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 42, revenue: { roomRevenue: 77_000_000, fnbRevenue: 0, otherRevenue: 0 },
    });
    for (let i = 0; i < 40 && (gmSub.events.length === 0 || opsOpsSub.events.length === 0); i++) await new Promise((r) => setTimeout(r, 50));
    expect(gmSub.events.length).toBeGreaterThan(0);
    expect(gmSub.events[0].data.record.roomRevenue).toBe(77_000_000);
    expect(opsSub.events).toHaveLength(0);
    // The operations update does arrive, without revenue fields.
    expect(opsOpsSub.events.length).toBeGreaterThan(0);
    for (const k of REVENUE_KEYS) expect(opsOpsSub.events[0].data.record[k]).toBeUndefined();
  });
});

// users.financeView is what the finance API rules test, so it must only ever be
// derived by the server (role template ∩ hotel override), never set by a client.
// These tests write daily operations far in the past (> 300 days) so they do not
// change the recent occupancy pattern other files' insight rules read.
describe("users.financeView cannot be set by a client", () => {
  const nationalId = (nine) => {
    const sum = [...nine].reduce((s, d, i) => s + Number(d) * (10 - i), 0) % 11;
    return `${nine}${sum < 2 ? sum : 11 - sum}`;
  };
  const freshNid = () => nationalId(String(100_000_000 + Math.floor(Math.random() * 899_999_999)));
  const password = () => `Fv-${Math.random().toString(36).slice(2, 10)}A1`;
  const flagOf = async (id) => (await su.collection("users").getOne(id)).financeView;
  const created = [];
  afterAll(async () => {
    for (const id of created) {
      for (const s of await su.collection("staff").getFullList({ filter: `user = "${id}"` })) await su.collection("staff").delete(s.id);
      await su.collection("users").delete(id);
    }
  });

  it("REST: a PATCH of one's own record is refused, in JSON, multipart and mixed with allowed fields", async () => {
    const ops = await login(NID.ops);
    const id = ops.authStore.record.id;
    const finView = await su.collection("permissions").getFirstListItem(`code = "finance.view"`);
    const form = new FormData();
    form.append("financeView", "true");
    for (const body of [{ financeView: true }, { locale: "fa", financeView: true }, { financeView: "true" }, form, { permissions: [finView.id] }]) {
      const err = await errorOf(ops.collection("users").update(id, body));
      expect(err.status).toBe(400);
      expect(err.code).toBe("field_not_allowed");
    }
    expect(await flagOf(id)).toBe(false);
    expect((await ops.collection("dailyFinance").getList(1, 1)).totalItems).toBe(0);
  });

  it("REST: nobody can PATCH another user's record, and the batch API is off", async () => {
    const gm = await login(NID.gm);
    const opsId = (await su.collection("users").getFirstListItem(`nationalId = "${NID.ops}"`)).id;
    expect((await errorOf(gm.collection("users").update(opsId, { financeView: true }))).status).toBe(404);
    const ops = await login(NID.ops);
    const batch = ops.createBatch();
    batch.collection("users").update(opsId, { financeView: true });
    expect((await errorOf(batch.send())).status).toBeGreaterThanOrEqual(400);
    expect(await flagOf(opsId)).toBe(false);
  });

  it("even a superuser write cannot set it: the model hook re-derives it from the role", async () => {
    const opsId = (await su.collection("users").getFirstListItem(`nationalId = "${NID.ops}"`)).id;
    const row = await su.collection("users").update(opsId, { financeView: true });
    expect(row.financeView).toBe(false);
    expect(await flagOf(opsId)).toBe(false);
  });

  it("routes: a financeView in any request body is ignored", async () => {
    const gm = await login(NID.gm);
    const nid = freshNid();
    const pw = password();
    const { uid } = await post(gm, "/api/zarin/users", {
      hotelId: hotelId(), nationalId: nid, fullName: "آزمون مجوز مالی", role: "receptionStaff", temporaryPassword: pw,
      financeView: true, permissions: ["finance.view"],
    });
    created.push(uid);
    expect(await flagOf(uid)).toBe(false);
    const user = await login(nid, pw);
    const day = addDays(tehranDay(new Date()), -309);
    const calls = [
      [user, "/api/zarin/sessions", { deviceId: "finance-view-device-1", platform: "android", financeView: true }],
      [user, "/api/zarin/operations/daily", { hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 40, financeView: true }],
      [user, "/api/zarin/ai/ask", { hotelId: hotelId(), question: "درآمد دیروز چقدر بود؟", locale: "fa", financeView: true }],
      [gm, `/api/zarin/users/${uid}/role`, { hotelId: hotelId(), role: "housekeepingStaff", financeView: true }],
      [gm, `/api/zarin/users/${uid}/status`, { hotelId: hotelId(), status: "active", financeView: true }],
      [gm, `/api/zarin/users/${uid}/password`, { hotelId: hotelId(), temporaryPassword: password(), financeView: true }],
    ];
    for (const [pb, path, body] of calls) {
      await post(pb, path, body).catch(() => {}); // success or refusal, the flag must not move
      expect(await flagOf(uid), path).toBe(false);
    }
    const me = await (await login(NID.ops)).send("/api/zarin/me", {});
    expect(me.permissions).not.toContain("finance.view");
  });
});

describe("users.financeView follows role and override changes, both ways, at once", () => {
  const created = [];
  const overrides = [];
  afterAll(async () => {
    for (const id of overrides) await su.collection("roleOverrides").delete(id).catch(() => {});
    for (const id of created) {
      for (const s of await su.collection("staff").getFullList({ filter: `user = "${id}"` })) await su.collection("staff").delete(s.id);
      await su.collection("users").delete(id);
    }
  });
  const nationalId = (nine) => {
    const sum = [...nine].reduce((s, d, i) => s + Number(d) * (10 - i), 0) % 11;
    return `${nine}${sum < 2 ? sum : 11 - sum}`;
  };
  const freshNid = () => nationalId(String(100_000_000 + Math.floor(Math.random() * 899_999_999)));
  const password = () => `Fv-${Math.random().toString(36).slice(2, 10)}A1`;
  const finance = async (pb) => (await pb.collection("dailyFinance").getList(1, 1)).totalItems;
  const flagOf = async (id) => (await su.collection("users").getOne(id)).financeView;

  async function provision(role) {
    const gm = await login(NID.gm);
    const nid = freshNid();
    const pw = password();
    const { uid } = await post(gm, "/api/zarin/users", { hotelId: hotelId(), nationalId: nid, fullName: `آزمون ${role}`, role, temporaryPassword: pw });
    created.push(uid);
    return { uid, nid, pw };
  }

  it("role change by a manager (route): sessions are revoked, the next sign-in has exactly the new access", async () => {
    const gm = await login(NID.gm);
    const u = await provision("operationsManager");
    const asOps = await login(u.nid, u.pw);
    expect(await finance(asOps)).toBe(0);

    await post(gm, `/api/zarin/users/${u.uid}/role`, { hotelId: hotelId(), role: "analyst" });
    expect(await flagOf(u.uid)).toBe(true);
    // The old token is dead (PocketBase treats it as a guest: auth-only routes 401, lists are empty).
    expect((await errorOf(asOps.send("/api/zarin/me", {}))).status).toBe(401);
    expect(await finance(asOps)).toBe(0);
    const asAnalyst = await login(u.nid, u.pw);
    expect(await finance(asAnalyst)).toBeGreaterThan(0);

    await post(gm, `/api/zarin/users/${u.uid}/role`, { hotelId: hotelId(), role: "operationsManager" });
    expect(await flagOf(u.uid)).toBe(false);
    // No window with the old access.
    expect((await errorOf(asAnalyst.send("/api/zarin/me", {}))).status).toBe(401);
    expect(await finance(asAnalyst)).toBe(0);
    expect(await finance(await login(u.nid, u.pw))).toBe(0);
  });

  it("role change by a superuser (panel): the same token gains and loses access on the next request", async () => {
    const u = await provision("operationsManager");
    const pb = await login(u.nid, u.pw);
    expect(await finance(pb)).toBe(0);
    await su.collection("users").update(u.uid, { role: "analyst" });
    expect(await finance(pb)).toBeGreaterThan(0);
    await su.collection("users").update(u.uid, { role: "operationsManager" });
    expect(await finance(pb)).toBe(0);
  });

  it("roleOverrides create / update / delete: the same token loses and regains access immediately (REST and realtime)", async () => {
    const u = await provision("analyst");
    const pb = await login(u.nid, u.pw);
    const seededAnalyst = await login(NID.analyst);
    const seededId = seededAnalyst.authStore.record.id;
    expect(await finance(pb)).toBeGreaterThan(0);

    const template = await su.collection("roleTemplates").getFirstListItem(`role = "analyst"`);
    const finView = await su.collection("permissions").getFirstListItem(`code = "finance.view"`);
    const without = template.permissions.filter((p) => p !== finView.id);
    expect(without.length).toBe(template.permissions.length - 1);

    const sub = await subscribe(pb.authStore.token, "dailyFinance");
    const reception = await login(NID.reception);
    const record = (day, amount) => post(reception, "/api/zarin/operations/daily", {
      hotelId: hotelId(), day, roomsAvailable: 58, roomsOccupied: 40, revenue: { roomRevenue: amount, fnbRevenue: 0, otherRevenue: 0 },
    });
    const settle = async (n) => {
      for (let i = 0; i < 40 && sub.events.length < n; i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 150));
    };
    try {
      // Closed: override without finance.view.
      const o = await su.collection("roleOverrides").create({ hotel: hotelId(), role: "analyst", permissions: without });
      overrides.push(o.id);
      expect([await flagOf(u.uid), await flagOf(seededId)]).toEqual([false, false]);
      expect(await finance(pb)).toBe(0);
      expect(await finance(seededAnalyst)).toBe(0);
      expect((await pb.send("/api/zarin/me", {})).permissions).not.toContain("finance.view");
      await record(addDays(tehranDay(new Date()), -311), 11_000_000);
      await settle(1);
      expect(sub.events).toHaveLength(0);

      // Open again: the override now includes finance.view.
      await su.collection("roleOverrides").update(o.id, { permissions: template.permissions });
      expect(await flagOf(u.uid)).toBe(true);
      expect(await finance(pb)).toBeGreaterThan(0);
      await record(addDays(tehranDay(new Date()), -312), 12_000_000);
      await settle(1);
      expect(sub.events.map((ev) => ev.data.record.roomRevenue)).toEqual([12_000_000]);

      // Closed by update, then opened by delete.
      await su.collection("roleOverrides").update(o.id, { permissions: without });
      expect(await flagOf(u.uid)).toBe(false);
      expect(await finance(pb)).toBe(0);
      await record(addDays(tehranDay(new Date()), -313), 13_000_000);
      await settle(2);
      expect(sub.events).toHaveLength(1);

      await su.collection("roleOverrides").delete(o.id);
      expect([await flagOf(u.uid), await flagOf(seededId)]).toEqual([true, true]);
      expect(await finance(pb)).toBeGreaterThan(0);
      expect(await finance(seededAnalyst)).toBeGreaterThan(0);
      await record(addDays(tehranDay(new Date()), -314), 14_000_000);
      await settle(2);
      expect(sub.events.map((ev) => ev.data.record.roomRevenue)).toEqual([12_000_000, 14_000_000]);
    } finally {
      await sub.close();
    }
  });
});
