import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { AUTH_EMAIL_DOMAIN, INTEGRATION_SECRET, REGION } from "../config";
import {
  authEmailFor,
  isValidNationalId,
  maskNationalId,
  normalizeNationalId,
} from "../domain/national-id";
import { canAssign, isRole, ROLES, Role, ROLE_TIER } from "../domain/rbac";
import { auth, db, FieldValue, paths } from "../lib/admin";
import { writeAudit } from "../lib/audit";
import { invalid, requireCaller, requireHotel, requirePermission } from "../lib/guards";
import { emitEvent } from "../lib/n8n";

const password = z
  .string()
  .min(8)
  .regex(/[A-Za-z]/)
  .regex(/\d/);

const CreateUser = z.object({
  hotelId: z.string().min(1),
  nationalId: z.string().min(10).max(20),
  fullName: z.string().trim().min(3).max(80),
  phone: z.string().trim().max(20).nullish(),
  role: z.enum(ROLES),
  temporaryPassword: password,
});

/** Custom claims are the security source of truth for role and tenancy. */
export async function applyClaims(uid: string, role: Role, hotelIds: string[]): Promise<void> {
  await auth.setCustomUserClaims(uid, { role, hotelIds, v: 1 });
}

/**
 * Creates a staff account identified by national ID.
 * Only roles with `users.manage` may call it, and only for roles they are
 * allowed to assign (HR cannot create a General Manager, etc.).
 */
