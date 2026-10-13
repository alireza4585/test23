/**
 * Morning briefing (AI phase 1, F4): what changed, probably why, what to do —
 * per role, from the hotel's own data. Deterministic: the server stores this
 * rule-based version every morning; an LLM may only re-word it from the same
 * facts (pb_hooks/lib/briefing.js validates every number it writes).
 *
 * Steps:
 *   1. anomalies: yesterday against the 28 days before it, robust z-score
 *      (median and MAD; |z| ≥ 3; at least 14 days of history), or against
 *      the F2 model where one is valid for that meter;
 *   2. live findings: active insights, critical alerts, overdue tickets;
 *   3. cross-department links (the cause is only ever "possibly related"):
 *      energy ↑ with open HVAC tickets, checkout-clean time ↑ with
 *      housekeeping absences, tickets ↑ with repeat-failure locations;
 *   4. per role: items of the categories its permissions cover (revenue only
 *      with finance.view), highest severity first, 5–7 items when there are
 *      that many (filled with plain status lines, never invented ones).
 * Every number in an item's text is in that item's facts, in the shapes the
 * number validator understands (counts.*, windows.*, roomsNow.*, values.*).
 */
import { HotelSettings, isActiveTicket, OperationsDay, EnergyReadingRow, TicketRow, TaskRow, RoomRow } from "./types";
import type { EnergyModelState } from "./rules-engine";
import { quantile } from "./stats";

export const HISTORY_DAYS = 28;
export const MIN_HISTORY_POINTS = 14;
export const ROBUST_Z = 3;
export const MAX_ITEMS = 7;
export const MIN_ITEMS = 5;

export type BriefingCategory = "occupancy" | "energy" | "maintenance" | "housekeeping" | "inventory" | "revenue" | "staffing";

export interface BriefingInput {
  today: string;
  addDays: (day: string, n: number) => string;
  now: Date;
  settings: HotelSettings;
  operations: OperationsDay[];
  energy: EnergyReadingRow[];
  energyModel?: EnergyModelState[];
  tickets: TicketRow[];
  tasks: TaskRow[];
  rooms: RoomRow[];
  shifts: { day: string; department: string; status: string }[];
  alerts: { type: string; severity: string; title: string }[];
  insights: { id: string; rule: string; category: string; title: string; priority: string }[];
  actions: { id: string; insight: string; priority: string }[];
  /** Today's occupancy forecast (%), when the forecasts flag is on. */
  forecastOccupancy?: number | null;
}

export interface ItemFacts {
  values: Record<string, number>;
  counts: Record<string, number>;
  windows: Record<string, number>;
  roomsNow: Record<string, number>;
  labels: Record<string, string>;
}

export interface BriefingItem {
  id: string;
  kind: "anomaly" | "insight" | "alert" | "status";
  category: BriefingCategory;
  title: string;
  finding: string;
  /** Hedged ("ممکن است مرتبط باشد"), or null. */
  cause: string | null;
  /** Staff department the item is about (staffing items), or null. */
  department?: string | null;
  actionId: string | null;
  route: string;
  severity: number;
  finance: boolean;
  facts: ItemFacts;
}

const LABEL: Record<string, string> = { electricity: "برق", water: "آب", gas: "گاز" };
/** Persian names of the staff departments (shifts.department). */
export const DEPARTMENT_LABEL: Record<string, string> = {
  management: "مدیریت", frontOffice: "پذیرش", housekeeping: "خانه‌داری", maintenance: "تعمیرات", energy: "انرژی",
  foodAndBeverage: "غذا و نوشیدنی", inventory: "انبار", humanResources: "منابع انسانی", analytics: "تحلیل",
};
const INSIGHT_TITLE: Record<string, string> = {
  repeatFailure: "خرابی تکراری", outOfOrderRooms: "اتاق‌های خارج از سرویس", stockout: "خطر اتمام موجودی",
  outOfOrderRevenue: "درآمد از دست‌رفته", weekdayOccupancy: "الگوی اشغال", hkEfficiency: "بهره‌وری نظافت",
};
const UNIT: Record<string, string> = { electricity: "kWh", water: "m³", gas: "m³" };

