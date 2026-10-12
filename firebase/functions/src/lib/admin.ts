import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
// Optional fields (e.g. a missing actor role) are dropped instead of
// failing the whole write.
db.settings({ ignoreUndefinedProperties: true });
export const auth = getAuth();
export const messaging = getMessaging();
export { FieldValue, Timestamp };

/** Canonical paths (mirrors `FsPaths` in the Flutter data layer). */
export const paths = {
  user: (uid: string) => `users/${uid}`,
  inbox: (uid: string) => `users/${uid}/inbox`,
  sessions: (uid: string) => `users/${uid}/sessions`,
  hotel: (h: string) => `hotels/${h}`,
  members: (h: string) => `hotels/${h}/members`,
  rooms: (h: string) => `hotels/${h}/rooms`,
  tasks: (h: string) => `hotels/${h}/tasks`,
  tickets: (h: string) => `hotels/${h}/maintenanceTickets`,
  energy: (h: string) => `hotels/${h}/energyReadings`,
  operations: (h: string) => `hotels/${h}/dailyOperations`,
  items: (h: string) => `hotels/${h}/inventoryItems`,
  movements: (h: string) => `hotels/${h}/inventoryMovements`,
  staff: (h: string) => `hotels/${h}/staff`,
  shifts: (h: string) => `hotels/${h}/shifts`,
  alerts: (h: string) => `hotels/${h}/alerts`,
  notifications: (h: string) => `hotels/${h}/notifications`,
  insights: (h: string) => `hotels/${h}/aiInsights`,
  conversations: (h: string) => `hotels/${h}/aiConversations`,
  reports: (h: string) => `hotels/${h}/reports`,
  metrics: (h: string) => `hotels/${h}/dailyMetrics`,
  audit: (h: string) => `hotels/${h}/auditLogs`,
};

/** `yyyy-MM-dd` in the hotel's time zone. */
export function dayKey(date: Date, timeZone = "Asia/Tehran"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}
