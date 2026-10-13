// AI phase 1, F1 Action Center on a live server: proposals from insights,
// server-side department scoping, type permissions, adjustBaseline guards,
// audit, failures, reminders and measured outcomes with their history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NID, errorOf, hotelId, login, post, superuser } from "./helpers.mjs";

const analytics = (pb, id, body) => pb.send(`/api/zarin/admin/hotels/${id}/analytics`, { method: "POST", body });
const decide = (pb, id, body) => post(pb, `/api/zarin/actions/${id}/decide`, body);

let su;
let settingsBefore;
const created = { actions: [], tickets: [], tasks: [], exclusions: [] };

/** A proposed action on the shared hotel (cleaned up after the file). */
async function action(fields) {
  const rec = await su.collection("aiActions").create({
    hotel: hotelId(), status: "proposed", priority: "medium", category: "energy", department: "energy", type: "notifyRole",
    title: "اقدام آزمایشی", reason: "دلیل آزمایشی برای اقدام", params: { roles: ["energyManager"], title: "آزمون", body: "متن" },
    idempotencyKey: `test:${Math.random().toString(36).slice(2)}`, source: "test", ...fields,
  });
  created.actions.push(rec.id);
  return rec;
}

beforeAll(async () => {
  su = await superuser();
  settingsBefore = (await su.collection("hotels").getOne(hotelId())).settings;
  await su.collection("hotels").update(hotelId(), { settings: { ...settingsBefore, features: { recommendationLoop: true, energyBaseline: true } } });
});

afterAll(async () => {
  for (const id of created.exclusions) await su.collection("energyExclusions").delete(id).catch(() => {});
  for (const a of await su.collection("aiActions").getFullList({ filter: `hotel = "${hotelId()}"` })) {
    for (const x of await su.collection("energyExclusions").getFullList({ filter: `action = "${a.id}"` })) await su.collection("energyExclusions").delete(x.id).catch(() => {});
    const ref = a.executedRef || {};
    if (ref.collection === "maintenanceTickets" || ref.collection === "tasks") {
      for (const id of ref.ids || []) {
        if (ref.collection === "maintenanceTickets") {
          for (const ev of await su.collection("ticketEvents").getFullList({ filter: `ticket = "${id}"` })) await su.collection("ticketEvents").delete(ev.id).catch(() => {});
        }
        await su.collection(ref.collection).delete(id).catch(() => {});
      }
    }
    await su.collection("aiActions").delete(a.id).catch(() => {});
  }
  await su.collection("hotels").update(hotelId(), { settings: settingsBefore });
});

describe("Action Center: proposals", () => {
  it("the insight run proposes typed actions once per insight cycle, visible by permission", async () => {
    await analytics(su, hotelId(), { insights: true });
    const all = await su.collection("aiActions").getFullList({ filter: `hotel = "${hotelId()}" && source = "rules"` });
    expect(all.length).toBeGreaterThan(0);
    for (const a of all) {
      expect(a.status).toBe("proposed");
      expect(["createTicket", "createTask", "notifyRole"]).toContain(a.type);
      expect(a.insight).not.toBe("");
    }
    expect(all.some((a) => a.type === "adjustBaseline")).toBe(false);
    // A second run does not duplicate.
    await analytics(su, hotelId(), { insights: true });
    expect((await su.collection("aiActions").getFullList({ filter: `hotel = "${hotelId()}" && source = "rules"` })).length).toBe(all.length);

    const revenue = all.filter((a) => a.category === "revenue").map((a) => a.id);
    const gmSees = (await (await login(NID.gm)).collection("aiActions").getFullList({ filter: `source = "rules"` })).map((a) => a.id);
    const opsSees = (await (await login(NID.ops)).collection("aiActions").getFullList({ filter: `source = "rules"` })).map((a) => a.id);
    expect(gmSees.length).toBe(all.length);
    for (const id of revenue) expect(opsSees).not.toContain(id);
    expect((await (await login(NID.housekeeper)).collection("aiActions").getList(1, 1)).totalItems).toBe(0);
  });
});

