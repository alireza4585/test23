import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { REGION } from "../config";
import { auth, db, FieldValue, paths } from "../lib/admin";
import { writeAudit } from "../lib/audit";
import { requireCaller } from "../lib/guards";

const RegisterSession = z.object({
  deviceId: z.string().min(8).max(64),
  platform: z.enum(["android", "ios", "other"]),
  model: z.string().max(80).default(""),
  osVersion: z.string().max(40).default(""),
  appVersion: z.string().max(20).default(""),
  pushToken: z.string().max(4096).nullish(),
});

/**
 * Called by the app right after sign-in. Records the device (for "active
 * devices" and push), stamps `lastLoginAt` and writes the login to the audit
 * log of every hotel the user belongs to — server-side, so it can't be forged.
 */
export const authRegisterSession = onCall({ region: REGION }, async (request) => {
  const caller = requireCaller(request);
  const input = RegisterSession.parse(request.data);
  const sessionRef = db.doc(`${paths.sessions(caller.uid)}/${input.deviceId}`);
  const existing = await sessionRef.get();

  const batch = db.batch();
  batch.set(
    sessionRef,
    {
      platform: input.platform,
      model: input.model,
      osVersion: input.osVersion,
      appVersion: input.appVersion,
      pushToken: input.pushToken ?? null,
      lastSeenAt: FieldValue.serverTimestamp(),
      revokedAt: null,
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );
  batch.update(db.doc(paths.user(caller.uid)), { lastLoginAt: FieldValue.serverTimestamp() });
  for (const hotelId of caller.hotelIds) {
    batch.set(
      db.doc(`${paths.members(hotelId)}/${caller.uid}`),
      { lastLoginAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await batch.commit();

  await Promise.all(
    caller.hotelIds.map((hotelId) =>
      writeAudit(hotelId, {
        action: "auth.login",
        resource: { collection: "users", id: caller.uid },
        actor: { uid: caller.uid, role: caller.role, type: "user" },
        changes: { device: { from: null, to: `${input.platform} ${input.model}` } },
        source: "function",
      }),
    ),
  );
  return { ok: true };
});

/**
 * Signs a user out everywhere: revokes refresh tokens (ID tokens expire
 * within the hour; the app also listens to its profile status) and marks all
 * device sessions revoked so pushes stop.
 */
export const authRevokeSessions = onCall({ region: REGION }, async (request) => {
  const caller = requireCaller(request);
  const target = typeof request.data?.uid === "string" ? request.data.uid : caller.uid;
  if (target !== caller.uid && caller.role !== "superAdmin") {
    throw new HttpsError("permission-denied", "Use adminSetUserStatus for other users");
  }
  await auth.revokeRefreshTokens(target);
  const sessions = await db.collection(paths.sessions(target)).where("revokedAt", "==", null).get();
  const batch = db.batch();
  sessions.docs.forEach((s) =>
    batch.update(s.ref, { revokedAt: FieldValue.serverTimestamp(), pushToken: null }),
  );
  await batch.commit();
  return { revoked: sessions.size };
});
