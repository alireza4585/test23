/** Plain data shapes read from Firestore (subset of fields the engine uses). */

export interface HotelSettings {
  energyDailyBaseline: Record<string, number>;
  energyTariff: Record<string, number>;
  energyAlertThresholdPct: number;
  maintenanceSlaHours: Record<string, number>;
  targetCleanMinutes: Record<string, number>;
}

export const DEFAULT_SETTINGS: HotelSettings = {
  energyDailyBaseline: { electricity: 2400, water: 38, gas: 310 },
  energyTariff: { electricity: 3200, water: 21000, gas: 4100 },
  energyAlertThresholdPct: 15,
  maintenanceSlaHours: { critical: 2, high: 8, medium: 24, low: 72 },
  targetCleanMinutes: { checkoutClean: 35, stayoverClean: 20, deepClean: 90, inspection: 10, turndown: 10 },
};

export interface OperationsDay {
  day: string;
  roomsAvailable: number;
  roomsOccupied: number;
  roomRevenue: number;
  fnbRevenue?: number;
  otherRevenue?: number;
}

export interface EnergyReadingRow {
  day: string;
  type: "electricity" | "water" | "gas";
  consumption: number;
}

export interface TicketRow {
  id: string;
  title: string;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  status: string;
  roomId?: string | null;
  roomNumber?: string | null;
  area?: string | null;
  createdAt: Date;
  slaDueAt?: Date | null;
  resolvedAt?: Date | null;
}

export interface TaskRow {
  type: string;
  status: string;
  day: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface ItemRow {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  reorderQuantity?: number;
  unitCost?: number | null;
}

export interface MovementRow {
  itemId: string;
  type: "receive" | "issue" | "adjust" | "waste";
  delta: number;
  createdAt: Date;
}

export interface RoomRow {
  id: string;
  number: string;
  status: string;
  updatedAt?: Date | null;
}

export const ACTIVE_TICKET_STATUSES = ["open", "assigned", "inProgress", "onHold"];

export function isActiveTicket(t: TicketRow): boolean {
  return ACTIVE_TICKET_STATUSES.includes(t.status);
}