describe("Action Center: who may decide (enforced on the server)", () => {
  it("a housekeeping manager cannot approve an energy action; it stays pending", async () => {
    const a = await action({ department: "energy", type: "notifyRole" });
    const hk = await login(NID.housekeepingManager);
    const err = await errorOf(decide(hk, a.id, { decision: "approve" }));
    expect([err.status, err.code]).toEqual([403, "department_not_allowed"]);
    expect((await errorOf(decide(hk, a.id, { decision: "reject", note: "نه" }))).code).toBe("department_not_allowed");
    expect((await su.collection("aiActions").getOne(a.id)).status).toBe("proposed");
  });

  it("every department manager is limited to its own department", async () => {
    const cases = [
      [NID.energy, "maintenance"], [NID.maintenanceManager, "energy"], [NID.inventory, "housekeeping"],
      [NID.housekeepingManager, "inventory"], [NID.restaurantManager, "energy"],
    ];
    for (const [nid, department] of cases) {
      const a = await action({ department, type: "notifyRole" });
      expect((await errorOf(decide(await login(nid), a.id, { decision: "approve" }))).code, `${nid} → ${department}`).toBe("department_not_allowed");
    }
    // Roles without ai.actions.approve are refused before the department check.
    const a = await action({ department: "operations" });
    for (const nid of [NID.analyst, NID.reception, NID.hr]) {
      expect((await errorOf(decide(await login(nid), a.id, { decision: "approve" }))).code).toBe("missing_permission");
    }
  });

  it("a housekeeping manager approves a housekeeping task action: tasks created, audited", async () => {
    const room = (await su.collection("rooms").getList(1, 1, { filter: `hotel = "${hotelId()}"` })).items[0];
    const a = await action({ department: "housekeeping", type: "createTask", category: "maintenance", params: { taskType: "inspection", rooms: [room.number], priority: "high", notes: "بازدید" } });
    const hk = await login(NID.housekeepingManager);
    const done = await decide(hk, a.id, { decision: "approve", note: "انجام شود", params: { priority: "urgent" } });
    expect(done).toMatchObject({ status: "executed", decidedBy: hk.authStore.record.id, decidedByRole: "housekeepingManager" });
    expect(done.executedRef.collection).toBe("tasks");
    const task = await su.collection("tasks").getOne(done.executedRef.ids[0]);
    expect(task).toMatchObject({ type: "inspection", status: "pending", priority: "urgent", roomNumber: room.number });
    const log = await su.collection("auditLogs").getFullList({ filter: `resourceId = "${a.id}"`, sort: "created" });
    expect(log.map((l) => l.action)).toEqual(["actions.decide", "actions.execute"]);
    expect(log[0].changes.edits).toEqual({ priority: { from: "high", to: "urgent" } });
    expect(done.outcome.status).toBe("notMeasurable");
    // Approving twice is refused; nothing runs again.
    expect((await errorOf(decide(hk, a.id, { decision: "approve" }))).code).toBe("action_not_pending");
  });

  it("the type needs its own permission; edits are limited to safe fields", async () => {
    const a = await action({ department: "energy", type: "createTask", params: { taskType: "inspection", rooms: ["101"] } });
    // The energy manager may decide energy actions but cannot create housekeeping tasks.
    expect((await errorOf(decide(await login(NID.energy), a.id, { decision: "approve" }))).code).toBe("missing_permission");
    const t = await action({ department: "energy", type: "createTicket", params: { title: "بازدید چیلر", category: "hvac", priority: "high" } });
    expect((await errorOf(decide(await login(NID.energy), t.id, { decision: "approve", params: { roomNumber: "101" } }))).code).toBe("param_not_editable");
    const done = await decide(await login(NID.energy), t.id, { decision: "approve", params: { priority: "critical" } });
    const ticket = await su.collection("maintenanceTickets").getOne(done.executedRef.ids[0]);
    expect(ticket).toMatchObject({ title: "بازدید چیلر", category: "hvac", priority: "critical", reportedByRole: "energyManager" });
  });

  it("revenue-derived actions are invisible without finance.view, even by id", async () => {
    const a = await action({ category: "revenue", department: "operations", params: { roles: ["generalManager"], title: "درآمد", body: "متن" } });
    expect((await errorOf(decide(await login(NID.ops), a.id, { decision: "approve" }))).status).toBe(404);
    const done = await decide(await login(NID.gm), a.id, { decision: "approve" });
    expect(done.executedRef).toEqual({ collection: "notifications", roles: ["generalManager"] });
  });

  it("rejection needs a note; a failed execution is recorded, not silent", async () => {
    const a = await action({});
    expect((await errorOf(decide(await login(NID.gm), a.id, { decision: "reject" }))).code).toBe("note_required");
    expect((await decide(await login(NID.gm), a.id, { decision: "reject", note: "فعلاً لازم نیست" })).status).toBe("rejected");
    const bad = await action({ department: "housekeeping", type: "createTask", params: { taskType: "inspection", rooms: ["NO-SUCH-ROOM"] } });
    expect((await errorOf(decide(await login(NID.gm), bad.id, { decision: "approve" }))).code).toBe("room_not_found");
    expect(await su.collection("aiActions").getOne(bad.id)).toMatchObject({ status: "failed", error: "room_not_found" });
    expect((await su.collection("auditLogs").getFirstListItem(`resourceId = "${bad.id}" && action = "actions.failed"`)).changes.error).toBe("room_not_found");
  });

  it("without the recommendationLoop flag nothing can be decided", async () => {
    const a = await action({});
    await su.collection("hotels").update(hotelId(), { settings: { ...settingsBefore, features: { energyBaseline: true } } });
    try {
      expect((await errorOf(decide(await login(NID.gm), a.id, { decision: "approve" }))).code).toBe("feature_disabled");
    } finally {
      await su.collection("hotels").update(hotelId(), { settings: { ...settingsBefore, features: { recommendationLoop: true, energyBaseline: true } } });
    }
  });
});

