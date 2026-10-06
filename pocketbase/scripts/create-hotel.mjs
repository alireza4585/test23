// Onboards a hotel on a production server: creates the hotel and its first
// General Manager (who must change the temporary password at first login).
// Everyone else is then created by that manager inside the app.
//
//   ZH_PB_URL=https://….liara.run npm run create-hotel
//
// Whatever is not set in the environment is asked for, passwords without
// echo, and checked as it is typed: ZH_PB_SUPERUSER_EMAIL,
// ZH_PB_SUPERUSER_PASSWORD, HOTEL_NAME, HOTEL_CITY, HOTEL_ROOMS, HOTEL_STARS,
// GM_NAME, GM_NATIONAL_ID (10 digits with a valid check digit, not already
// used) and GM_TEMP_PASSWORD (8+ characters with letters and digits).
import PocketBase from "pocketbase";

import { confirmed, serverUrl, superuserLogin, value } from "./prompt.mjs";
import { core, nationalIdError, passwordError, wholeNumberError } from "./rules.mjs";

const ASKED = ["HOTEL_NAME", "GM_NAME", "GM_NATIONAL_ID", "GM_TEMP_PASSWORD"].some((k) => !process.env[k]);

try {
  const url = await serverUrl();
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  await superuserLogin(pb);

  const taken = async (nid) =>
    (await pb.collection("users").getList(1, 1, { filter: pb.filter("nationalId = {:n}", { n: nid }), fields: "id" })).totalItems > 0;

  const name = await value("HOTEL_NAME", { question: "Hotel name: " });
  const city = await value("HOTEL_CITY", { question: "City (optional): ", fallback: "" });
  const rooms = Number(await value("HOTEL_ROOMS", { question: "Number of rooms (optional): ", fallback: "0", validate: (v) => wholeNumberError(v) }));
  const stars = Number(await value("HOTEL_STARS", { question: "Stars, 0-7 (optional): ", fallback: "0", validate: (v) => wholeNumberError(v, { max: 7 }) }));
  const fullName = await value("GM_NAME", { question: "General manager's full name: " });
  const nid = core.normalizeNationalId(await value("GM_NATIONAL_ID", {
    question: "General manager's national ID (10 digits): ",
    validate: async (v) => nationalIdError(v) ??
      ((await taken(core.normalizeNationalId(v))) ? "A user with this national ID already exists on this server." : undefined),
  }));
  const tempPassword = await value("GM_TEMP_PASSWORD", {
    question: "Temporary password for the manager (8+ characters, letters and digits): ",
    hidden: true, confirm: true, validate: passwordError,
  });

  console.log(`\nHotel «${name}»${city ? `, ${city}` : ""}, ${rooms} rooms. General manager: ${fullName} (${core.maskNationalId(nid)}).`);
  if (ASKED && !(await confirmed("Create it? [y/N] "))) {
    console.log("Nothing was created.");
    process.exit(0);
  }

  const hotel = await pb.collection("hotels").create({
    name, city, stars, roomCount: rooms, timezone: "Asia/Tehran", currency: "IRR", status: "active", settings: {},
  });
  let gm = null;
  try {
    gm = await pb.collection("users").create({
      nationalId: nid,
      nationalIdMasked: core.maskNationalId(nid),
      fullName,
      role: "generalManager",
      hotels: [hotel.id],
      primaryHotel: hotel.id,
      status: "active",
      mustChangePassword: true,
      locale: "fa",
      password: tempPassword,
      passwordConfirm: tempPassword,
    });
    const staff = await pb.collection("staff").create({
      hotel: hotel.id, fullName, department: "management", position: "generalManager", role: "generalManager",
      user: gm.id, active: true,
    });
    await pb.collection("users").update(gm.id, { staffId: staff.id });
  } catch (err) {
    // Leave nothing half-made behind.
    if (gm) await pb.collection("users").delete(gm.id).catch(() => {});
    await pb.collection("hotels").delete(hotel.id).catch(() => {});
    throw err;
  }

  console.log(`Hotel ${hotel.id} created; GM ${core.maskNationalId(nid)} must change the password at first login.`);
  console.log(`For n8n: ZARIN_HOTEL_IDS=${hotel.id}`);
} catch (err) {
  console.error(err?.response ?? err);
  process.exit(1);
}
