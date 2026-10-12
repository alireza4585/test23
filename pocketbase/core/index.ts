/**
 * Domain code shared with the Firebase backend, bundled into
 * `pb_hooks/lib/core.js` for PocketBase's JS runtime (`npm run build:core`).
 * Pure functions only: no Node, Firebase or Intl APIs (ES2019 for goja).
 */
export {
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_TIER,
  ROLES,
  ROOM_TRANSITIONS,
  can,
  canAssign,
  isRole,
  rolesWith,
} from "../../firebase/functions/src/domain/rbac";
export {
  isValidNationalId,
  maskNationalId,
  normalizeNationalId,
} from "../../firebase/functions/src/domain/national-id";
export { computeDailyMetrics } from "../../firebase/functions/src/analytics/metrics";
export { generateInsights } from "../../firebase/functions/src/analytics/rules-engine";
export {
  ACTIVE_TICKET_STATUSES,
  DEFAULT_SETTINGS,
  isActiveTicket,
} from "../../firebase/functions/src/analytics/types";
export {
  dayToJalali,
  dayToUtcMs,
  daySet,
  daysBetween,
  iranFixedHolidays,
  jalaliToDay,
  shiftDay,
  weekdayOf,
} from "../../firebase/functions/src/analytics/calendar";
export { MIN_HISTORY_DAYS, forecastSeries } from "../../firebase/functions/src/analytics/forecast";
export {
  MAX_CVRMSE,
  MIN_BASELINE_DAYS,
  checkReading,
  expected as expectedEnergy,
  fitBaseline,
  measure as measureEnergy,
} from "../../firebase/functions/src/analytics/energy-baseline";
export {
  EVALUATION_WINDOW_DAYS,
  evaluateCount,
  evaluateEnergy,
  evaluateMean,
  evaluateOutcome,
} from "../../firebase/functions/src/analytics/evaluation";