const fmt = (v: number, d = 0) => {
  const fixed = Math.abs(v).toFixed(d);
  const [int, frac] = fixed.split(".");
  const sign = v < 0 && Number(fixed) !== 0 ? "-" : "";
  return sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac && Number(frac) !== 0 ? `.${frac}` : "");
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const emptyFacts = (): ItemFacts => ({ values: {}, counts: {}, windows: {}, roomsNow: {}, labels: {} });

/**
 * Robust z of [x] against [history]: median and 1.4826·MAD, floored at 2 % of
 * the median and at [minScale] (1 for counts of people or tickets, so a quiet
 * history of zeros does not turn one absence into an extreme z).
 */
export function robustZ(x: number, history: number[], minScale = 1e-9): { z: number; median: number } | null {
  const h = history.filter((v) => isFinite(v));
  if (h.length < MIN_HISTORY_POINTS) return null;
  const median = quantile(h, 0.5);
  const mad = quantile(h.map((v) => Math.abs(v - median)), 0.5);
  const scale = Math.max(1.4826 * mad, 0.02 * Math.abs(median), minScale);
  return { z: (x - median) / scale, median };
}

/** Count paths for numbers that a code-generated title states ("5 خرابی", "2 روز", "3 اتاق"). */
function titleFacts(id: string, title: string, f: ItemFacts) {
  f.labels[`${id}_title`] = title;
  const ascii = title.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/٬/g, ",");
  const re = /(\d+(?:,\d{3})*)\s*(?:تا\s+)?(خرابی|تیکت|روز|اتاق|قلم)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(ascii))) {
    const n = Number(m[1].replace(/,/g, ""));
    if (m[2] === "روز") f.windows[`${id}_${i}`] = n;
    else if (m[2] === "اتاق") f.roomsNow[`${id}_${i}`] = n;
    else if (m[2] === "قلم") f.counts[`${id}_lowStock_${i}`] = n;
    else f.counts[`${id}_tickets_${i}`] = n;
    i++;
  }
}

