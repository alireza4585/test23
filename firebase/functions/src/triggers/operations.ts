import * as logger from "firebase-functions/logger";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";

import { DEFAULT_SETTINGS } from "../analytics/types";
import { INTEGRATION_SECRET, REGION } from "../config";
import { db, FieldValue, paths } from "../lib/admin";
import { raiseAlert, resolveAlert } from "../lib/alerts";
import { emitEvent } from "../lib/n8n";
import { notify } from "../lib/notify";

const opts = { region: REGION, secrets: [INTEGRATION_SECRET] };

/**
 * New fault report → alert managers on high/critical, notify the
 * maintenance manager otherwise, take a vacant room out of order on
 * critical faults, and publish to n8n (SMS/Bale escalation workflows).
 */
export const onTicketCreated = onDocumentCreated(
  { ...opts, document: "hotels/{hotelId}/maintenanceTickets/{ticketId}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const { hotelId, ticketId } = event.params;
    const t = snap.data();
    const location = (t.roomNumber as string | undefined) ? `اتاق ${t.roomNumber}` : (t.area ?? "—");
    const route = `/maintenance/${ticketId}`;

    if (t.priority === "critical" || t.priority === "high") {
      await raiseAlert({
        hotelId,
        type: "criticalTicket",
        severity: t.priority === "critical" ? "critical" : "warning",
        title: `خرابی ${t.priority === "critical" ? "بحرانی" : "مهم"}: ${t.title}`,
        message: `محل: ${location}`,
        route,
        audienceRoles: ["maintenanceManager", "operationsManager"],
        dedupeKey: `ticket_${ticketId}`,
        data: { ticketId, priority: t.priority, category: t.category },
      });
    } else {
      await notify({
        hotelId,
        roles: ["maintenanceManager"],
        title: "خرابی جدید ثبت شد",
        body: `${t.title} — ${location}`,
        category: "maintenance",
        severity: "info",
        route,
      });
    }

    if (t.priority === "critical" && typeof t.roomId === "string") {
      const roomRef = db.doc(`${paths.rooms(hotelId)}/${t.roomId}`);
      await db.runTransaction(async (tx) => {
        const room = await tx.get(roomRef);
        const status = room.get("status");
        if (room.exists && (status === "vacantClean" || status === "vacantDirty")) {
          tx.update(roomRef, {
            status: "outOfOrder",
            previousStatus: status,
            note: t.title,
            updatedAt: FieldValue.serverTimestamp(),
            updatedByName: "Zarin Automation",
            updatedBy: { uid: "system", name: "Zarin Automation", role: "system" },
          });
        }
      });
    }

    await emitEvent("maintenance.ticket.created", hotelId, {
      ticketId,
      title: t.title,
      category: t.category,
      priority: t.priority,
      location,
      reportedByName: t.reportedByName,
      slaDueAt: t.slaDueAt?.toDate?.()?.toISOString?.() ?? null,
    });
  },
);

/** Assignment → notify the technician; resolution → notify the reporter. */
export const onTicketUpdated = onDocumentUpdated(
  { ...opts, document: "hotels/{hotelId}/maintenanceTickets/{ticketId}" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const { hotelId, ticketId } = event.params;
    const route = `/maintenance/${ticketId}`;

    if (after.assigneeId && after.assigneeId !== before.assigneeId) {
      await notify({
        hotelId,
        userIds: [after.assigneeId],
        title: "تیکت جدید به شما ارجاع شد",
        body: after.title,
        category: "maintenance",
        severity: after.priority === "critical" ? "critical" : "warning",
        route,
      });
    }
    if (after.status !== before.status) {
      if (after.status === "resolved" && after.reportedById) {
        await notify({
          hotelId,
          userIds: [after.reportedById],
          title: "خرابی گزارش‌شده رفع شد",
          body: after.title,
          category: "maintenance",
          severity: "info",
          route,
        });
      }
      if (["resolved", "closed", "cancelled"].includes(after.status)) {
        await resolveAlert(hotelId, `ticket_${ticketId}`);
        await resolveAlert(hotelId, `sla_${ticketId}`);
      }
      await emitEvent("maintenance.ticket.updated", hotelId, {
        ticketId,
        from: before.status,
        to: after.status,
        assigneeName: after.assigneeName ?? null,
      });
    }
  },
);

