/**
 * Day keys (`YYYY-MM-DD`, Tehran calendar day), Jalali ↔ Gregorian
 * conversion and Iran's fixed (solar-calendar) public holidays.
 *
 * Lunar (Hijri) holidays move every year and are NOT computed here: hotels
 * enter them as calendar events from the official calendar, so nothing in
 * the forecasts depends on a guessed date.
 *
 * Jalali conversion: the Borkowski arithmetic used by jalaali-js (valid for
 * Jalali years −61…3177).
 */

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a: number, b: number) => ~~(a / b);
const mod = (a: number, b: number) => a - ~~(a / b) * b;

/** Gregorian year and March day of 1 Farvardin of Jalali year [jy]. */
function nowruz(jy: number): { gy: number; march: number } {
  if (jy < BREAKS[0] || jy >= BREAKS[BREAKS.length - 1]) throw new Error(`Jalali year out of range: ${jy}`);
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  const n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  return { gy, march: 20 + leapJ - leapG };
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

export function dayKeyOfUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function dayToUtcMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function shiftDay(day: string, delta: number): string {
  return dayKeyOfUtc(dayToUtcMs(day) + delta * 864e5);
}

/** Whole days from [a] to [b] (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayToUtcMs(b) - dayToUtcMs(a)) / 864e5);
}

/** 0 = Sunday … 4 = Thursday, 5 = Friday, 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(dayToUtcMs(day)).getUTCDay();
}

/** Gregorian day key of Jalali date [jy]/[jm]/[jd]. */
export function jalaliToDay(jy: number, jm: number, jd: number): string {
  const { gy, march } = nowruz(jy);
  const offset = (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  return shiftDay(`${gy}-03-${pad(march)}`, offset);
}

/** Jalali date of a Gregorian day key. */
export function dayToJalali(day: string): { jy: number; jm: number; jd: number } {
  const gy = Number(day.slice(0, 4));
  let jy = gy - 621;
  let start = jalaliToDay(jy, 1, 1);
  if (day < start) {
    jy -= 1;
    start = jalaliToDay(jy, 1, 1);
  }
  let k = daysBetween(start, day); // 0-based day of the Jalali year
  if (k < 186) return { jy, jm: 1 + div(k, 31), jd: 1 + mod(k, 31) };
  k -= 186;
  return { jy, jm: 7 + div(k, 30), jd: 1 + mod(k, 30) };
}

export interface CalendarDay {
  day: string;
  endDay?: string;
  kind: string;
  title: string;
}

/** Fixed solar-calendar public holidays of Iran (Jalali month, day, Persian title). */
const FIXED_HOLIDAYS: Array<[number, number, string]> = [
  [1, 1, "نوروز"],
  [1, 2, "نوروز"],
  [1, 3, "نوروز"],
  [1, 4, "نوروز"],
  [1, 12, "روز جمهوری اسلامی"],
  [1, 13, "روز طبیعت"],
  [3, 14, "رحلت امام خمینی"],
  [3, 15, "قیام ۱۵ خرداد"],
  [11, 22, "پیروزی انقلاب اسلامی"],
  [12, 29, "ملی شدن صنعت نفت"],
];

/** Fixed public holidays between [from] and [to] (inclusive day keys). */
export function iranFixedHolidays(from: string, to: string): CalendarDay[] {
  const out: CalendarDay[] = [];
  const first = dayToJalali(from).jy;
  const last = dayToJalali(to).jy;
  for (let jy = first; jy <= last; jy++) {
    for (const [jm, jd, title] of FIXED_HOLIDAYS) {
      const day = jalaliToDay(jy, jm, jd);
      if (day >= from && day <= to) out.push({ day, kind: "publicHoliday", title });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Set of day keys covered by [events] (each event spans day…endDay). */
export function daySet(events: CalendarDay[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    const end = e.endDay && e.endDay >= e.day ? e.endDay : e.day;
    for (let d = e.day, i = 0; d <= end && i < 400; d = shiftDay(d, 1), i++) out.add(d);
  }
  return out;
}
