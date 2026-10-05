/**
 * Canonical role → permission matrix for the backend.
 *
 * Mirrors `app/lib/core/security/role_policy.dart` (UI) and is the source the
 * `<rbac:begin>` block of `firebase/firestore.rules` is generated from
 * (`npm run gen:rules`). `test/unit/rbac.test.ts` fails if they drift.
 */

export const ROLES = [
  "superAdmin",
  "hotelOwner",
  "generalManager",
  "operationsManager",
  "energyManager",
  "maintenanceManager",
  "housekeepingManager",
  "restaurantManager",
  "inventoryManager",
  "hrManager",
  "receptionStaff",
  "housekeepingStaff",
  "maintenanceStaff",
  "restaurantStaff",
  "analyst",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard.executive",
  "dashboard.operations",
  "rooms.view",
  "rooms.updateStatus",
  "rooms.manage",
  "housekeeping.viewOwn",
  "housekeeping.viewAll",
  "housekeeping.assign",
  "housekeeping.complete",
  "maintenance.report",
  "maintenance.viewOwn",
  "maintenance.viewAll",
  "maintenance.manage",
  "maintenance.work",
  "energy.view",
  "energy.record",
  "inventory.view",
  "inventory.move",
  "inventory.manage",
  "staff.viewOwnShifts",
  "staff.view",
  "staff.manage",
  "operations.recordDaily",
  "finance.view",
  "reports.view",
  "reports.generate",
  "notifications.view",
  "ai.insights.view",
  "ai.assistant.use",
  "users.manage",
  "audit.view",
  "hotel.settings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleTier = "platform" | "executive" | "manager" | "staff";

const STAFF_COMMON: Permission[] = [
  "maintenance.report",
  "maintenance.viewOwn",
  "staff.viewOwnShifts",
  "notifications.view",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  superAdmin: PERMISSIONS,
  hotelOwner: [
    "dashboard.executive", "rooms.view", "housekeeping.viewAll", "maintenance.report",
    "maintenance.viewAll", "energy.view", "inventory.view", "staff.view", "finance.view",
    "reports.view", "reports.generate", "notifications.view", "ai.insights.view",
    "ai.assistant.use", "users.manage", "audit.view", "hotel.settings",
  ],
  generalManager: [
    "dashboard.executive", "dashboard.operations", "rooms.view", "rooms.updateStatus",
    "rooms.manage", "housekeeping.viewAll", "housekeeping.assign", "maintenance.report",
    "maintenance.viewAll", "maintenance.manage", "energy.view", "energy.record",
    "inventory.view", "inventory.move", "inventory.manage", "staff.view", "staff.manage",
    "operations.recordDaily", "finance.view", "reports.view", "reports.generate",
    "notifications.view", "ai.insights.view", "ai.assistant.use", "users.manage",
    "audit.view", "hotel.settings",
  ],
  operationsManager: [
    "dashboard.operations", "rooms.view", "rooms.updateStatus", "rooms.manage",
    "housekeeping.viewAll", "housekeeping.assign", "maintenance.report", "maintenance.viewAll",
    "maintenance.manage", "energy.view", "inventory.view", "staff.view", "staff.manage",
    "operations.recordDaily", "reports.view", "reports.generate", "notifications.view",
    "ai.insights.view", "ai.assistant.use",
  ],
  energyManager: [
    "dashboard.operations", "rooms.view", "energy.view", "energy.record", "maintenance.report",
    "maintenance.viewAll", "reports.view", "reports.generate", "notifications.view",
    "ai.insights.view", "ai.assistant.use",
  ],
  maintenanceManager: [
    "dashboard.operations", "rooms.view", "rooms.updateStatus", "maintenance.report",
    "maintenance.viewAll", "maintenance.manage", "maintenance.work", "energy.view",
    "inventory.view", "inventory.move", "staff.view", "reports.view", "reports.generate",
    "notifications.view", "ai.insights.view",
  ],
  housekeepingManager: [
    "dashboard.operations", "rooms.view", "rooms.updateStatus", "housekeeping.viewAll",
    "housekeeping.assign", "housekeeping.complete", "maintenance.report", "maintenance.viewOwn",
    "inventory.view", "inventory.move", "staff.view", "reports.view", "notifications.view",
    "ai.insights.view",
  ],
  restaurantManager: [
    "dashboard.operations", "inventory.view", "inventory.move", "maintenance.report",
    "maintenance.viewOwn", "staff.view", "reports.view", "notifications.view", "ai.insights.view",
  ],
  inventoryManager: [
    "dashboard.operations", "inventory.view", "inventory.move", "inventory.manage",
    "maintenance.report", "maintenance.viewOwn", "reports.view", "reports.generate",
    "notifications.view", "ai.insights.view",
  ],
  hrManager: [
    "dashboard.operations", "staff.view", "staff.manage", "users.manage", "maintenance.report",
    "maintenance.viewOwn", "reports.view", "notifications.view",
  ],
  receptionStaff: [...STAFF_COMMON, "rooms.view", "rooms.updateStatus", "operations.recordDaily"],
  housekeepingStaff: [
    ...STAFF_COMMON, "rooms.view", "rooms.updateStatus", "housekeeping.viewOwn",
    "housekeeping.complete",
  ],
  maintenanceStaff: [...STAFF_COMMON, "rooms.view", "maintenance.work"],
  restaurantStaff: [...STAFF_COMMON, "inventory.view"],
  analyst: [
    "dashboard.executive", "rooms.view", "housekeeping.viewAll", "maintenance.viewAll",
    "energy.view", "inventory.view", "staff.view", "finance.view", "reports.view",
    "reports.generate", "notifications.view", "ai.insights.view", "ai.assistant.use",
  ],
};

/** Roles each role may create/assign — prevents privilege escalation. */
export const ASSIGNABLE_ROLES: Partial<Record<Role, readonly Role[]>> = {
  superAdmin: ROLES,
  hotelOwner: ROLES.filter((r) => r !== "superAdmin" && r !== "hotelOwner"),
  generalManager: ROLES.filter(
    (r) => r !== "superAdmin" && r !== "hotelOwner" && r !== "generalManager",
  ),
  hrManager: ["receptionStaff", "housekeepingStaff", "maintenanceStaff", "restaurantStaff"],
};

export const ROLE_TIER: Record<Role, RoleTier> = {
  superAdmin: "platform",
  hotelOwner: "executive",
  generalManager: "executive",
  analyst: "executive",
  operationsManager: "manager",
  energyManager: "manager",
  maintenanceManager: "manager",
  housekeepingManager: "manager",
  restaurantManager: "manager",
  inventoryManager: "manager",
  hrManager: "manager",
  receptionStaff: "staff",
  housekeepingStaff: "staff",
  maintenanceStaff: "staff",
  restaurantStaff: "staff",
};

/** Room status transitions per staff role (roles with `rooms.manage` may set any). */
export const ROOM_TRANSITIONS: Partial<Record<Role, Record<string, string[]>>> = {
  housekeepingStaff: {
    vacantDirty: ["cleaningInProgress"],
    cleaningInProgress: ["vacantClean"],
  },
  housekeepingManager: {
    vacantDirty: ["cleaningInProgress", "vacantClean"],
    cleaningInProgress: ["vacantClean", "vacantDirty"],
    vacantClean: ["vacantDirty"],
    outOfOrder: ["vacantDirty"],
  },
  receptionStaff: {
    vacantClean: ["occupied"],
    occupied: ["vacantDirty"],
  },
  maintenanceManager: {
    vacantClean: ["outOfOrder"],
    vacantDirty: ["outOfOrder"],
    outOfOrder: ["vacantDirty"],
  },
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAssign(actor: Role, target: Role): boolean {
  return (ASSIGNABLE_ROLES[actor] ?? []).includes(target);
}

/** Roles holding [permission] (used for notification targeting and rules generation). */
export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter((r) => r !== "superAdmin" && can(r, permission));
}