/** Daily reading above baseline + threshold → energy anomaly alert. */
export const onEnergyReadingWritten = onDocumentWritten(
  { ...opts, document: "hotels/{hotelId}/energyReadings/{readingId}" },
  async (event) => {
    const after = event.data?.after.data();
    if (!after) return;
    const { hotelId } = event.params;
    const hotel = await db.doc(paths.hotel(hotelId)).get();
    const settings = hotel.get("settings") ?? {};
    const type = after.type as string;
    const baseline: number =
      settings.energyDailyBaseline?.[type] ?? DEFAULT_SETTINGS.energyDailyBaseline[type] ?? 0;
    const threshold: number = settings.energyAlertThresholdPct ?? DEFAULT_SETTINGS.energyAlertThresholdPct;
    if (baseline <= 0) return;
    const deviation = ((after.consumption - baseline) / baseline) * 100;
    if (deviation <= threshold) return;
    const label: Record<string, string> = { electricity: "برق", water: "آب", gas: "گاز" };
    const raised = await raiseAlert({
      hotelId,
      type: "energySpike",
      severity: deviation > threshold * 2 ? "critical" : "warning",
      title: `مصرف ${label[type] ?? type} بالاتر از خط مبنا`,
      message: `${Math.round(after.consumption)} ${after.unit ?? ""} در ${after.day} (${Math.round(deviation)}٪ بیش از خط مبنا)`,
      route: "/energy",
      audienceRoles: ["energyManager", "operationsManager", "hotelOwner"],
      dedupeKey: `energy_${after.day}_${type}`,
      data: { day: after.day, type, consumption: after.consumption, baseline, deviation },
    });
    if (raised) {
      await emitEvent("energy.anomaly", hotelId, { day: after.day, type, consumption: after.consumption, baseline, deviation });
    }
  },
);

/** Stock crossing the reorder point raises / clears a low-stock alert. */
export const onInventoryItemUpdated = onDocumentUpdated(
  { ...opts, document: "hotels/{hotelId}/inventoryItems/{itemId}" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const { hotelId, itemId } = event.params;
    const wasLow = before.quantity <= before.reorderLevel;
    const isLow = after.quantity <= after.reorderLevel;
    if (!wasLow && isLow) {
      const raised = await raiseAlert({
        hotelId,
        type: "lowStock",
        severity: after.quantity <= 0 ? "critical" : "warning",
        title: `کمبود موجودی: ${after.name}`,
        message: `موجودی ${after.quantity} ${after.unit}، نقطه سفارش ${after.reorderLevel}`,
        route: `/inventory/${itemId}`,
        audienceRoles: ["inventoryManager"],
        dedupeKey: `lowstock_${itemId}`,
        data: { itemId, sku: after.sku, quantity: after.quantity, reorderQuantity: after.reorderQuantity ?? 0 },
      });
      if (raised) {
        await emitEvent("inventory.lowStock", hotelId, {
          itemId,
          name: after.name,
          sku: after.sku,
          quantity: after.quantity,
          reorderLevel: after.reorderLevel,
          reorderQuantity: after.reorderQuantity ?? 0,
          supplier: after.supplier ?? null,
        });
      }
    } else if (wasLow && !isLow) {
      await resolveAlert(hotelId, `lowstock_${itemId}`);
    }
  },
);

/**
 * Housekeeping tasks: notify the assignee on assignment and record the
 * server-measured duration on completion (feeds productivity analytics).
 */
export const onTaskWritten = onDocumentWritten(
  { region: REGION, document: "hotels/{hotelId}/tasks/{taskId}" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) return;
    const { hotelId } = event.params;
    if (after.assigneeId && after.assigneeId !== before?.assigneeId) {
      await notify({
        hotelId,
        userIds: [after.assigneeId],
        title: "وظیفه جدید نظافت",
        body: `اتاق ${after.roomNumber}`,
        category: "task",
        severity: after.priority === "urgent" ? "warning" : "info",
        route: "/housekeeping",
      });
    }
    if (after.status === "done" && before?.status !== "done" && after.startedAt && after.completedAt) {
      const minutes = (after.completedAt.toMillis() - after.startedAt.toMillis()) / 60000;
      await event.data!.after.ref.update({ durationMinutes: Math.round(minutes * 10) / 10 });
      logger.debug("task duration recorded", { minutes });
    }
  },
);
