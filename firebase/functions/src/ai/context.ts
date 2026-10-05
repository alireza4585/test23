import { computeDailyMetrics, DailyMetrics } from "../analytics/metrics";
import { HotelData } from "../analytics/loader";
import { isActiveTicket } from "../analytics/types";

export interface HotelContext {
  hotel: string;
  generatedAt: string;
  today: string;
  baselines: Record<string, number>;
  tariffs: Record<string, number>;
  last14Days: Pick<
    DailyMetrics,
    "day" | "occupancyRate" | "adr" | "revpar" | "totalRevenue" | "energy" | "electricityPerOccupiedRoom"
  >[];
  roomsNow: Record<string, number>;
  openTickets: {
    title: string;
    category: string;
    priority: string;
    status: string;
    location: string;
    ageHours: number;
    overdue: boolean;
  }[];
  lowStock: { name: string; quantity: number; reorderLevel: number; unit: string }[];
  activeInsights: { title: string; summary: string }[];
}

/**
 * Compact, factual snapshot used to ground the assistant. The model is told
 * to answer only from this data, so answers stay auditable and the hotel's
 * raw records (guest data, staff PII) never leave the backend.
 */
export function buildHotelContext(
  data: HotelData,
  opts: {
    now: Date;
    today: string;
    addDays: (d: string, n: number) => string;
    dayKeyOf: (d: Date) => string;
    insights: { title: string; summary: string }[];
  },
): HotelContext {
  const days = Array.from({ length: 14 }, (_, i) => opts.addDays(opts.today, -(14 - i)));
  const last14Days = days.map((day) => {
    const m = computeDailyMetrics({
      day,
      now: opts.now,
      dayKeyOf: opts.dayKeyOf,
      settings: data.settings,
      operations: data.operations.find((o) => o.day === day),
      energy: data.energy,
      tickets: [],
      tasks: [],
      items: [],
      rooms: [],
    });
    return {
      day,
      occupancyRate: m.occupancyRate,
      adr: m.adr,
      revpar: m.revpar,
      totalRevenue: m.totalRevenue,
      energy: m.energy,
      electricityPerOccupiedRoom: m.electricityPerOccupiedRoom,
    };
  });

  const roomsNow: Record<string, number> = {};
  for (const r of data.rooms) roomsNow[r.status] = (roomsNow[r.status] ?? 0) + 1;

  const rank = { critical: 3, high: 2, medium: 1, low: 0 } as const;
  const openTickets = data.tickets
    .filter(isActiveTicket)
    .sort((a, b) => rank[b.priority] - rank[a.priority])
    .slice(0, 12)
    .map((t) => ({
      title: t.title,
      category: t.category,
      priority: t.priority,
      status: t.status,
      location: t.roomNumber ? `room ${t.roomNumber}` : (t.area ?? "—"),
      ageHours: Math.round((opts.now.getTime() - t.createdAt.getTime()) / 36e5),
      overdue: !!t.slaDueAt && t.slaDueAt < opts.now,
    }));

  return {
    hotel: data.name,
    generatedAt: opts.now.toISOString(),
    today: opts.today,
    baselines: data.settings.energyDailyBaseline,
    tariffs: data.settings.energyTariff,
    last14Days,
    roomsNow,
    openTickets,
    lowStock: data.items
      .filter((i) => i.quantity <= i.reorderLevel)
      .map((i) => ({ name: i.name, quantity: i.quantity, reorderLevel: i.reorderLevel, unit: i.unit })),
    activeInsights: opts.insights.slice(0, 8),
  };
}
