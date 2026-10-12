import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

import { can, isRole, Permission, Role } from "../domain/rbac";

export interface Caller {
  uid: string;
  role: Role;
  hotelIds: string[];
  name: string;
}

/**
 * Resolves the caller from verified ID-token claims. Claims are set only by
 * this backend (`adminCreateUser` / `adminUpdateRole`), so they are the
 * authority for role and tenant membership.
 */
export function requireCaller(request: CallableRequest<unknown>): Caller {
  const token = request.auth?.token;
  if (!request.auth || !token) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const role = token.role;
  if (!isRole(role)) {
    throw new HttpsError("permission-denied", "Account not provisioned");
  }
  const hotelIds = Array.isArray(token.hotelIds)
    ? (token.hotelIds as unknown[]).filter((h): h is string => typeof h === "string")
    : [];
  return {
    uid: request.auth.uid,
    role,
    hotelIds,
    name: typeof token.name === "string" ? token.name : request.auth.uid,
  };
}

export function requireHotel(caller: Caller, hotelId: unknown): string {
  if (typeof hotelId !== "string" || hotelId.length === 0) {
    throw new HttpsError("invalid-argument", "hotelId required");
  }
  if (caller.role !== "superAdmin" && !caller.hotelIds.includes(hotelId)) {
    throw new HttpsError("permission-denied", "Not a member of this hotel");
  }
  return hotelId;
}

export function requirePermission(caller: Caller, permission: Permission): void {
  if (!can(caller.role, permission)) {
    throw new HttpsError("permission-denied", `Missing permission ${permission}`);
  }
}

/** Validation error carrying a stable code the app maps to a message. */
export function invalid(code: string, message = code): HttpsError {
  return new HttpsError("invalid-argument", message, { code });
}
