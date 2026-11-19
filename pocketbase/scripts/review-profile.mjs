// F10 onboarding (platform owner): shows or sets a hotel's guest-review profile
// and listings. Managers can edit the same profile in the app afterwards.
//
//   npm run review-profile -- <hotelId>                                # show
//   npm run review-profile -- <hotelId> --apply profile.json           # {profile, listings}
//   npm run review-profile -- <hotelId> --apply hotels.json --key k    # one entry of a {hotels: [...]} file
//
// Then: a dry run in the app (Reviews → onboarding), and the flag:
//   npm run hotel-features -- <hotelId> on guestReviews
// Sign-in: ZH_PB_URL, ZH_PB_SUPERUSER_EMAIL / ZH_PB_SUPERUSER_PASSWORD (or asked).
import { readFileSync } from "node:fs";

import PocketBase from "pocketbase";

import { applySpec, specErrors } from "./lib/review-profile.mjs";
import { serverUrl, superuserLogin } from "./prompt.mjs";

const args = process.argv.slice(2);
const hotelId = args[0];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

try {
  if (!hotelId || hotelId.startsWith("--")) throw new Error("usage: npm run review-profile -- <hotelId> [--apply <file.json> [--key <key>]]");
  let spec = null;
  const file = opt("--apply");
  if (file) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    const key = opt("--key");
    spec = Array.isArray(json.hotels) ? json.hotels.find((h) => h.key === key) : json;
    if (!spec) throw new Error(`no entry with key "${key}" in ${file}`);
    const errors = specErrors(spec);
    if (errors.length) throw new Error(`invalid profile:\n  ${errors.join("\n  ")}`);
  }
  const pb = new PocketBase(await serverUrl());
  pb.autoCancellation(false);
  await superuserLogin(pb);
  const hotel = await pb.collection("hotels").getOne(hotelId);
  if (spec) {
    const r = await applySpec(pb, hotelId, spec);
    console.log(`profile ${r.profile}; listings: ${r.listings.created} added, ${r.listings.updated} updated`);
  }
  const profile = (await pb.collection("reviewProfiles").getList(1, 1, { filter: pb.filter("hotel = {:h}", { h: hotelId }) })).items[0];
  const listings = await pb.collection("reviewSources").getFullList({ filter: pb.filter("hotel = {:h}", { h: hotelId }), sort: "platform" });
  const tokens = await pb.collection("reviewSurveyTokens").getFullList({ filter: pb.filter("hotel = {:h} && active = true", { h: hotelId }), fields: "kind" });
  console.log(`«${hotel.name}» (${hotel.status || "active"}); guestReviews ${hotel.settings?.features?.guestReviews === true ? "on" : "off"}`);
  if (!profile) console.log("  no review profile yet");
  else {
    console.log(`  names: ${[profile.names?.fa, profile.names?.en].filter(Boolean).join(" / ")}; city: ${profile.city || "-"}`);
    console.log(`  aliases: ${(profile.aliases || []).join("، ") || "-"}; negative keywords: ${(profile.negativeKeywords || []).join("، ") || "-"}`);
    console.log(`  retention: ${profile.retentionDays || 365} days; schedule: ${profile.schedule?.ingest || "06:00"} / ${profile.schedule?.digest || "06:30"}`);
  }
  for (const l of listings) console.log(`  listing ${l.platform.padEnd(12)} ${l.status.padEnd(10)} ${l.url || l.externalId}`);
  console.log(`  survey tokens: ${tokens.filter((t) => t.kind === "public").length} public, ${tokens.filter((t) => t.kind === "room").length} room`);
} catch (err) {
  console.error(err?.response?.message ?? err?.message ?? String(err));
  process.exit(1);
}
