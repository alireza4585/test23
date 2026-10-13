import {
  EnergyReadingRow,
  HotelSettings,
  isActiveTicket,
  ItemRow,
  MovementRow,
  OperationsDay,
  RoomRow,
  TaskRow,
  TicketRow,
} from "./types";

export type InsightCategory =
  | "energy"
  | "maintenance"
  | "housekeeping"
  | "inventory"
  | "revenue"
  | "staffing";

export interface InsightDraft {
  /** Stable id: `${rule}_${subject}` — one live insight per rule & subject. */
  id: string;
  rule: string;
  category: InsightCategory;
  title: string;
  summary: string;
  recommendation: string;
  confidence: number;
  priority: "low" | "medium" | "high";
  estimatedMonthlySaving?: number;
  evidence: string[];
  route?: string;
  /** Roles the insight is primarily for (notification targeting). */
  audienceRoles: string[];
  /** What acting on it should change, and how the result will be measured. */
  expectedImpact?: ExpectedImpact;
}

/**
 * Expected effect of a recommendation. [method] names the evaluation used
 * after a decision (see evaluation.ts); [subject] identifies what to measure.
 */
export interface ExpectedImpact {
  metric: string;
  unit: string;
  baseline: number;
  expected: number;
  monthlyIrr?: number;
  method: "energyBaseline" | "durationAvg" | "ticketCount" | "stockout" | "oooRooms" | "occupancyGap";
  subject?: Record<string, string | string[]>;
}

export interface EngineInput {
  today: string;
  now: Date;
  addDays: (day: string, delta: number) => string;
  settings: HotelSettings;
  operations: OperationsDay[];
  energy: EnergyReadingRow[];
  tickets: TicketRow[];
  tasks: TaskRow[];
  items: ItemRow[];
  movements: MovementRow[];
  rooms: RoomRow[];
  /**
   * Weather-normalised model state per meter type (F2), present only when the
   * hotel's energyBaseline flag is on and a model has scored recent days.
   */
  energyModel?: EnergyModelState[];
}

/** Recent scores of one meter type against its stored model (pb_hooks/lib/energy.js). */
export interface EnergyModelState {
  type: "electricity" | "water" | "gas";
  valid: boolean;
  kind: string;
  cvrmseMonthly: number | null;
  unit: string;
  /** Last days, oldest first. */
  days: { day: string; expected: number; actual: number; deviationPct: number; spike: boolean; drift: boolean; usedWeather: boolean; seasonCovered?: boolean }[];
}

/**
 * `1234.5` → `1,234.5` with exactly [d] decimals. Hand-rolled (no Intl) so
 * the engine also runs inside PocketBase's JS hooks, which lack Intl.
 */
const fmt = (v: number, d = 0) => {
  const fixed = Math.abs(v).toFixed(d);
  const [int, frac] = fixed.split(".");
  const sign = v < 0 && Number(fixed) !== 0 ? "-" : "";
  return sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
};

/**
 * Deterministic, explainable rule engine — the first "AI" layer. Every
 * insight carries the evidence it was derived from. LLM narration and
 * forecasting models plug in on top (see docs/07-ai.md); they never replace
 * the auditable numbers here.
 */