describe("Action Center: adjustBaseline", () => {
  /** Days of one Jalali month that have an electricity reading (≥ 7 of them). */
  async function readingDays() {
    const rows = await su.collection("energyReadings").getFullList({ filter: `hotel = "${hotelId()}" && type = "electricity"`, sort: "-day" });
    return [...new Set(rows.map((r) => r.day))].slice(1, 40).sort();
  }

  it("only the GM and the energy manager, with a reason, at most 5 days a month", async () => {
    const days = await readingDays();
    const body = (d, reason = "رویداد شناخته‌شده: نمایشگاه و بار اضافهٔ سالن") => ({ hotelId: hotelId(), type: "adjustBaseline", reason, params: { meterType: "electricity", days: d } });
    expect((await errorOf(post(await login(NID.ops), "/api/zarin/actions", body(days.slice(0, 1))))).code).toBe("baseline_adjust_not_allowed");
    expect((await errorOf(post(await login(NID.housekeepingManager), "/api/zarin/actions", body(days.slice(0, 1))))).code).toBe("baseline_adjust_not_allowed");
    expect((await errorOf(post(await login(NID.reception), "/api/zarin/actions", body(days.slice(0, 1))))).code).toBe("missing_permission");
    expect((await errorOf(post(await login(NID.energy), "/api/zarin/actions", body(days.slice(0, 1), "کوتاه")))).code).toBe("reason_required");
    expect((await errorOf(post(await login(NID.energy), "/api/zarin/actions", { ...body(days.slice(0, 1)), type: "createTicket" }))).code).toBe("type_not_manual");

    // Group the reading days by Jalali month through the server's own check: the first 6 consecutive days of one month.
    const energy = await login(NID.energy);
    let six = null;
    for (let i = 0; i + 6 <= days.length && !six; i++) {
      const candidate = days.slice(i, i + 6);
      const err = await errorOf(post(energy, "/api/zarin/actions", body(candidate)));
      if (err.code === "exclusion_cap_exceeded") six = candidate;
    }
    expect(six).not.toBeNull();
    const proposal = await post(energy, "/api/zarin/actions", body(six.slice(0, 5)));
    created.actions.push(proposal.id);
    expect(proposal).toMatchObject({ type: "adjustBaseline", status: "proposed", department: "energy", source: "manual" });

    // The operations manager may decide energy actions, but not this type.
    expect((await errorOf(decide(await login(NID.ops), proposal.id, { decision: "approve" }))).code).toBe("baseline_adjust_not_allowed");
    const done = await decide(await login(NID.gm), proposal.id, { decision: "approve" });
    expect(done.status).toBe("executed");
    const rows = await su.collection("energyExclusions").getFullList({ filter: `action = "${proposal.id}"` });
    created.exclusions.push(...rows.map((r) => r.id));
    expect(rows.map((r) => r.day).sort()).toEqual(six.slice(0, 5));
    expect(rows.every((r) => r.reason.startsWith("رویداد شناخته‌شده") && r.createdByName)).toBe(true);
    // A sixth day in the same month is refused, at proposal time.
    const sixth = await errorOf(post(energy, "/api/zarin/actions", body([six[5]])));
    expect(sixth.code).toBe("exclusion_cap_exceeded");
    // The list is readable by energy viewers (shown on the energy page).
    expect((await energy.collection("energyExclusions").getFullList({ filter: `action = "${proposal.id}"` })).length).toBe(5);
    expect((await (await login(NID.housekeeper)).collection("energyExclusions").getList(1, 1)).totalItems).toBe(0);
  });
});

