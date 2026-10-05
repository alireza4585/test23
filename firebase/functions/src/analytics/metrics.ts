import {
  EnergyReadingRow,
  HotelSettings,
  isActiveTicket,
  ItemRow,
  OperationsDay,
  RoomRow,
  TaskRow,
  TicketRow,
} from "./types";

/** Document shape of `hotels/{id}/dailyMetrics/{yyyy-MM-dd}`. */
export interface DailyMetrics {
  day: string;
  occupancyRate: number | null;
  roomsOccupied: number | null;
  roomsAvailable: number | null;
  adr: number | null;
  revpar: number | null;
  totalRevenue: number | null;
  energy: { electricity: number | null; water: number | null; gas: number | null };
  energyCost: number;
  electricityPerOccupiedRoom: number | null;
  electricityVsBaselinePct: number | null;
  maintenance: {
    open: number;
    overdue: number;
    critical: number;
    createdOnDay: number;
    resolvedOnDay: number;
    avgResolutionHours: number | null;
  };
  housekeeping: { tasks: number; done: number; avgCheckoutCleanMinutes: number | null };
  inventory: { lowStock: number; outOfStock: number; stockValue: number };
  rooms: { outOfOrder: number; total: number };
  version: 1;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Computes one day of KPIs — the "Analytics Engine" output consumed by
 * dashboards history, reports, n8n summaries and the AI layer.
 * Pure function: identical inputs → identical document.
 */
export function computeDailyMetrics(input: {
  day: string;
  now: Date;
  dayKeyOf: (d: Date) => string;
  settings: HotelSettings;
  operations?: OperationsDay;
  energy: EnergyReadingRow[];
  tickets: TicketRow[];
  tasks: TaskRow[];
  items: ItemRow[];
  rooms: RoomRow[];
}): DailyMetrics {
  const { day, settings, operations: ops } = input;
  const energyOf = (type: EnergyReadingRow["type"]) => {
    const rows = input.energy.filter((e) => e.day === day && e.type === type);
    return rows.length === 0 ? null : rows.reduce((s, r) => s + r.consumption, 0);
  };
  const electricity = energyOf("electricity");
  const water = energyOf("water");
  const gas = energyOf("gas");
  const energyCost =
    (electricity ?? 0) * (settings.energyTariff.electricity ?? 0) +
    (water ?? 0) * (settings.energyTariff.water ?? 0) +
    (gas ?? 0) * (settings.energyTariff.gas ?? 0);
  const baseline = settings.energyDailyBaseline.electricity ?? 0;

  const active = input.tickets.filter(isActiveTicket);
  const resolvedOnDay = input.tickets.filter(
    (t) => t.resolvedAt && input.dayKeyOf(t.resolvedAt) === day,
  );
  const resolutionHours = input.tickets
    .filter((t) => t.resolvedAt)
    .map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 36e5);

  const dayTasks = input.tasks.filter((t) => t.day === day && t.status !== "cancelled");
  const cleanMinutes = dayTasks
    .filter((t) => t.type === "checkoutClean" && t.status === "done" && t.startedAt && t.completedAt)
    .map((t) => (t.completedAt!.getTime() - t.startedAt!.getTime()) / 60000);

  return {
    day,
    occupancyRate: ops && ops.roomsAvailable > 0 ? round((ops.roomsOccupied / ops.roomsAvailable) * 100) : null,
    roomsOccupied: ops?.roomsOccupied ?? null,
    roomsAvailable: ops?.roomsAvailable ?? null,
    adr: ops && ops.roomsOccupied > 0 ? round(ops.roomRevenue / ops.roomsOccupied, 0) : null,
    revpar: ops && ops.roomsAvailable > 0 ? round(ops.roomRevenue / ops.roomsAvailable, 0) : null,
    totalRevenue: ops ? ops.roomRevenue + (ops.fnbRevenue ?? 0) + (ops.otherRevenue ?? 0) : null,
    energy: { electricity, water, gas },
    energyCost: round(energyCost, 0),
    electricityPerOccupiedRoom:
      electricity != null && ops && ops.roomsOccupied > 0 ? round(electricity / ops.roomsOccupied) : null,
    electricityVsBaselinePct:
      electricity != null && baseline > 0 ? round(((electricity - baseline) / baseline) * 100, 1) : null,
    maintenance: {
      open: active.length,
      overdue: active.filter((t) => t.slaDueAt && t.slaDueAt < input.now).length,
      critical: active.filter((t) => t.priority === "critical").length,
      createdOnDay: input.tickets.filter((t) => input.dayKeyOf(t.createdAt) === day).length,
      resolvedOnDay: resolvedOnDay.length,
      avgResolutionHours:
        resolutionHours.length === 0
          ? null
          : round(resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length, 1),
    },
    housekeeping: {
      tasks: dayTasks.length,
      done: dayTasks.filter((t) => t.status === "done").length,
      avgCheckoutCleanMinutes:
        cleanMinutes.length === 0 ? null : round(cleanMinutes.reduce((a, b) => a + b, 0) / cleanMinutes.length, 1),
    },
    inventory: {
      lowStock: input.items.filter((i) => i.quantity <= i.reorderLevel).length,
      outOfStock: input.items.filter((i) => i.quantity <= 0).length,
      stockValue: round(input.items.reduce((s, i) => s + i.quantity * (i.unitCost ?? 0), 0), 0),
    },
    rooms: {
      outOfOrder: input.rooms.filter((r) => r.status === "outOfOrder").length,
      total: input.rooms.length,
    },
    version: 1,
  };
}
