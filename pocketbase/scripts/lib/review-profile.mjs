// F10 onboarding: validate and apply a hotel's review profile and listings as
// the platform owner (superuser). Used by scripts/review-profile.mjs and the
// tests. The spec is data (fixtures/reviews/src/hotels.json has three
// fictional examples); nothing here names a hotel. The app's profile route
// applies the same limits for hotel managers.
import { createRequire } from "node:module";

const core = createRequire(import.meta.url)("../../pb_hooks/lib/core.js");

const ROLES = ["hotelOwner", "generalManager", "operationsManager", "maintenanceManager", "housekeepingManager", "restaurantManager", "inventoryManager", "analyst"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

const clean = (s, max) => core.sanitizeReviewText(String(s ?? ""), max).replace(/\n/g, " ").trim();

/** Problems in [spec] ({profile, listings}); an empty list means it can be applied. */
export function specErrors(spec) {
  const errors = [];
  const p = spec?.profile;
  if (!p || typeof p !== "object") return ["profile is missing"];
  if (!p.names || (!clean(p.names.fa, 120) && !clean(p.names.en, 120))) errors.push("names.fa or names.en is required");
  const list = (k, maxItems, maxLen) => {
    if (p[k] === undefined) return;
    if (!Array.isArray(p[k]) || p[k].length > maxItems || p[k].some((x) => typeof x !== "string" || x.length > maxLen)) errors.push(`${k}: up to ${maxItems} texts of ${maxLen} characters`);
  };
  list("aliases", 30, 120);
  list("cityAliases", 10, 80);
  list("negativeKeywords", 30, 120);
  if (p.retentionDays !== undefined && !(Number.isInteger(p.retentionDays) && p.retentionDays >= 1 && p.retentionDays <= 730)) errors.push("retentionDays: 1–730");
  for (const k of ["ingest", "digest"]) if (p.schedule?.[k] !== undefined && !HHMM.test(p.schedule[k])) errors.push(`schedule.${k}: HH:MM`);
  if (p.recipients?.roles && (!Array.isArray(p.recipients.roles) || p.recipients.roles.some((r) => !ROLES.includes(r)))) errors.push(`recipients.roles: ${ROLES.join(", ")}`);
  if (p.recipients?.emails && (!Array.isArray(p.recipients.emails) || p.recipients.emails.length > 10 || p.recipients.emails.some((e) => !EMAIL.test(e)))) errors.push("recipients.emails: up to 10 addresses");
  if (p.survey?.languages && (!Array.isArray(p.survey.languages) || !p.survey.languages.length || p.survey.languages.some((l) => l !== "fa" && l !== "en"))) errors.push("survey.languages: fa, en");
  for (const [i, l] of (spec.listings || []).entries()) {
    if (!core.REVIEW_PLATFORMS.includes(l.platform) || l.platform === "survey") errors.push(`listings[${i}].platform`);
    if (!l.url && !l.externalId) errors.push(`listings[${i}]: url or externalId`);
    if (l.url && (l.url.length > 500 || !URL_RE.test(l.url))) errors.push(`listings[${i}].url`);
    if (l.status && !["candidate", "confirmed", "rejected"].includes(l.status)) errors.push(`listings[${i}].status`);
    if (l.scaleMax !== undefined && !(Number(l.scaleMax) > Number(l.scaleMin ?? 1))) errors.push(`listings[${i}].scaleMax`);
  }
  return errors;
}

/**
 * Creates or updates the hotel's profile and listings (by platform + URL or ID).
 * Superuser client [pb]. Returns what changed. Recorded in auditLogs (action reviewProfiles.onboard).
 */
export async function applySpec(pb, hotelId, spec) {
  const errors = specErrors(spec);
  if (errors.length) throw new Error(`invalid profile: ${errors.join("; ")}`);
  const p = spec.profile;
  const data = {
    hotel: hotelId,
    names: { fa: clean(p.names.fa, 120), en: clean(p.names.en, 120) },
    aliases: (p.aliases || []).map((x) => clean(x, 120)).filter(Boolean),
    city: clean(p.city, 80),
    cityAliases: (p.cityAliases || []).map((x) => clean(x, 80)).filter(Boolean),
    address: clean(p.address, 300),
    negativeKeywords: (p.negativeKeywords || []).map((x) => clean(x, 120)).filter(Boolean),
    retentionDays: p.retentionDays ?? 365,
  };
  for (const k of ["schedule", "recipients", "toggles", "survey"]) if (p[k] !== undefined) data[k] = p[k];
  const existing = await pb.collection("reviewProfiles").getList(1, 1, { filter: pb.filter("hotel = {:h}", { h: hotelId }) });
  const now = new Date().toISOString().replace("T", " ");
  const prev = existing.items[0];
  data.onboarding = { ...(prev?.onboarding || {}), profile: now, listings: now };
  const profile = prev ? await pb.collection("reviewProfiles").update(prev.id, data) : await pb.collection("reviewProfiles").create(data);
  const listings = { created: 0, updated: 0 };
  for (const l of spec.listings || []) {
    const filter = l.url
      ? pb.filter("hotel = {:h} && platform = {:p} && url = {:u}", { h: hotelId, p: l.platform, u: l.url })
      : pb.filter("hotel = {:h} && platform = {:p} && externalId = {:x}", { h: hotelId, p: l.platform, x: l.externalId });
    const found = (await pb.collection("reviewSources").getList(1, 1, { filter })).items[0];
    const scale = l.scaleMax !== undefined ? { min: Number(l.scaleMin ?? 1), max: Number(l.scaleMax) } : core.REVIEW_PLATFORM_SCALES[l.platform] || null;
    const status = l.status || "candidate";
    const row = {
      hotel: hotelId, platform: l.platform, url: l.url || "", externalId: l.externalId || "", label: clean(l.label, 120), status,
      matchScore: status === "confirmed" ? 1 : 0, scaleMin: scale ? scale.min : null, scaleMax: scale ? scale.max : null,
      decidedByName: status === "candidate" ? "" : "onboarding (CLI)", decidedAt: status === "candidate" ? "" : now,
    };
    if (found) { await pb.collection("reviewSources").update(found.id, row); listings.updated++; }
    else { await pb.collection("reviewSources").create(row); listings.created++; }
  }
  await pb.collection("auditLogs").create({
    hotel: hotelId, action: "reviewProfiles.onboard", resourceCollection: "reviewProfiles", resourceId: profile.id,
    actor: { type: "superuser", name: "onboarding (CLI)" }, changes: { profile: prev ? "updated" : "created", listings, via: "cli" }, source: "server",
  });
  return { profileId: profile.id, profile: prev ? "updated" : "created", listings };
}