/** All items for the hotel (before the per-role selection). */
export function buildItems(input: BriefingInput): BriefingItem[] {
  const { today, addDays } = input;
  const yesterday = addDays(today, -1);
  const history = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(yesterday, -(i + 1)));
  const items: BriefingItem[] = [];
  const actionFor = (insightId: string) => input.actions.find((a) => a.insight === insightId)?.id ?? null;
  const PRIORITY: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  // Most urgent first, then newest: the ticket a cause line quotes.
  const openHvac = input.tickets.filter((t) => isActiveTicket(t) && t.category === "hvac")
    .sort((a, b) => (PRIORITY[b.priority] ?? 0) - (PRIORITY[a.priority] ?? 0) || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  // ------------------------------------------------------------ occupancy
  const occ = (day: string) => {
    const o = input.operations.find((r) => r.day === day);
    return o && o.roomsAvailable > 0 ? (o.roomsOccupied / o.roomsAvailable) * 100 : null;
  };
  const occY = occ(yesterday);
  if (occY !== null) {
    const rz = robustZ(occY, history.map(occ).filter((v): v is number => v !== null));
    const f = emptyFacts();
    f.values.occupancyYesterday = r1(occY);
    let finding = `اشغال دیروز ${fmt(r1(occY), 1)}٪ بود`;
    if (rz) {
      f.values.occupancyMedian = r1(rz.median);
      f.windows.historyDays = HISTORY_DAYS;
      finding += `؛ میانهٔ ${HISTORY_DAYS} روز گذشته ${fmt(r1(rz.median), 1)}٪`;
    }
    if (input.forecastOccupancy !== null && input.forecastOccupancy !== undefined) {
      f.values.occupancyForecastToday = r1(input.forecastOccupancy);
      finding += `. پیش‌بینی امروز ${fmt(r1(input.forecastOccupancy), 1)}٪`;
    }
    const anomalous = !!rz && Math.abs(rz.z) >= ROBUST_Z;
    items.push({
      id: "occupancy", kind: anomalous ? "anomaly" : "status", category: "occupancy",
      title: anomalous ? (occY > rz!.median ? "اشغال غیرعادی بالا" : "اشغال غیرعادی پایین") : "اشغال",
      finding: `${finding}.`, cause: null, actionId: null, route: "/rooms",
      severity: anomalous ? Math.abs(rz!.z) : 0.5, finance: false, facts: f,
    });
  }

  // --------------------------------------------------------------- energy
  for (const type of ["electricity", "water", "gas"] as const) {
    const unit = UNIT[type];
    const label = LABEL[type];
    const model = (input.energyModel ?? []).find((m) => m.type === type && m.valid);
    const dayRow = model?.days.find((d) => d.day === yesterday);
    const f = emptyFacts();
    const id = `energy_${type}`;
    let finding: string;
    let anomalous: boolean;
    let severity: number;
    let up: boolean;
    if (model && dayRow) {
      const pct = r1(dayRow.deviationPct);
      f.values[`${id}_actual`] = Math.round(dayRow.actual);
      f.values[`${id}_expected`] = Math.round(dayRow.expected);
      f.values[`${id}_deviationPct`] = Math.abs(pct);
      up = pct > 0;
      finding = `مصرف ${label} دیروز ${fmt(Math.round(dayRow.actual))} ${unit} بود، ${fmt(Math.abs(pct), 1)}٪ ${up ? "بیشتر" : "کمتر"} از ${fmt(Math.round(dayRow.expected))} ${unit} موردانتظار مدل` +
        (dayRow.usedWeather ? " (با دما و اشغال)" : " (با اشغال)");
      const run: string[] = [];
      for (let i = model.days.length - 1; i >= 0 && (model.days[i].spike || model.days[i].drift); i--) run.unshift(model.days[i].day);
      anomalous = dayRow.spike || dayRow.drift;
      if (anomalous && run.length > 1) {
        f.windows[`${id}_flaggedDays`] = run.length;
        finding += `؛ ${fmt(run.length)} روز پیاپی بالاتر از بازهٔ موردانتظار`;
      }
      if (dayRow.seasonCovered === false) finding += "؛ اطمینان پایین: مدل دادهٔ این ماه از سال را ندیده است";
      severity = anomalous ? 3 + Math.abs(pct) / 10 : Math.abs(pct) / 20;
    } else {
      const val = (day: string) => {
        const rows = input.energy.filter((e) => e.day === day && e.type === type);
        return rows.length ? rows.reduce((s, e) => s + e.consumption, 0) : null;
      };
      const y = val(yesterday);
      if (y === null) continue;
      const rz = robustZ(y, history.map(val).filter((v): v is number => v !== null));
      f.values[`${id}_actual`] = Math.round(y);
      up = !!rz && y > rz.median;
      finding = `مصرف ${label} دیروز ${fmt(Math.round(y))} ${unit} بود`;
      if (rz) {
        f.values[`${id}_median`] = Math.round(rz.median);
        f.windows.historyDays = HISTORY_DAYS;
        finding += `؛ میانهٔ ${HISTORY_DAYS} روز گذشته ${fmt(Math.round(rz.median))} ${unit} (بدون تعدیل دما و اشغال)`;
      }
      anomalous = !!rz && Math.abs(rz.z) >= ROBUST_Z;
      severity = anomalous ? Math.abs(rz!.z) : 0.3;
    }
    let cause: string | null = null;
    if (anomalous && up && type !== "water" && openHvac.length > 0) {
      f.counts[`${id}_openHvacTickets`] = openHvac.length;
      f.labels[`${id}_hvacTitle`] = openHvac[0].title;
      cause = `ممکن است مرتبط باشد با ${fmt(openHvac.length)} تیکت باز HVAC («${openHvac[0].title}»)`;
    }
    const insight = input.insights.find((i) => i.rule === "energyModel" && i.title.indexOf(label) >= 0)
      ?? (type === "electricity" ? input.insights.find((i) => i.rule === "energyIntensity") : undefined);
    items.push({
      id, kind: anomalous ? "anomaly" : "status", category: "energy",
      title: anomalous ? `مصرف ${label} ${up ? "بالاتر" : "پایین‌تر"} از انتظار` : `مصرف ${label}`,
      finding: `${finding}.`, cause, actionId: anomalous && insight ? actionFor(insight.id) : null, route: "/energy",
      severity, finance: false, facts: f,
    });
  }

  // ---------------------------------------------------------- housekeeping
  const cleanMinutes = (day: string) => {
    const d = input.tasks.filter((t) => t.day === day && t.type === "checkoutClean" && t.status === "done" && t.startedAt && t.completedAt)
      .map((t) => (t.completedAt!.getTime() - t.startedAt!.getTime()) / 60000);
    return d.length ? d.reduce((a, b) => a + b, 0) / d.length : null;
  };
  const absent = (day: string, department: string) => input.shifts.filter((s) => s.day === day && s.department === department && s.status === "absent").length;
  // Only days on which the department has shifts at all count as history (no shift data is not "nobody absent").
  const staffedDays = (department: string) => history.filter((d) => input.shifts.some((s) => s.day === d && s.department === department));
  const cY = cleanMinutes(yesterday);
  if (cY !== null) {
    const rz = robustZ(cY, history.map(cleanMinutes).filter((v): v is number => v !== null));
    if (rz && rz.z >= ROBUST_Z) {
      const f = emptyFacts();
      f.values.checkoutCleanMinutes = r1(cY);
      f.values.checkoutCleanMedian = r1(rz.median);
      f.values.checkoutCleanTarget = input.settings.targetCleanMinutes.checkoutClean ?? 35;
      f.windows.historyDays = HISTORY_DAYS;
      const absY = absent(yesterday, "housekeeping");
      const absDays = staffedDays("housekeeping");
      const absMedian = absDays.length ? quantile(absDays.map((d) => absent(d, "housekeeping")), 0.5) : null;
      let cause: string | null = null;
      if (absMedian !== null && absY > absMedian) {
        f.values.housekeepingAbsentYesterday = absY;
        f.values.housekeepingAbsentMedian = absMedian;
        cause = `ممکن است مرتبط باشد با غیبت ${fmt(absY)} نفر از کارکنان خانه‌داری (معمولاً ${fmt(absMedian)} نفر)`;
      }
      const insight = input.insights.find((i) => i.rule === "hkEfficiency");
      items.push({
        id: "housekeeping_clean", kind: "anomaly", category: "housekeeping", title: "زمان نظافت اتاق‌های تخلیه بالا",
        finding: `میانگین نظافت اتاق تخلیه دیروز ${fmt(r1(cY), 1)} دقیقه بود؛ میانهٔ ${HISTORY_DAYS} روز گذشته ${fmt(r1(rz.median), 1)} دقیقه و هدف ${fmt(f.values.checkoutCleanTarget)} دقیقه.`,
        cause, actionId: insight ? actionFor(insight.id) : null, route: "/housekeeping", severity: rz.z, finance: false, facts: f,
      });
    }
  }

  // ------------------------------------------------------------- staffing
  for (const department of Array.from(new Set(input.shifts.map((s) => s.department))).sort()) {
    if (!input.shifts.some((s) => s.day === yesterday && s.department === department)) continue;
    const aY = absent(yesterday, department);
    const rz = robustZ(aY, staffedDays(department).map((d) => absent(d, department)), 1);
    if (!rz || rz.z < ROBUST_Z || aY < 2) continue;
    const name = DEPARTMENT_LABEL[department] ?? department;
    const f = emptyFacts();
    f.values[`absent_${department}`] = aY;
    f.values[`absentMedian_${department}`] = rz.median;
    items.push({
      id: `staffing_${department}`, kind: "anomaly", category: "staffing", title: `غیبت غیرعادی در ${name}`,
      finding: `دیروز ${fmt(aY)} نفر در ${name} غایب بودند؛ معمولاً ${fmt(rz.median)} نفر.`,
      cause: null, department, actionId: null, route: "/staff", severity: rz.z, finance: false, facts: f,
    });
  }

  // ---------------------------------------------------------- maintenance
  const created = (day: string) => input.tickets.filter((t) => t.createdAt && dayKeyLocal(t.createdAt) === day).length;
  const tY = created(yesterday);
  const tz = robustZ(tY, history.map(created), 1);
  const repeat = input.insights.filter((i) => i.rule === "repeatFailure");
  if (tz && tz.z >= ROBUST_Z && tY >= 3) {
    const f = emptyFacts();
    f.counts.ticketsCreatedYesterday = tY;
    f.values.ticketsCreatedMedian = tz.median;
    let cause: string | null = null;
    if (repeat.length) {
      f.labels.repeatTitle = repeat[0].title;
      titleFacts("repeatCause", repeat[0].title, f);
      cause = `ممکن است مرتبط باشد با خرابی تکراری: «${repeat[0].title}»`;
    }
    items.push({
      id: "maintenance_created", kind: "anomaly", category: "maintenance", title: "تیکت‌های تعمیر بیش از معمول",
      finding: `دیروز ${fmt(tY)} تیکت تعمیر ثبت شد؛ میانهٔ روزانه ${fmt(tz.median)}.`,
      cause, actionId: null, route: "/maintenance", severity: tz.z, finance: false, facts: f,
    });
  }
  const overdue = input.tickets.filter((t) => isActiveTicket(t) && t.slaDueAt && t.slaDueAt < input.now);
  if (overdue.length) {
    const f = emptyFacts();
    f.counts.overdueTickets = overdue.length;
    const critical = overdue.filter((t) => t.priority === "critical").length;
    if (critical) f.counts.overdueTicketsCritical = critical;
    items.push({
      id: "maintenance_overdue", kind: "alert", category: "maintenance", title: "تیکت‌های گذشته از SLA",
      finding: `${fmt(overdue.length)} تیکت معوق باز است${critical ? `، از جمله ${fmt(critical)} تیکت بحرانی` : ""}.`,
      cause: null, actionId: null, route: "/maintenance", severity: 2 + overdue.length / 5 + critical, finance: false, facts: f,
    });
  }

  // -------------------------------------------------- insights (live findings)
  const CATEGORY: Record<string, BriefingCategory> = {
    // outOfOrderRevenue repeats the out-of-order rooms line; its money figure stays in the insight.
    repeatFailure: "maintenance", outOfOrderRooms: "maintenance", stockout: "inventory",
    weekdayOccupancy: "revenue", hkEfficiency: "housekeeping",
  };
  // Several stock-outs or repeat-failure locations are one item each (most urgent first), not one per insight.
  const GROUPED = ["stockout", "repeatFailure"];
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  for (const rule of GROUPED) {
    const group = input.insights.filter((i) => i.rule === rule).sort((a, b) => (rank[b.priority] ?? 0) - (rank[a.priority] ?? 0) || (a.title < b.title ? -1 : 1));
    if (!group.length) continue;
    const f = emptyFacts();
    const shown = group.slice(0, 5);
    shown.forEach((ins) => titleFacts(ins.id, ins.title, f));
    let finding = shown.map((i) => i.title).join("؛ ");
    if (group.length > shown.length) {
      f.values[`${rule}_more`] = group.length - shown.length;
      finding += ` و ${fmt(group.length - shown.length)} مورد دیگر`;
    }
    if (rule === "repeatFailure" && items.some((i) => i.id === "maintenance_created")) finding += "؛ در افزایش تیکت‌های دیروز هم دیده می‌شود";
    const actionId = group.map((i) => actionFor(i.id)).find((id) => !!id) ?? null;
    const top = Math.max(...group.map((i) => rank[i.priority] ?? 1));
    items.push({
      id: `insights_${rule}`, kind: "insight", category: CATEGORY[rule], title: INSIGHT_TITLE[rule], finding: `${finding}.`,
      cause: null, actionId, route: rule === "stockout" ? "/inventory" : "/maintenance",
      severity: top + 0.1 + Math.min(0.5, 0.1 * (group.length - 1)), finance: false, facts: f,
    });
  }
  for (const ins of input.insights) {
    const category = CATEGORY[ins.rule];
    if (!category || GROUPED.indexOf(ins.rule) >= 0) continue; // energy insights are covered by the energy items
    if (ins.rule === "hkEfficiency" && items.some((i) => i.id === "housekeeping_clean")) continue;
    const f = emptyFacts();
    titleFacts(ins.id, ins.title, f);
    const linked = "";
    items.push({
      id: `insight_${ins.id}`, kind: "insight", category, title: INSIGHT_TITLE[ins.rule] ?? "یافته", finding: `${ins.title}${linked}.`,
      cause: null, actionId: actionFor(ins.id), route: category === "inventory" ? "/inventory" : category === "revenue" ? "/insights" : "/maintenance",
      severity: (ins.priority === "high" ? 3 : ins.priority === "medium" ? 2 : 1) + 0.1,
      finance: category === "revenue", facts: f,
    });
  }

  // --------------------------------------------------- critical alerts
  const covered = (type: string) => type === "energySpike" || type === "maintenanceSla";
  const critical = input.alerts.filter((a) => a.severity === "critical" && !covered(a.type));
  if (critical.length) {
    const f = emptyFacts();
    f.counts.openCriticalAlerts = critical.length;
    critical.slice(0, 3).forEach((a, i) => (f.labels[`alert_${i}`] = a.title));
    items.push({
      id: "alerts_critical", kind: "alert", category: "maintenance", title: "هشدارهای بحرانی باز",
      finding: `${fmt(critical.length)} هشدار بحرانی باز است: ${critical.slice(0, 3).map((a) => `«${a.title}»`).join("، ")}.`,
      cause: null, actionId: null, route: "/notifications", severity: 2.5 + critical.length, finance: false, facts: f,
    });
  }

  // ------------------------------------------------- out-of-order rooms now
  const ooo = input.rooms.filter((r) => r.status === "outOfOrder");
  if (ooo.length && !input.insights.some((i) => i.rule === "outOfOrderRooms")) {
    const f = emptyFacts();
    f.roomsNow.outOfOrder = ooo.length;
    items.push({
      id: "rooms_ooo", kind: "status", category: "maintenance", title: "اتاق‌های خارج از سرویس",
      finding: `${fmt(ooo.length)} اتاق خارج از سرویس است.`, cause: null, actionId: null, route: "/rooms",
      severity: 1 + ooo.length / 10, finance: false, facts: f,
    });
  }
  return items;
}

