// Removes the demo hotel created by `npm run seed` before real use: the hotel
// with all of its data (rooms, tasks, tickets, readings, inventory, staff,
// alerts, reports, audit log, …), every user who belongs to no other hotel,
// and the seed's own accounts (including its hotel-less superAdmin, whose
// password is public). Superusers (`_superusers`), settings and other hotels
// are not touched. Dry run unless --yes is given.
//
//   ZH_PB_URL=https://….liara.run npm run reset-demo
//
// Shows what would be deleted, then (in a terminal) asks you to type "yes".
// The superuser e-mail and password are asked for unless
// ZH_PB_SUPERUSER_EMAIL / ZH_PB_SUPERUSER_PASSWORD are set; `-- --yes`
// deletes without asking (automation). HOTEL_ID=<id> removes another hotel
// instead of the seed's.
import PocketBase from "pocketbase";
import { pathToFileURL } from "node:url";

import { confirmed, interactive, serverUrl, superuserLogin } from "./prompt.mjs";
import { ACCOUNTS, HOTEL_ID as SEED_HOTEL_ID } from "./seed.mjs";

/**
 * `pb`: a client signed in as superuser (or `url` + `email` + `password`).
 * `accounts`: national IDs of extra users to remove when they belong to no
 * other hotel (by default the seed's accounts, when resetting the seed hotel).
 */
export async function resetHotel({
  pb: client, url, email, password, hotelId = SEED_HOTEL_ID, apply = false, log = console.log,
  accounts = hotelId === SEED_HOTEL_ID ? ACCOUNTS.map(([nid]) => nid) : [],
}) {
  const pb = client ?? new PocketBase(url);
  if (!client) {
    pb.autoCancellation(false);
    await pb.collection("_superusers").authWithPassword(email, password);
  }
  url = pb.baseURL ?? pb.baseUrl ?? url;

  let hotel = null;
  try {
    hotel = await pb.collection("hotels").getOne(hotelId);
  } catch (err) {
    if (err?.status !== 404) throw err;
  }

  // Every collection with a `hotel` relation is cascade-deleted with the hotel.
  const counts = {};
  if (hotel) {
    const collections = await pb.collections.getFullList();
    const hotels = collections.find((c) => c.name === "hotels");
    for (const c of collections) {
      if (!c.fields.some((f) => f.type === "relation" && f.name === "hotel" && f.collectionId === hotels.id)) continue;
      const page = await pb.collection(c.name).getList(1, 1, { filter: pb.filter("hotel = {:h}", { h: hotelId }), fields: "id" });
      if (page.totalItems) counts[c.name] = page.totalItems;
    }
  }
  const members = await pb.collection("users").getFullList({ filter: pb.filter("hotels.id ?= {:h}", { h: hotelId }) });
  for (const nid of accounts) {
    const extra = await pb.collection("users").getFullList({ filter: pb.filter("nationalId = {:n}", { n: nid }) });
    for (const u of extra) if (!members.some((m) => m.id === u.id)) members.push(u);
  }
  const users = members.filter((u) => u.hotels.every((h) => h === hotelId));
  const shared = members.filter((u) => !users.includes(u));

  if (!hotel && !users.length) {
    log(`No hotel ${hotelId} and no demo users on ${url}: nothing to remove.`);
    return { found: false };
  }
  log(hotel ? `Hotel ${hotel.id} «${hotel.name}» on ${url}` : `Hotel ${hotelId} is already gone from ${url}`);
  for (const [name, n] of Object.entries(counts)) log(`  ${String(n).padStart(6)}  ${name}`);
  log(`Users to delete (in no other hotel) (${users.length}):`);
  for (const u of users) log(`  ${u.nationalIdMasked || "—"}  ${u.role.padEnd(20)}  ${u.fullName}`);
  if (shared.length) log(`Kept (also in other hotels; only the link to this hotel goes): ${shared.map((u) => u.fullName).join(", ")}`);

  const result = { found: !!hotel, counts, users: users.length };
  if (!apply) return { ...result, deleted: false };
  for (const u of users) await pb.collection("users").delete(u.id);
  if (hotel) await pb.collection("hotels").delete(hotel.id);
  log(`\nDeleted ${hotel ? `hotel ${hotel.id} and ` : ""}${users.length} users.`);
  return { ...result, deleted: true };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const pb = new PocketBase(await serverUrl());
    pb.autoCancellation(false);
    await superuserLogin(pb);
    const hotelId = process.env.HOTEL_ID || SEED_HOTEL_ID;
    const plan = await resetHotel({ pb, hotelId });
    if (plan.found || plan.users) {
      if (process.argv.includes("--yes") || (interactive() && (await confirmed('\nDelete all of the above? Type "yes" to confirm: ')))) {
        await resetHotel({ pb, hotelId, apply: true, log: (line) => line.startsWith("\nDeleted") && console.log(line) });
      } else {
        console.log("\nNothing was deleted.");
      }
    }
  } catch (err) {
    console.error(err?.response ?? err);
    process.exit(1);
  }
}
