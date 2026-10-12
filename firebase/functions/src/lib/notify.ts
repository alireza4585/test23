import * as logger from "firebase-functions/logger";

import { Role } from "../domain/rbac";
import { db, FieldValue, messaging, paths } from "./admin";

export type Severity = "info" | "warning" | "critical";
export type NotificationCategory =
  | "alert"
  | "task"
  | "maintenance"
  | "inventory"
  | "report"
  | "ai"
  | "system";

export interface NotificationRequest {
  hotelId: string;
  roles?: Role[];
  userIds?: string[];
  title: string;
  body: string;
  category: NotificationCategory;
  severity: Severity;
  /** In-app deep link; goes through the app's route guard. */
  route?: string;
  createdBy?: string;
}

/**
 * Resolves the audience (roles and/or explicit users within the hotel),
 * writes one inbox document per recipient and sends a push to their active
 * devices. Also keeps a hotel-level record for audit.
 */
export async function notify(req: NotificationRequest): Promise<number> {
  const recipients = new Set<string>(req.userIds ?? []);
  if (req.roles && req.roles.length > 0) {
    for (let i = 0; i < req.roles.length; i += 30) {
      const snap = await db
        .collection(paths.members(req.hotelId))
        .where("role", "in", req.roles.slice(i, i + 30))
        .where("status", "==", "active")
        .get();
      snap.docs.forEach((d) => recipients.add(d.id));
    }
  }
  if (recipients.size === 0) return 0;

  const record = db.collection(paths.notifications(req.hotelId)).doc();
  const batch = db.batch();
  batch.set(record, {
    title: req.title,
    body: req.body,
    category: req.category,
    severity: req.severity,
    route: req.route ?? null,
    audienceRoles: req.roles ?? [],
    audienceUserIds: req.userIds ?? [],
    recipientCount: recipients.size,
    createdBy: req.createdBy ?? "system",
    createdAt: FieldValue.serverTimestamp(),
  });
  for (const uid of recipients) {
    batch.set(db.doc(`${paths.inbox(uid)}/${record.id}`), {
      hotelId: req.hotelId,
      title: req.title,
      body: req.body,
      category: req.category,
      severity: req.severity,
      route: req.route ?? null,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });
  }
  await batch.commit();
  await push([...recipients], req);
  return recipients.size;
}

async function push(uids: string[], req: NotificationRequest): Promise<void> {
  const tokens: string[] = [];
  for (const uid of uids) {
    const sessions = await db
      .collection(paths.sessions(uid))
      .where("revokedAt", "==", null)
      .get();
    sessions.docs.forEach((s) => {
      const t = s.get("pushToken");
      if (typeof t === "string" && t.length > 0) tokens.push(t);
    });
  }
  for (let i = 0; i < tokens.length; i += 500) {
    try {
      const res = await messaging.sendEachForMulticast({
        tokens: tokens.slice(i, i + 500),
        notification: { title: req.title, body: req.body },
        data: { route: req.route ?? "", category: req.category, severity: req.severity },
        android: { priority: req.severity === "critical" ? "high" : "normal" },
        apns: { payload: { aps: { sound: req.severity === "critical" ? "default" : undefined } } },
      });
      if (res.failureCount > 0) {
        logger.info("push partially failed", { failures: res.failureCount });
      }
    } catch (err) {
      logger.warn("push failed", { err: String(err) });
    }
  }
}