/** Tehran day key of a date (UTC+3:30, no DST since 2022). */
function dayKeyLocal(d: Date): string {
  return new Date(d.getTime() + 210 * 60000).toISOString().slice(0, 10);
}

/** Which categories a role sees, from its effective permission codes. */
export function categoriesFor(perms: Record<string, boolean>): Set<BriefingCategory> {
  const out = new Set<BriefingCategory>();
  if (perms["dashboard.executive"] || perms["dashboard.operations"] || perms["finance.view"]) out.add("occupancy");
  if (perms["energy.view"]) out.add("energy");
  if (perms["maintenance.viewAll"] || perms["maintenance.manage"]) out.add("maintenance");
  if (perms["housekeeping.viewAll"]) out.add("housekeeping");
  if (perms["inventory.view"]) out.add("inventory");
  if (perms["staff.view"]) out.add("staffing");
  if (perms["finance.view"]) out.add("revenue");
  return out;
}

/**
 * The role's items: its categories only, most severe first, at most
 * MAX_ITEMS. A department manager ([department] set) sees staffing items of
 * its own department only; hotel-wide roles pass null.
 */
export function itemsForRole(items: BriefingItem[], perms: Record<string, boolean>, department: string | null = null): BriefingItem[] {
  const cats = categoriesFor(perms);
  const allowed = items.filter((i) => cats.has(i.category) && (!i.finance || perms["finance.view"] === true)
    && (!department || !i.department || i.department === department));
  return allowed.sort((a, b) => b.severity - a.severity || (a.id < b.id ? -1 : 1)).slice(0, MAX_ITEMS);
}

