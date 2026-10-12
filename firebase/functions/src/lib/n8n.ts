import * as logger from "firebase-functions/logger";

import { INTEGRATION_SECRET, N8N_WEBHOOK_URL } from "../config";
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./signature";

export type IntegrationEventType =
  | "maintenance.ticket.created"
  | "maintenance.ticket.updated"
  | "energy.anomaly"
  | "inventory.lowStock"
  | "alert.raised"
  | "insight.created"
  | "user.created";

/**
 * Publishes a domain event to n8n (single webhook; n8n routes on `type`).
 * Fire-and-forget: automation must never break the operational write path.
 * Functions that call this must bind the INTEGRATION_SECRET secret.
 */
export async function emitEvent(
  type: IntegrationEventType,
  hotelId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const url = N8N_WEBHOOK_URL.value();
  if (!url) return;
  const body = JSON.stringify({
    id: `${type}:${hotelId}:${Date.now()}`,
    type,
    hotelId,
    occurredAt: new Date().toISOString(),
    data,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: sign(INTEGRATION_SECRET.value(), timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) logger.warn("n8n webhook rejected event", { type, status: res.status });
  } catch (err) {
    logger.warn("n8n webhook unreachable", { type, err: String(err) });
  }
}
