import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";

import { REGION } from "../config";
import { diff, writeAudit } from "../lib/audit";

/** Collections whose every change is recorded in the audit log. */
const AUDITED = new Set([
  "rooms",
  "tasks",
  "maintenanceTickets",
  "energyReadings",
  "dailyOperations",
  "inventoryItems",
  "inventoryMovements",
  "shifts",
  "staff",
  "alerts",
  "aiInsights",
  "reports",
  "roleOverrides",
]);

/**
 * Single wildcard trigger over all hotel sub-collections. Uses the
 * auth-context variant so the audit entry names the real principal
 * (end-user uid, service account, or the Firestore system) — values the
 * client cannot forge, unlike the `updatedBy` stamps it writes itself.
 */
export const auditHotelWrites = onDocumentWrittenWithAuthContext(
  { region: REGION, document: "hotels/{hotelId}/{collectionId}/{docId}" },
  async (event) => {
    const { hotelId, collectionId, docId } = event.params;
    if (!AUDITED.has(collectionId)) return;
    const before = event.data?.before.exists ? event.data.before.data() : undefined;
    const after = event.data?.after.exists ? event.data.after.data() : undefined;
    const action = !before ? "create" : !after ? "delete" : "update";
    const changes = diff(before, after);
    if (action === "update" && Object.keys(changes).length === 0) return;

    // End-user writes arrive as an app-user principal; Admin SDK writes
    // (functions, n8n API) as a service account / system.
    const isServer = event.authType === "service_account" || event.authType === "system";
    const stamp = (after?.updatedBy ?? after?.createdBy ?? after?.actor ?? after?.recordedBy) as
      | { uid?: string; role?: string; name?: string }
      | undefined;
    await writeAudit(hotelId, {
      action: `${collectionId}.${action}`,
      resource: { collection: collectionId, id: docId },
      actor: {
        uid: event.authId ?? "unknown",
        role: stamp?.role ?? null,
        name: stamp?.name ?? null,
        type: isServer ? "system" : "user",
      },
      changes,
      source: isServer ? "function" : "client",
    });
  },
);
