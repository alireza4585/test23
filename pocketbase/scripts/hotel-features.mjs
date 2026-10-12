// Shows or changes a hotel's AI feature flags (hotels.settings.features).
// Every flag is off by default; turning one on changes only that hotel.
//
//   npm run hotel-features -- <hotelId>                          # show
//   npm run hotel-features -- <hotelId> on energyBaseline,forecasts
//   npm run hotel-features -- <hotelId> off forecasts
//
// Flags: energyBaseline, forecasts, recommendationLoop.
// Sign-in: ZH_PB_URL, ZH_PB_SUPERUSER_EMAIL / ZH_PB_SUPERUSER_PASSWORD (or asked).
import PocketBase from "pocketbase";

import { serverUrl, superuserLogin } from "./prompt.mjs";

const FLAGS = ["energyBaseline", "forecasts", "recommendationLoop"];
const [hotelId, mode, list = ""] = process.argv.slice(2);

try {
  if (!hotelId || (mode && mode !== "on" && mode !== "off")) {
    throw new Error("usage: npm run hotel-features -- <hotelId> [on|off <flag,flag>]");
  }
  const names = list.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !FLAGS.includes(n));
  if (unknown.length) throw new Error(`unknown flag(s): ${unknown.join(", ")} (known: ${FLAGS.join(", ")})`);
  if (mode && !names.length) throw new Error("name at least one flag");

  const pb = new PocketBase(await serverUrl());
  pb.autoCancellation(false);
  await superuserLogin(pb);
  const hotel = await pb.collection("hotels").getOne(hotelId);
  const settings = hotel.settings || {};
  const features = { ...(settings.features || {}) };
  if (mode) {
    for (const n of names) features[n] = mode === "on";
    await pb.collection("hotels").update(hotelId, { settings: { ...settings, features } });
  }
  console.log(`«${hotel.name}» (${hotel.status || "active"})`);
  for (const f of FLAGS) console.log(`  ${f.padEnd(20)} ${features[f] === true ? "on" : "off"}`);
} catch (err) {
  console.error(err?.response?.message ?? err?.message ?? String(err));
  process.exit(1);
}
