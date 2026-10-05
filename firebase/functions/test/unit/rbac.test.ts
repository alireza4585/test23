import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLES,
  can,
  canAssign,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  ROOM_TRANSITIONS,
} from "../../src/domain/rbac";
import { injectRbacBlock } from "../../src/domain/rules-gen";

const repo = join(__dirname, "..", "..", "..", "..");

/** Parses the Dart role matrix so the app and backend can never drift. */
function parseDartPolicy() {
  const permSrc = readFileSync(join(repo, "app/lib/core/security/app_permission.dart"), "utf8");
  const codeOf = new Map<string, string>();
  for (const m of permSrc.matchAll(/(\w+)\('([\w.]+)'\)/g)) codeOf.set(m[1], m[2]);

  const policySrc = readFileSync(join(repo, "app/lib/core/security/role_policy.dart"), "utf8");
  const staffCommon = [...policySrc.slice(policySrc.indexOf("_staffCommon"), policySrc.indexOf("};", policySrc.indexOf("_staffCommon")))
    .matchAll(/AppPermission\.(\w+)/g)].map((m) => codeOf.get(m[1])!);

  const defaults = policySrc.slice(policySrc.indexOf("defaults = {"), policySrc.indexOf("assignableRoles"));
  const result = new Map<string, Set<string>>();
  const blocks = defaults.split(/AppRole\.(\w+):/).slice(1);
  for (let i = 0; i < blocks.length; i += 2) {
    const role = blocks[i];
    const body = blocks[i + 1];
    const perms = new Set<string>();
    if (body.trimStart().startsWith("_all")) PERMISSIONS.forEach((p) => perms.add(p));
    if (body.includes("..._staffCommon")) staffCommon.forEach((p) => perms.add(p));
    for (const m of body.matchAll(/AppPermission\.(\w+)/g)) perms.add(codeOf.get(m[1])!);
    result.set(role, perms);
  }

  const assignable = policySrc.slice(policySrc.indexOf("assignableRoles = {"), policySrc.indexOf("static Set<AppPermission> resolve"));
  const assign = new Map<string, Set<string>>();
  const aBlocks = assignable.split(/AppRole\.(\w+): \{/).slice(1);
  for (let i = 0; i < aBlocks.length; i += 2) {
    const body = aBlocks[i + 1].split("},")[0];
    const set = new Set<string>();
    if (body.includes("...AppRole.values")) ROLES.forEach((r) => set.add(r));
    for (const m of body.matchAll(/AppRole\.(\w+)/g)) if (m[1] !== "values") set.add(m[1]);
    assign.set(aBlocks[i], set);
  }
  return { result, assign, codeOf };
}

describe("RBAC", () => {
  it("covers every role with known permissions", () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it("matches the Flutter role policy exactly (app ↔ backend drift guard)", () => {
    const { result, codeOf } = parseDartPolicy();
    expect(new Set(codeOf.values())).toEqual(new Set(PERMISSIONS));
    expect(new Set(result.keys())).toEqual(new Set(ROLES));
    for (const role of ROLES) {
      expect([...result.get(role)!].sort(), role).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it("matches the Flutter assignable-role table", () => {
    const { assign } = parseDartPolicy();
    for (const [role, roles] of assign) {
      expect([...roles].sort(), role).toEqual([...(ASSIGNABLE_ROLES[role as keyof typeof ASSIGNABLE_ROLES] ?? [])].sort());
    }
  });

  it("prevents privilege escalation", () => {
    expect(canAssign("hrManager", "generalManager")).toBe(false);
    expect(canAssign("generalManager", "hotelOwner")).toBe(false);
    expect(canAssign("generalManager", "housekeepingStaff")).toBe(true);
    expect(canAssign("housekeepingStaff", "housekeepingStaff")).toBe(false);
  });

  it("keeps front-line staff away from management capabilities", () => {
    for (const r of ["receptionStaff", "housekeepingStaff", "maintenanceStaff", "restaurantStaff"] as const) {
      expect(can(r, "users.manage")).toBe(false);
      expect(can(r, "finance.view")).toBe(false);
      expect(can(r, "dashboard.executive")).toBe(false);
    }
  });

  it("room transitions mirror the Flutter RoomStatusPolicy", () => {
    const dart = readFileSync(join(repo, "app/lib/features/rooms/domain/room_status_policy.dart"), "utf8");
    for (const [role, map] of Object.entries(ROOM_TRANSITIONS)) {
      expect(dart).toContain(`AppRole.${role}: {`);
      for (const [from, to] of Object.entries(map ?? {})) {
        const re = new RegExp(`RoomStatus\\.${from}: \\{([^}]*)\\}`, "g");
        const roleBlock = dart.slice(dart.indexOf(`AppRole.${role}: {`));
        const m = re.exec(roleBlock);
        expect(m, `${role}.${from}`).not.toBeNull();
        const targets = [...m![1].matchAll(/RoomStatus\.(\w+)/g)].map((x) => x[1]).sort();
        expect(targets).toEqual([...to].sort());
      }
    }
  });

  it("firestore.rules RBAC block is generated from rbac.ts (run `npm run gen:rules`)", () => {
    const rules = readFileSync(join(repo, "firebase/firestore.rules"), "utf8");
    expect(injectRbacBlock(rules)).toEqual(rules);
  });
});