export function generateInsights(input: EngineInput): InsightDraft[] {
  // A valid weather/occupancy model supersedes the crude intensity rule for that meter.
  const modelled = (input.energyModel ?? []).some((m) => m.type === "electricity" && m.valid);
  return [
    ...(modelled ? [] : energyIntensityRule(input)),
    ...energyModelRule(input),
    ...stockoutForecastRule(input),
    ...housekeepingEfficiencyRule(input),
    ...repeatFailureRule(input),
    ...outOfOrderRevenueRule(input),
    ...weekdayOccupancyRule(input),
  ];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function sumBy<T>(rows: T[], f: (r: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

/** Electricity per occupied room rising while occupancy is flat → equipment / HVAC waste. */
export function energyIntensityRule(input: EngineInput): InsightDraft[] {
  const { today, addDays } = input;
  const recentDays = [1, 2, 3, 4].map((d) => addDays(today, -d));
  const priorDays = Array.from({ length: 21 }, (_, i) => addDays(today, -(i + 5)));
  const intensity = (days: string[]) => {
    let kwh = 0;
    let occ = 0;
    let n = 0;
    for (const day of days) {
      const e = input.energy.filter((r) => r.day === day && r.type === "electricity");
      const o = input.operations.find((r) => r.day === day);
      if (e.length === 0 || !o || o.roomsOccupied === 0) continue;
      kwh += sumBy(e, (r) => r.consumption);
      occ += o.roomsOccupied;
      n++;
    }
    return { perRoom: occ === 0 ? null : kwh / occ, avgKwh: n === 0 ? 0 : kwh / n, avgOcc: n === 0 ? 0 : occ / n, n };
  };
  const recent = intensity(recentDays);
  const prior = intensity(priorDays);
  if (recent.perRoom == null || prior.perRoom == null || recent.n < 3 || prior.n < 7) return [];
  const change = (recent.perRoom - prior.perRoom) / prior.perRoom;
  const occChange = prior.avgOcc === 0 ? 0 : (recent.avgOcc - prior.avgOcc) / prior.avgOcc;
  if (change < 0.12 || Math.abs(occChange) > 0.08) return [];

  const hvac = input.tickets.filter((t) => isActiveTicket(t) && t.category === "hvac");
  const extraKwhPerDay = (recent.perRoom - prior.perRoom) * recent.avgOcc;
  const saving = extraKwhPerDay * 30 * (input.settings.energyTariff.electricity ?? 0);
  return [
    {
      id: "energyIntensity_electricity",
      rule: "energyIntensity",
      category: "energy",
      title: `افزایش ${fmt(change * 100)}٪ شدت مصرف برق بدون تغییر اشغال`,
      summary:
        `مصرف برق به ازای هر اتاق اشغال‌شده از ${fmt(prior.perRoom, 1)} به ${fmt(recent.perRoom, 1)} ` +
        `کیلووات‌ساعت رسیده، در حالی که نرخ اشغال ${fmt(occChange * 100)}٪ تغییر کرده است.` +
        (hvac.length > 0 ? ` ${hvac.length} تیکت باز HVAC وجود دارد («${hvac[0].title}»).` : ""),
      recommendation: hvac.length > 0
        ? "سرویس فوری تجهیزات HVAC مرتبط با تیکت‌های باز و تنظیم نقطه کار سرمایش/گرمایش اتاق‌های خالی."
        : "بازرسی مصرف‌کننده‌های بزرگ (چیلر، بویلر، پمپ‌ها) و تنظیم سرمایش/گرمایش اتاق‌های خالی.",
      confidence: hvac.length > 0 ? 0.82 : 0.66,
      priority: change > 0.2 ? "high" : "medium",
      estimatedMonthlySaving: Math.round(saving),
      evidence: [
        `شدت مصرف ۴ روز اخیر: ${fmt(recent.perRoom, 1)} kWh/اتاق`,
        `شدت مصرف ۲۱ روز قبل: ${fmt(prior.perRoom, 1)} kWh/اتاق`,
        `میانگین اتاق اشغال: ${fmt(recent.avgOcc)} در برابر ${fmt(prior.avgOcc)}`,
        ...(hvac.length > 0 ? [`تیکت‌های باز HVAC: ${hvac.length}`] : []),
      ],
      route: "/energy",
      audienceRoles: ["generalManager", "energyManager", "maintenanceManager"],
      expectedImpact: {
        metric: "electricityPerOccupiedRoom", unit: "kWh", baseline: round1(recent.perRoom), expected: round1(prior.perRoom),
        monthlyIrr: Math.round(saving), method: "energyBaseline", subject: { type: "electricity" },
      },
    },
  ];
}

const ENERGY_LABEL: Record<string, string> = { electricity: "برق", water: "آب", gas: "گاز" };

/**
 * F2: a spike or sustained drift against the hotel's own model (occupancy and,
 * when available, temperature) in the last 3 scored days. Numbers come from
 * the stored scores; the cause is only suggested.
 */
export function energyModelRule(input: EngineInput): InsightDraft[] {
  const out: InsightDraft[] = [];
  for (const m of input.energyModel ?? []) {
    if (!m.valid || m.days.length === 0) continue;
    const recent = m.days.slice(-3);
    const flagged = recent.filter((d) => d.spike || d.drift);
    if (flagged.length === 0) continue;
    // The run of consecutive days above expected that ends at the last flag.
    const lastFlag = m.days.map((d) => d.spike || d.drift).lastIndexOf(true);
    let start = lastFlag;
    while (start > 0 && m.days[start - 1].actual > m.days[start - 1].expected) start--;
    const run = m.days.slice(start, lastFlag + 1);
    const actual = sumBy(run, (d) => d.actual);
    const expected = sumBy(run, (d) => d.expected);
    const pct = expected > 0 ? ((actual - expected) / expected) * 100 : 0;
    if (pct <= 0) continue;
    const label = ENERGY_LABEL[m.type] ?? m.type;
    const hvac = input.tickets.filter((t) => isActiveTicket(t) && t.category === "hvac");
    const tariff = input.settings.energyTariff[m.type] ?? 0;
    const extraPerDay = (actual - expected) / run.length;
    const drift = flagged.some((d) => d.drift);
    const unseen = run.some((d) => d.seasonCovered === false);
    out.push({
      id: `energyModel_${m.type}`,
      rule: "energyModel",
      category: "energy",
      title: drift
        ? `مصرف ${label} به‌طور پایدار ${fmt(pct)}٪ بالاتر از مقدار موردانتظار`
        : `جهش مصرف ${label}: ${fmt(pct)}٪ بالاتر از مقدار موردانتظار`,
      summary:
        `مصرف ${label} در ${fmt(run.length)} روز (${run[0].day} تا ${run[run.length - 1].day}) ` +
        `${fmt(actual)} ${m.unit} بود، در برابر ${fmt(expected)} ${m.unit} موردانتظار مدل` +
        (run.every((d) => d.usedWeather) ? " با در نظر گرفتن دما و اشغال." : " با در نظر گرفتن اشغال (بدون دادهٔ دما).") +
        (hvac.length > 0 ? ` احتمالاً مرتبط: ${fmt(hvac.length)} تیکت باز HVAC.` : "") +
        (unseen ? " اطمینان پایین: مدل هنوز دادهٔ این ماه از سال را ندیده است." : ""),
      recommendation: hvac.length > 0
        ? "بازدید تجهیزات مرتبط با تیکت‌های باز HVAC و بررسی زمان‌بندی BMS (کارکرد در ساعات و فضاهای خالی)."
        : "بازرسی مصرف‌کننده‌های بزرگ (چیلر، بویلر، پمپ‌ها) و زمان‌بندی BMS؛ اگر رویداد شناخته‌شده‌ای علت است، آن را ثبت کنید.",
      confidence: unseen ? 0.45 : drift ? 0.8 : 0.7,
      priority: (pct > 20 || drift) && !unseen ? "high" : "medium",
      estimatedMonthlySaving: Math.round(extraPerDay * 30 * tariff),
      evidence: [
        `مدل: ${m.kind === "weather" ? "دما و اشغال" : "اشغال و فصل"}${m.cvrmseMonthly !== null ? `، CV(RMSE) ماهانه ${fmt(m.cvrmseMonthly, 1)}٪` : ""}`,
        ...run.map((d) => `${d.day}: ${fmt(d.actual)} در برابر ${fmt(d.expected)} ${m.unit}${d.drift ? " (انحراف پایدار)" : d.spike ? " (جهش)" : ""}`),
        ...(hvac.length > 0 ? [`تیکت‌های باز HVAC: ${fmt(hvac.length)}`] : []),
      ],
      route: "/energy",
      audienceRoles: ["generalManager", "energyManager", "maintenanceManager"],
      expectedImpact: {
        metric: `${m.type}VsModel`, unit: m.unit, baseline: Math.round(actual / run.length), expected: Math.round(expected / run.length),
        monthlyIrr: Math.round(extraPerDay * 30 * tariff), method: "energyBaseline", subject: { type: m.type },
      },
    });
  }
  return out;
}

/** Consumption-rate stock-out forecast (14-day issue velocity). */
export function stockoutForecastRule(input: EngineInput): InsightDraft[] {
  const since = new Date(input.now.getTime() - 14 * 864e5);
  const out: InsightDraft[] = [];
  for (const item of input.items) {
    const issued = input.movements
      .filter((m) => m.itemId === item.id && m.createdAt >= since && (m.type === "issue" || m.type === "waste"))
      .reduce((s, m) => s + Math.abs(m.delta), 0);
    const perDay = issued / 14;
    if (perDay <= 0) continue;
    const daysLeft = item.quantity / perDay;
    if (daysLeft > 5) continue;
    const order = Math.ceil(Math.max(item.reorderQuantity ?? 0, perDay * 14));
    out.push({
      id: `stockout_${item.id}`,
      rule: "stockout",
      category: "inventory",
      title: `پیش‌بینی اتمام «${item.name}» تا ${fmt(Math.max(daysLeft, 0))} روز آینده`,
      summary: `مصرف روزانه حدود ${fmt(perDay, 1)} ${item.unit} و موجودی فعلی ${fmt(item.quantity)} ${item.unit} است.`,
      recommendation: `ثبت سفارش ${fmt(order)} ${item.unit} امروز.`,
      confidence: 0.85,
      priority: daysLeft < 2 ? "high" : "medium",
      evidence: [
        `موجودی: ${fmt(item.quantity)} ${item.unit}`,
        `نقطه سفارش: ${fmt(item.reorderLevel)}`,
        `مصرف ۱۴ روز: ${fmt(issued)} ${item.unit}`,
      ],
      route: `/inventory/${item.id}`,
      audienceRoles: ["inventoryManager", "generalManager"],
      expectedImpact: {
        metric: "daysOfCover", unit: "days", baseline: round1(Math.max(daysLeft, 0)), expected: 14,
        method: "stockout", subject: { itemId: item.id },
      },
    });
  }
  return out;
}

/** Checkout cleans running over target → productivity loss. */
export function housekeepingEfficiencyRule(input: EngineInput): InsightDraft[] {
  const target = input.settings.targetCleanMinutes.checkoutClean ?? 35;
  const window = new Set(Array.from({ length: 7 }, (_, i) => input.addDays(input.today, -i)));
  const durations = input.tasks
    .filter((t) => window.has(t.day) && t.type === "checkoutClean" && t.status === "done" && t.startedAt && t.completedAt)
    .map((t) => (t.completedAt!.getTime() - t.startedAt!.getTime()) / 60000);
  if (durations.length < 5) return [];
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const over = (avg - target) / target;
  if (over < 0.15) return [];
  const lostHoursPerWeek = ((avg - target) * durations.length) / 60;
  return [
    {
      id: "hkEfficiency_checkout",
      rule: "hkEfficiency",
      category: "housekeeping",
      title: `زمان نظافت اتاق‌های تخلیه ${fmt(over * 100)}٪ بیش از هدف`,
      summary: `میانگین ${fmt(avg)} دقیقه در برابر هدف ${fmt(target)} دقیقه (${durations.length} نظافت در ۷ روز).`,
      recommendation:
        "آماده‌سازی ترولی پیش از شیفت، تخصیص اتاق‌ها بر اساس طبقه و بررسی موانع (کمبود ملحفه/اقلام).",
      confidence: 0.72,
      priority: over > 0.3 ? "high" : "medium",
      evidence: [`ساعات اضافه هفتگی: ${fmt(lostHoursPerWeek, 1)}`, `نمونه‌ها: ${durations.length}`],
      route: "/housekeeping",
      audienceRoles: ["housekeepingManager", "operationsManager"],
      expectedImpact: {
        metric: "checkoutCleanMinutes", unit: "min", baseline: round1(avg), expected: target,
        method: "durationAvg", subject: { taskType: "checkoutClean" },
      },
    },
  ];
}

/** ≥3 tickets of one category at one location in 30 days → predictive maintenance. */
export function repeatFailureRule(input: EngineInput): InsightDraft[] {
  const since = new Date(input.now.getTime() - 30 * 864e5);
  const groups = new Map<string, TicketRow[]>();
  for (const t of input.tickets.filter((t) => t.createdAt >= since)) {
    const where = t.roomNumber ? `room-${t.roomNumber}` : (t.area ?? "").trim();
    if (!where) continue;
    const key = `${t.category}|${where}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: InsightDraft[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const [category, where] = key.split("|");
    out.push({
      id: `repeatFailure_${category}_${where}`.replace(/[^\w-]/g, "_"),
      rule: "repeatFailure",
      category: "maintenance",
      title: `${list.length} خرابی تکراری در ${where.replace("room-", "اتاق ")} طی ۳۰ روز`,
      summary: `دسته: ${category}. خرابی‌های مکرر نشانه نیاز به تعمیر اساسی یا تعویض تجهیز است.`,
      recommendation: "برنامه‌ریزی بازدید پیشگیرانه و بررسی هزینه تعمیر در برابر تعویض.",
      confidence: 0.7,
      priority: list.length >= 5 ? "high" : "medium",
      evidence: list.slice(0, 5).map((t) => t.title),
      route: "/maintenance",
      audienceRoles: ["maintenanceManager", "generalManager"],
      expectedImpact: {
        metric: "tickets30Days", unit: "tickets", baseline: list.length, expected: 0,
        method: "ticketCount", subject: { category, where },
      },
    });
  }
  return out;
}

/**
 * Rooms out of order > 24h. Two insights: the lost revenue at current ADR ×
 * occupancy for finance roles only, and the same rooms without any money for
 * the managers who get them back into service.
 */
export function outOfOrderRevenueRule(input: EngineInput): InsightDraft[] {
  const ooo = input.rooms.filter(
    (r) => r.status === "outOfOrder" && r.updatedAt && input.now.getTime() - r.updatedAt.getTime() > 864e5,
  );
  if (ooo.length === 0) return [];
  const numbers = ooo.map((r) => r.number);
  const out: InsightDraft[] = [];
  const recent = input.operations.slice(-14);
  const sold = recent.reduce((s, o) => s + o.roomsOccupied, 0);
  const available = recent.reduce((s, o) => s + o.roomsAvailable, 0);
  const revenue = recent.reduce((s, o) => s + o.roomRevenue, 0);
  if (sold > 0 && available > 0 && revenue > 0) {
    const adr = revenue / sold;
    const occ = sold / available;
    const lostPerMonth = ooo.length * adr * occ * 30;
    out.push({
      id: "outOfOrder_revenue",
      rule: "outOfOrderRevenue",
      category: "revenue",
      title: `${ooo.length} اتاق بیش از ۲۴ ساعت خارج از سرویس`,
      summary: `اتاق‌ها: ${numbers.join("، ")}. با ADR و اشغال فعلی، درآمد از دست‌رفته قابل توجه است.`,
      recommendation: "اولویت‌دهی تیکت‌های این اتاق‌ها و تعیین تاریخ بازگشت به فروش.",
      confidence: 0.8,
      priority: ooo.length >= 3 ? "high" : "medium",
      estimatedMonthlySaving: Math.round(lostPerMonth),
      evidence: [`ADR ۱۴ روز: ${fmt(adr)}`, `اشغال ۱۴ روز: ${fmt(occ * 100)}٪`],
      route: "/rooms",
      audienceRoles: ["generalManager", "hotelOwner", "analyst"],
      expectedImpact: {
        metric: "roomsOutOfOrder", unit: "rooms", baseline: ooo.length, expected: 0,
        monthlyIrr: Math.round(lostPerMonth), method: "oooRooms", subject: { rooms: numbers },
      },
    });
  }
  out.push({
    id: "outOfOrder_rooms",
    rule: "outOfOrderRooms",
    category: "maintenance",
    title: `${ooo.length} اتاق بیش از ۲۴ ساعت خارج از سرویس`,
    summary: `اتاق‌ها: ${numbers.join("، ")}. این اتاق‌ها قابل فروش نیستند تا تعمیر و بازگشت به سرویس انجام شود.`,
    recommendation: "اولویت‌دهی تیکت‌های این اتاق‌ها و تعیین تاریخ بازگشت به فروش.",
    confidence: 0.8,
    priority: ooo.length >= 3 ? "high" : "medium",
    evidence: [`اتاق‌های خارج از سرویس: ${numbers.join("، ")}`],
    route: "/rooms",
    audienceRoles: ["generalManager", "maintenanceManager", "operationsManager"],
    expectedImpact: {
      metric: "roomsOutOfOrder", unit: "rooms", baseline: ooo.length, expected: 0, method: "oooRooms", subject: { rooms: numbers },
    },
  });
  return out;
}

/** Weekend vs weekday occupancy gap → dynamic pricing / promotions (Iran weekend: Thu–Fri). */
export function weekdayOccupancyRule(input: EngineInput): InsightDraft[] {
  const last28 = input.operations.slice(-28);
  if (last28.length < 21) return [];
  const isWeekend = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 4 = Thu, 5 = Fri
    return wd === 4 || wd === 5;
  };
  const rate = (rows: OperationsDay[]) =>
    rows.reduce((s, o) => s + o.roomsOccupied, 0) / Math.max(1, rows.reduce((s, o) => s + o.roomsAvailable, 0));
  const weekend = rate(last28.filter((o) => isWeekend(o.day)));
  const weekday = rate(last28.filter((o) => !isWeekend(o.day)));
  const gap = (weekend - weekday) * 100;
  if (gap < 12) return [];
  return [
    {
      id: "weekdayOccupancy_gap",
      rule: "weekdayOccupancy",
      category: "revenue",
      title: `فاصله ${fmt(gap)} واحدی اشغال آخر هفته و روزهای میانی`,
      summary: `اشغال آخر هفته ${fmt(weekend * 100)}٪ و روزهای میانی ${fmt(weekday * 100)}٪ در ۴ هفته اخیر.`,
      recommendation: "قیمت‌گذاری پویا و بسته‌های سازمانی/اقامت طولانی برای روزهای میانی هفته.",
      confidence: 0.68,
      priority: "medium",
      evidence: [`آخر هفته: ${fmt(weekend * 100)}٪`, `روزهای میانی: ${fmt(weekday * 100)}٪`],
      route: "/reports",
      audienceRoles: ["generalManager", "hotelOwner", "analyst"],
      expectedImpact: {
        metric: "weekendWeekdayGap", unit: "pts", baseline: round1(gap), expected: 12, method: "occupancyGap",
      },
    },
  ];
}