describe("Action Center: reminders and outcomes", () => {
  it("a pending high-priority action is announced once to its approvers after 24 hours", async () => {
    const a = await action({ priority: "high", department: "energy" });
    const later = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
    await analytics(su, hotelId(), { insights: true, now: later });
    const r = await su.collection("aiActions").getOne(a.id);
    expect(r.remindedAt).not.toBe("");
    await analytics(su, hotelId(), { insights: true, now: later });
    expect((await su.collection("aiActions").getOne(a.id)).remindedAt).toBe(r.remindedAt);
    const inbox = await (await login(NID.energy)).collection("inbox").getFullList({ filter: `title ~ "یادآوری: ${a.title}"` });
    expect(inbox.length).toBe(1);
  });

  it("measures after the window, labels it observational, and keeps the previous outcome in the audit", async () => {
    const decidedAt = new Date(Date.now() - 31 * 864e5);
    const a = await action({
      status: "executed", type: "createTicket", department: "maintenance", category: "maintenance",
      expectedImpact: { metric: "tickets30Days", unit: "tickets", baseline: 3, expected: 0, method: "ticketCount", subject: { category: "plumbing", where: "room-9999" } },
      executedAt: decidedAt.toISOString().replace("T", " "), decidedAt: decidedAt.toISOString().replace("T", " "),
      outcome: { status: "pending", method: "ticketCount", windowDays: 30 },
    });
    await analytics(su, hotelId(), { insights: true });
    const first = (await su.collection("aiActions").getOne(a.id)).outcome;
    expect(first).toMatchObject({ method: "ticketCount", label: "observational", unit: "tickets", value: 0, expected: 0, actual: 0 });
    expect(["measured", "inconclusive"]).toContain(first.status);
    expect(first.window).toMatchObject({ afterFrom: expect.any(String), afterTo: expect.any(String) });
    expect(first.measuredAt).not.toBe("");
    expect(first.ci95).toEqual([0, 0]);
    // Re-measured a window later (inconclusive): the previous outcome stays in the audit.
    const later = new Date(Date.now() + 31 * 864e5).toISOString();
    await su.collection("aiActions").update(a.id, { outcome: { ...first, status: "inconclusive", measuredAt: new Date(Date.now() - 31 * 864e5).toISOString().replace("T", " ") } });
    await analytics(su, hotelId(), { insights: true, now: later });
    const log = await su.collection("auditLogs").getFullList({ filter: `resourceId = "${a.id}" && action = "actions.outcome"`, sort: "created" });
    expect(log).toHaveLength(2);
    expect(log[0].changes.previous.status).toBe("pending");
    expect(log[1].changes.previous.status).toBe("inconclusive");
  });

  it("without data or a method the outcome is not measurable, never a guess", async () => {
    const decidedAt = new Date(Date.now() - 30 * 864e5).toISOString().replace("T", " ");
    const a = await action({
      status: "executed", type: "notifyRole", category: "revenue", department: "operations",
      expectedImpact: { metric: "gap", unit: "pts", baseline: 20, expected: 12, method: "occupancyGap" },
      executedAt: decidedAt, decidedAt, outcome: { status: "pending", method: "occupancyGap", windowDays: 28 },
    });
    await analytics(su, hotelId(), { insights: true });
    const o = (await su.collection("aiActions").getOne(a.id)).outcome;
    expect(o).toMatchObject({ status: "notMeasurable", value: null, improved: null, label: "observational" });
  });
});