/** Facts of a set of items, merged (what an LLM may see and what its text is checked against). */
export function factsOf(items: BriefingItem[], day: string): ItemFacts & { day: string } {
  const out: ItemFacts & { day: string } = { day, ...emptyFacts() };
  for (const i of items) {
    Object.assign(out.values, i.facts.values);
    Object.assign(out.counts, i.facts.counts);
    Object.assign(out.windows, i.facts.windows);
    Object.assign(out.roomsNow, i.facts.roomsNow);
    Object.assign(out.labels, i.facts.labels);
  }
  return out;
}

/** The rule-based text (Persian). List numbers are exempt from the number check. */
export function briefingText(items: BriefingItem[], day: string): string {
  const lines = [`گزارش صبحگاهی ${day}`];
  if (!items.length) lines.push("دادهٔ کافی برای گزارش امروز نیست: هیچ شاخص یا یافتهٔ تازه‌ای برای نقش شما ثبت نشده است.");
  items.forEach((it, i) => {
    let line = `${i + 1}. ${it.title}: ${it.finding}`;
    if (it.cause) line += ` علت احتمالی: ${it.cause}.`;
    if (it.actionId) line += " یک اقدام پیشنهادی در مرکز اقدام منتظر تصمیم است.";
    lines.push(line);
  });
  return lines.join("\n");
}