export const adminCreateUser = onCall(
  { region: REGION, secrets: [INTEGRATION_SECRET], enforceAppCheck: false },
  async (request) => {
    const caller = requireCaller(request);
    const parsed = CreateUser.safeParse(request.data);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      throw invalid(field === "temporaryPassword" ? "weak_password" : "invalid_input");
    }
    const input = parsed.data;
    const hotelId = requireHotel(caller, input.hotelId);
    requirePermission(caller, "users.manage");
    if (!canAssign(caller.role, input.role)) {
      throw new HttpsError("permission-denied", "Role not assignable", { code: "role_not_assignable" });
    }
    const nationalId = normalizeNationalId(input.nationalId);
    if (!isValidNationalId(nationalId)) throw invalid("invalid_national_id");

    const email = authEmailFor(nationalId, AUTH_EMAIL_DOMAIN);
    const exists = await auth.getUserByEmail(email).then(
      () => true,
      (err: { code?: string }) => {
        if (err.code === "auth/user-not-found") return false;
        throw err;
      },
    );
    if (exists) throw invalid("national_id_exists");

    const user = await auth.createUser({
      email,
      password: input.temporaryPassword,
      displayName: input.fullName,
      disabled: false,
    });
    await applyClaims(user.uid, input.role, [hotelId]);

    const staffRef = db.collection(paths.staff(hotelId)).doc();
    const batch = db.batch();
    batch.set(db.doc(paths.user(user.uid)), {
      nationalId,
      nationalIdMasked: maskNationalId(nationalId),
      fullName: input.fullName,
      phone: input.phone ?? null,
      role: input.role,
      hotelIds: [hotelId],
      primaryHotelId: hotelId,
      staffId: staffRef.id,
      status: "active",
      mustChangePassword: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid,
    });
    batch.set(db.doc(`${paths.members(hotelId)}/${user.uid}`), {
      fullName: input.fullName,
      nationalIdMasked: maskNationalId(nationalId),
      phone: input.phone ?? null,
      role: input.role,
      tier: ROLE_TIER[input.role],
      status: "active",
      lastLoginAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(staffRef, {
      fullName: input.fullName,
      department: departmentOf(input.role),
      position: input.role,
      role: input.role,
      userId: user.uid,
      phone: input.phone ?? null,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    await writeAudit(hotelId, {
      action: "user.create",
      resource: { collection: "users", id: user.uid },
      actor: { uid: caller.uid, role: caller.role, type: "user" },
      changes: { role: { from: null, to: input.role } },
      source: "function",
    });
    await emitEvent("user.created", hotelId, { uid: user.uid, role: input.role });
    return { uid: user.uid };
  },
);

const SetStatus = z.object({
  hotelId: z.string().min(1),
  uid: z.string().min(1),
  status: z.enum(["active", "suspended", "disabled"]),
});

/** Suspends / re-activates an account and revokes its sessions. */
export const adminSetUserStatus = onCall({ region: REGION }, async (request) => {
  const caller = requireCaller(request);
  const input = SetStatus.parse(request.data);
  const hotelId = requireHotel(caller, input.hotelId);
  requirePermission(caller, "users.manage");
  const target = await loadManagedUser(hotelId, input.uid);
  if (!canAssign(caller.role, target.role) || input.uid === caller.uid) {
    throw new HttpsError("permission-denied", "Cannot manage this user");
  }
  const disabled = input.status !== "active";
  await auth.updateUser(input.uid, { disabled });
  if (disabled) await auth.revokeRefreshTokens(input.uid);
  const batch = db.batch();
  batch.update(db.doc(paths.user(input.uid)), { status: input.status });
  batch.update(db.doc(`${paths.members(hotelId)}/${input.uid}`), { status: input.status });
  await batch.commit();
  await writeAudit(hotelId, {
    action: `user.status.${input.status}`,
    resource: { collection: "users", id: input.uid },
    actor: { uid: caller.uid, role: caller.role, type: "user" },
    source: "function",
  });
  return { ok: true };
});

const ResetPassword = z.object({
  hotelId: z.string().min(1),
  uid: z.string().min(1),
  temporaryPassword: password,
});

export const adminResetPassword = onCall({ region: REGION }, async (request) => {
  const caller = requireCaller(request);
  const input = ResetPassword.parse(request.data);
  const hotelId = requireHotel(caller, input.hotelId);
  requirePermission(caller, "users.manage");
  const target = await loadManagedUser(hotelId, input.uid);
  if (!canAssign(caller.role, target.role)) {
    throw new HttpsError("permission-denied", "Cannot manage this user");
  }
  await auth.updateUser(input.uid, { password: input.temporaryPassword });
  await auth.revokeRefreshTokens(input.uid);
  await db.doc(paths.user(input.uid)).update({ mustChangePassword: true });
  await writeAudit(hotelId, {
    action: "user.resetPassword",
    resource: { collection: "users", id: input.uid },
    actor: { uid: caller.uid, role: caller.role, type: "user" },
    source: "function",
  });
  return { ok: true };
});

const UpdateRole = z.object({
  hotelId: z.string().min(1),
  uid: z.string().min(1),
  role: z.enum(ROLES),
});

/** Changes a user's role; takes effect on the user's next token refresh. */
export const adminUpdateRole = onCall({ region: REGION }, async (request) => {
  const caller = requireCaller(request);
  const input = UpdateRole.parse(request.data);
  const hotelId = requireHotel(caller, input.hotelId);
  requirePermission(caller, "users.manage");
  const target = await loadManagedUser(hotelId, input.uid);
  if (!canAssign(caller.role, target.role) || !canAssign(caller.role, input.role)) {
    throw new HttpsError("permission-denied", "Role not assignable", { code: "role_not_assignable" });
  }
  const userSnap = await db.doc(paths.user(input.uid)).get();
  const hotelIds = (userSnap.get("hotelIds") as string[] | undefined) ?? [hotelId];
  await applyClaims(input.uid, input.role, hotelIds);
  await auth.revokeRefreshTokens(input.uid);
  const batch = db.batch();
  batch.update(db.doc(paths.user(input.uid)), { role: input.role });
  batch.update(db.doc(`${paths.members(hotelId)}/${input.uid}`), {
    role: input.role,
    tier: ROLE_TIER[input.role],
  });
  await batch.commit();
  await writeAudit(hotelId, {
    action: "user.role",
    resource: { collection: "users", id: input.uid },
    actor: { uid: caller.uid, role: caller.role, type: "user" },
    changes: { role: { from: target.role, to: input.role } },
    source: "function",
  });
  return { ok: true };
});

async function loadManagedUser(hotelId: string, uid: string): Promise<{ role: Role }> {
  const member = await db.doc(`${paths.members(hotelId)}/${uid}`).get();
  const role = member.get("role");
  if (!member.exists || !isRole(role)) throw new HttpsError("not-found", "User not found");
  return { role };
}

export function departmentOf(role: Role): string {
  switch (role) {
    case "receptionStaff":
      return "frontOffice";
    case "housekeepingManager":
    case "housekeepingStaff":
      return "housekeeping";
    case "maintenanceManager":
    case "maintenanceStaff":
      return "maintenance";
    case "energyManager":
      return "energy";
    case "restaurantManager":
    case "restaurantStaff":
      return "foodAndBeverage";
    case "inventoryManager":
      return "inventory";
    case "hrManager":
      return "humanResources";
    case "analyst":
      return "analytics";
    default:
      return "management";
  }
}
