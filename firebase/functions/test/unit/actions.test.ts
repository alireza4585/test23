import { describe, expect, it } from "vitest";

import { ACTION_TYPES, EDITABLE_PARAMS, proposeActions } from "../../src/analytics/actions";
import { evaluateMean } from "../../src/analytics/evaluation";
import { bootstrapMeanDiff } from "../../src/analytics/stats";
import { BASELINE_ADJUST_ROLES, ROLE_ACTION_DEPARTMENTS, canDecideDepartment } from "../../src/domain/rbac";

const base = { title: "عنوان", recommendation: "پیشنهاد", priority: "high" as const };

describe("Action Center (F1)", () => {
  it("maps insights to typed actions of the right department", () => {
    const energy = proposeActions({ ...base, rule: "energyModel", category: "energy", expectedImpact: { metric: "x", unit: "kWh", baseline: 1, expected: 0, method: "energyBaseline", subject: { type: "electricity" } } });
    expect(energy).toHaveLength(1);
    expect(energy[0]).toMatchObject({ type: "createTicket", department: "energy", params: { category: "hvac", priority: "high" } });
    expect(energy[0].expectedImpact?.method).toBe("energyBaseline");

    const repeat = proposeActions({ ...base, rule: "repeatFailure", category: "maintenance", expectedImpact: { metric: "t", unit: "tickets", baseline: 3, expected: 0, method: "ticketCount", subject: { category: "plumbing", where: "room-1412" } } });
    expect(repeat[0]).toMatchObject({ type: "createTicket", department: "maintenance", params: { category: "plumbing", roomNumber: "1412", area: "" } });

    const ooo = proposeActions({ ...base, rule: "outOfOrderRooms", category: "maintenance", expectedImpact: { metric: "r", unit: "rooms", baseline: 2, expected: 0, method: "oooRooms", subject: { rooms: ["1715", "0908"] } } });
    expect(ooo[0]).toMatchObject({ type: "createTask", department: "housekeeping", params: { taskType: "inspection", rooms: ["1715", "0908"] } });

    expect(proposeActions({ ...base, rule: "stockout", category: "inventory" })[0]).toMatchObject({ type: "notifyRole", department: "inventory", params: { roles: ["inventoryManager"] } });
    expect(proposeActions({ ...base, rule: "weekdayOccupancy", category: "revenue" })[0]).toMatchObject({ type: "notifyRole", department: "operations", params: { roles: ["generalManager"] } });
    expect(proposeActions({ ...base, rule: "somethingElse", category: "energy" })).toEqual([]);
  });

  it("never proposes adjustBaseline automatically", () => {
    for (const rule of ["energyModel", "energyIntensity", "repeatFailure", "outOfOrderRooms", "hkEfficiency", "stockout", "outOfOrderRevenue", "weekdayOccupancy"]) {
      for (const a of proposeActions({ ...base, rule, category: "energy", expectedImpact: { metric: "x", unit: "u", baseline: 1, expected: 0, method: "oooRooms", subject: { rooms: ["1"] } } })) {
        expect(a.type).not.toBe("adjustBaseline");
      }
    }
    expect(EDITABLE_PARAMS.adjustBaseline).toEqual([]);
    expect([...ACTION_TYPES]).toEqual(["createTicket", "createTask", "notifyRole", "adjustBaseline"]);
  });

  it("department managers decide only their own department; baseline changes only GM and energy", () => {
    expect(canDecideDepartment("housekeepingManager", "energy")).toBe(false);
    expect(canDecideDepartment("housekeepingManager", "housekeeping")).toBe(true);
    expect(canDecideDepartment("energyManager", "maintenance")).toBe(false);
    expect(canDecideDepartment("generalManager", "inventory")).toBe(true);
    expect(canDecideDepartment("receptionStaff", "operations")).toBe(false);
    expect(ROLE_ACTION_DEPARTMENTS.analyst).toBeUndefined();
    expect([...BASELINE_ADJUST_ROLES].sort()).toEqual(["energyManager", "generalManager"]);
  });

  it("bootstrap interval: deterministic, and around the true difference", () => {
    const before = [40, 42, 38, 41, 39, 43, 40, 41];
    const after = [35, 34, 36, 33, 35, 36, 34, 35];
    const ci = bootstrapMeanDiff(before, after)!;
    expect(ci).toEqual(bootstrapMeanDiff(before, after));
    expect(ci[0]).toBeLessThan(-5.75 + 0.01);
    expect(ci[1]).toBeGreaterThan(-5.75 - 0.01);
    expect(ci[1]).toBeLessThan(0);
    expect(bootstrapMeanDiff([1], [2, 3])).toBeNull();
    expect(evaluateMean("durationAvg", "min", before, after, { afterFrom: "a", afterTo: "b" }).ci95).toEqual(ci);
  });
});
