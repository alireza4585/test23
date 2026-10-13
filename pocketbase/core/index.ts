/**
 * Domain code shared with the Firebase backend, bundled into
 * `pb_hooks/lib/core.js` for PocketBase's JS runtime (`npm run build:core`).
 * Pure functions only: no Node, Firebase or Intl APIs (ES2019 for goja).
 */
export {
  ACTION_DEPARTMENTS,
  ASSIGNABLE_ROLES,
  BASELINE_ADJUST_ROLES,
  PERMISSIONS,
  ROLE_ACTION_DEPARTMENTS,
  ROLE_PERMISSIONS,
  ROLE_TIER,
  ROLES,
  ROOM_TRANSITIONS,
  can,
  canAssign,
  canDecideDepartment,
  isRole,
  rolesWith,
} from "../../firebase/functions/src/domain/rbac";
export {
  isValidNationalId,
  maskNationalId,
  normalizeNationalId,
} from "../../firebase/functions/src/domain/national-id";
export { computeDailyMetrics } from "../../firebase/functions/src/analytics/metrics";
export { energyModelRule, generateInsights } from "../../firebase/functions/src/analytics/rules-engine";
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
export {
  CUSUM_H,
  MAX_CVRMSE_MONTHLY,
  MAX_EXCLUDED_DAYS_PER_MONTH,
  MIN_MODEL_DAYS,
  REFIT_DAYS,
  exclusionMonth,
  fitEnergyModel,
  measureWithModel,
  predictDay,
  scoreDay,
} from "../../firebase/functions/src/analytics/energy-model";
export { ACTION_TYPES, EDITABLE_PARAMS, proposeActions } from "../../firebase/functions/src/analytics/actions";
export { bootstrapMeanDiff } from "../../firebase/functions/src/analytics/stats";
export {
  briefingText,
  buildItems as buildBriefingItems,
  categoriesFor as briefingCategoriesFor,
  factsOf as briefingFactsOf,
  itemsForRole as briefingItemsForRole,
} from "../../firebase/functions/src/analytics/briefing";
