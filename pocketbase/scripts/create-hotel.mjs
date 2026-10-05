// Onboards a hotel on a production server: creates the hotel and its first
// General Manager (who must change the temporary password at first login).
// Everyone else is then created by that manager inside the app.
//
//   ZH_PB_URL=https://api.example.ir \
//   ZH_PB_SUPERUSER_EMAIL=… ZH_PB_SUPERUSER_PASSWORD=… \
//   HOTEL_NAME="هتل نمونه" HOTEL_CITY="اصفهان" HOTEL_ROOMS=80 \
//   GM_NATIONAL_ID=0012345679 GM_NAME="نام مدیر" GM_TEMP_PASSWORD='Temp-2026a' \
//   npm run create-hotel
import { createRequire } from "node:module";
import PocketBase from "pocketbase";

const core = createRequire(import.meta.url)("../pb_hooks/lib/core.js");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

const url = need("ZH_PB_URL");
const nid = core.normalizeNationalId(need("GM_NATIONAL_ID"));
if (!core.isValidNationalId(nid)) throw new Error("GM_NATIONAL_ID is not a valid national ID");
const tempPassword = need("GM_TEMP_PASSWORD");
if (tempPassword.length < 8 || !/[A-Za-z]/.test(tempPassword) || !/\d/.test(tempPassword)) {
  throw new Error("GM_TEMP_PASSWORD needs 8+ characters with letters and digits");
}

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb.collection("_superusers").authWithPassword(need("ZH_PB_SUPERUSER_EMAIL"), need("ZH_PB_SUPERUSER_PASSWORD"));

const hotel = await pb.collection("hotels").create({
  name: need("HOTEL_NAME"),
  city: process.env.HOTEL_CITY ?? "",
  stars: Number(process.env.HOTEL_STARS ?? 0),
  roomCount: Number(process.env.HOTEL_ROOMS ?? 0),
  timezone: "Asia/Tehran",
  currency: "IRR",
  status: "active",
  settings: {},
});

const fullName = need("GM_NAME");
const gm = await pb.collection("users").create({
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

console.log(`Hotel ${hotel.id} created; GM ${core.maskNationalId(nid)} must change the password at first login.`);
console.log(`For n8n: ZARIN_HOTEL_IDS=${hotel.id}`);
