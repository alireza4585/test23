import { Role } from "../domain/rbac";
import { db, FieldValue, paths } from "./admin";
import { emitEvent } from "./n8n";
import { notify, Severity } from "./notify";

export type AlertType =
  | "energySpike"
  | "lowStock"
  | "maintenanceSla"
  | "criticalTicket"
  | "system"
  | "ai";

export interface AlertRequest {
  hotelId: string;
  type: AlertType;
  severity: Severity;
  title: string;
  message: string;
  route?: string;
  audienceRoles: Role[];
  /** Idempotency key: the same condition never raises two open alerts. */
  dedupeKey: string;
  source?: "ruleEngine" | "trigger" | "n8n" | "iot" | "ai";
  data?: Record<string, unknown>;
}

/**
 * Raises an alert once per [AlertRequest.dedupeKey] (re-raised only after the
 * previous one was resolved), notifies the audience and publishes an
 * `alert.raised` event to n8n for external channels (SMS / e-mail / Bale).
 */
export async function raiseAlert(req: AlertRequest): Promise<boolean> {
  const ref = db.doc(`${paths.alerts(req.hotelId)}/${req.dedupeKey}`);
  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get("status") !== "resolved") return false;
    tx.set(ref, {
      type: req.type,
      severity: req.severity,
      title: req.title,
      message: req.message,
      route: req.route ?? null,
      audienceRoles: Array.from(new Set<Role>(["generalManager", "hotelOwner", ...req.audienceRoles])),
      status: "open",
      source: req.source ?? "trigger",
      data: req.data ?? {},
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!created) return false;

  await notify({
    hotelId: req.hotelId,
    roles: req.audienceRoles,
    title: req.title,
    body: req.message,
    category: "alert",
    severity: req.severity,
    route: req.route,
  });
  await emitEvent("alert.raised", req.hotelId, {
    alertId: req.dedupeKey,
    type: req.type,
    severity: req.severity,
    title: req.title,
    message: req.message,
    audienceRoles: req.audienceRoles,
    ...req.data,
  });
  return true;
}

export async function resolveAlert(hotelId: string, dedupeKey: string): Promise<void> {
  const ref = db.doc(`${paths.alerts(hotelId)}/${dedupeKey}`);
  const snap = await ref.get();
  if (snap.exists && snap.get("status") !== "resolved") {
    await ref.update({ status: "resolved", resolvedAt: FieldValue.serverTimestamp() });
  }
}
