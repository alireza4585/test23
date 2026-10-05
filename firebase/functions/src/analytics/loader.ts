import { Timestamp } from "firebase-admin/firestore";

import { db, paths } from "../lib/admin";
import {
  DEFAULT_SETTINGS,
  EnergyReadingRow,
  HotelSettings,
  ItemRow,
  MovementRow,
  OperationsDay,
  RoomRow,
  TaskRow,
  TicketRow,
} from "./types";

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

export interface HotelData {
  hotelId: string;
  name: string;
  settings: HotelSettings;
  operations: OperationsDay[];
  energy: EnergyReadingRow[];
  tickets: TicketRow[];
  tasks: TaskRow[];
  items: ItemRow[];
  movements: MovementRow[];
  rooms: RoomRow[];
}

/** Loads everything the analytics engine needs for one hotel (bounded windows). */
export async function loadHotelData(hotelId: string, fromDay: string, now: Date): Promise<HotelData> {
  const hotel = await db.doc(paths.hotel(hotelId)).get();
  const s = (hotel.get("settings") ?? {}) as Partial<HotelSettings>;
  const settings: HotelSettings = {
    energyDailyBaseline: { ...DEFAULT_SETTINGS.energyDailyBaseline, ...s.energyDailyBaseline },
    energyTariff: { ...DEFAULT_SETTINGS.energyTariff, ...s.energyTariff },
    energyAlertThresholdPct: s.energyAlertThresholdPct ?? DEFAULT_SETTINGS.energyAlertThresholdPct,
    maintenanceSlaHours: { ...DEFAULT_SETTINGS.maintenanceSlaHours, ...s.maintenanceSlaHours },
    targetCleanMinutes: { ...DEFAULT_SETTINGS.targetCleanMinutes, ...s.targetCleanMinutes },
  };
  const since = new Date(now.getTime() - 45 * 864e5);

  const [ops, energy, tickets, tasks, items, movements, rooms] = await Promise.all([
    db.collection(paths.operations(hotelId)).where("day", ">=", fromDay).orderBy("day").get(),
    db.collection(paths.energy(hotelId)).where("day", ">=", fromDay).orderBy("day").get(),
    db.collection(paths.tickets(hotelId)).where("createdAt", ">=", Timestamp.fromDate(since)).get(),
    db.collection(paths.tasks(hotelId)).where("day", ">=", fromDay).get(),
    db.collection(paths.items(hotelId)).get(),
    db.collection(paths.movements(hotelId)).where("createdAt", ">=", Timestamp.fromDate(since)).get(),
    db.collection(paths.rooms(hotelId)).get(),
  ]);

  return {
    hotelId,
    name: (hotel.get("name") as string) ?? hotelId,
    settings,
    operations: ops.docs.map((d) => ({
      day: d.get("day"),
      roomsAvailable: d.get("roomsAvailable") ?? 0,
      roomsOccupied: d.get("roomsOccupied") ?? 0,
      roomRevenue: d.get("roomRevenue") ?? 0,
      fnbRevenue: d.get("fnbRevenue") ?? 0,
      otherRevenue: d.get("otherRevenue") ?? 0,
    })),
    energy: energy.docs.map((d) => ({
      day: d.get("day"),
      type: d.get("type"),
      consumption: d.get("consumption") ?? 0,
    })),
    tickets: tickets.docs.map((d) => ({
      id: d.id,
      title: d.get("title") ?? "",
      category: d.get("category") ?? "other",
      priority: d.get("priority") ?? "medium",
      status: d.get("status") ?? "open",
      roomId: d.get("roomId") ?? null,
      roomNumber: d.get("roomNumber") ?? null,
      area: d.get("area") ?? null,
      createdAt: toDate(d.get("createdAt")) ?? now,
      slaDueAt: toDate(d.get("slaDueAt")),
      resolvedAt: toDate(d.get("resolvedAt")),
    })),
    tasks: tasks.docs.map((d) => ({
      type: d.get("type"),
      status: d.get("status"),
      day: d.get("day"),
      startedAt: toDate(d.get("startedAt")),
      completedAt: toDate(d.get("completedAt")),
    })),
    items: items.docs.map((d) => ({
      id: d.id,
      name: d.get("name") ?? d.id,
      unit: d.get("unit") ?? "",
      quantity: d.get("quantity") ?? 0,
      reorderLevel: d.get("reorderLevel") ?? 0,
      reorderQuantity: d.get("reorderQuantity") ?? 0,
      unitCost: d.get("unitCost") ?? null,
    })),
    movements: movements.docs.map((d) => ({
      itemId: d.get("itemId"),
      type: d.get("type"),
      delta: d.get("delta") ?? 0,
      createdAt: toDate(d.get("createdAt")) ?? now,
    })),
    rooms: rooms.docs.map((d) => ({
      id: d.id,
      number: d.get("number") ?? d.id,
      status: d.get("status") ?? "vacantDirty",
      updatedAt: toDate(d.get("updatedAt")),
    })),
  };
}

/** Active hotels (subscription not cancelled). */
export async function activeHotelIds(): Promise<string[]> {
  const snap = await db.collection("hotels").where("status", "==", "active").get();
  return snap.docs.map((d) => d.id);
}
