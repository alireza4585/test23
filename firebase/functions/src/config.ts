import { defineSecret, defineString } from "firebase-functions/params";

/** Deployment region — keep in sync with the app's `ZH_FUNCTIONS_REGION`. */
export const REGION = "europe-west3";

/** Hotels operate on Tehran time; daily keys and schedules use it. */
export const TIMEZONE = "Asia/Tehran";

/** Domain of the synthetic Auth e-mails (`<nationalId>@…`). */
export const AUTH_EMAIL_DOMAIN = "id.zarinhooshmand.app";

/** LLM credentials never leave the server (Secret Manager). */
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

/** Model for the assistant and insight narration. */
export const AI_MODEL = defineString("AI_MODEL", { default: "claude-opus-5-5" });

/** n8n: outbound event webhook + shared HMAC secret for both directions. */
export const N8N_WEBHOOK_URL = defineString("N8N_WEBHOOK_URL", { default: "" });
export const INTEGRATION_SECRET = defineSecret("INTEGRATION_SECRET");

/** Per-user assistant budget (requests per hour). */
export const AI_RATE_LIMIT_PER_HOUR = 30;
