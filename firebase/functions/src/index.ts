/**
 * Zarin Hooshmand — Cloud Functions entry point.
 *
 * Callable (app):    adminCreateUser, adminSetUserStatus, adminResetPassword,
 *                    adminUpdateRole, authRegisterSession, authRevokeSessions,
 *                    aiAssistant
 * Triggers:          onTicketCreated, onTicketUpdated, onEnergyReadingWritten,
 *                    onInventoryItemUpdated, onTaskWritten, auditHotelWrites
 * Scheduled:         analyticsDailyRollup (00:20), aiGenerateInsights (06:40)
 * HTTP (n8n / IoT):  api  → /v1/...
 */
export {
  adminCreateUser,
  adminResetPassword,
  adminSetUserStatus,
  adminUpdateRole,
} from "./admin/users";
export { authRegisterSession, authRevokeSessions } from "./auth/sessions";
export { aiAssistant } from "./ai/assistant";
export {
  onEnergyReadingWritten,
  onInventoryItemUpdated,
  onTaskWritten,
  onTicketCreated,
  onTicketUpdated,
} from "./triggers/operations";
export { auditHotelWrites } from "./triggers/audit";
export { aiGenerateInsights, analyticsDailyRollup } from "./analytics/scheduled";
export { api } from "./api/http";
