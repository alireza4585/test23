// Seeds the demo hotel (same accounts as the app's offline demo) into a
// PocketBase server, as a superuser.
//
//   ZH_PB_URL=http://127.0.0.1:8090 npm run seed
//
// The superuser e-mail and password are asked for unless
// ZH_PB_SUPERUSER_EMAIL / ZH_PB_SUPERUSER_PASSWORD are set. Every demo account
// uses the public password below: never leave it on a server people can
// reach (npm run reset-demo removes it). Refuses to run against a server
// that already has hotels unless ZH_SEED_FORCE=1.
import PocketBase from "pocketbase";
import { pathToFileURL } from "node:url";

import { confirmed, interactive, serverUrl, superuserLogin } from "./prompt.mjs";

export const HOTEL_ID = "zarintehran0001";
export const PASSWORD = "Zarin@2026";

export const ACCOUNTS = [
  ["0157891232", "superAdmin", "مدیر سامانه زرین"],
  ["0023456787", "hotelOwner", "نسرین تهرانی"],
  ["0012345679", "generalManager", "آرش کیانی"],
  ["0034567895", "operationsManager", "بهرام صادقی"],
  ["0045678911", "energyManager", "مریم فرهمند"],
  ["0056789122", "maintenanceManager", "رضا اکبری"],
  ["0067891233", "housekeepingManager", "لیلا محمدی"],
  ["0078912342", "inventoryManager", "حمید نوروزی"],
  ["0089123451", "hrManager", "سارا رضایی"],
  ["0091234565", "receptionStaff", "نیما جعفری"],
  ["0102345678", "housekeepingStaff", "فاطمه حسینی"],
  ["0113456786", "housekeepingStaff", "زهرا کریمی"],
  ["0124567894", "maintenanceStaff", "علی موسوی"],
  ["0135678919", "restaurantManager", "کامران شریفی"],
  ["0168912341", "restaurantStaff", "مهدی قاسمی"],
  ["0146789121", "analyst", "الهام نادری"],
];

const DEPARTMENT = {
  superAdmin: "management", hotelOwner: "management", generalManager: "management", operationsManager: "management",
  analyst: "analytics", energyManager: "energy", maintenanceManager: "maintenance", maintenanceStaff: "maintenance",
  housekeepingManager: "housekeeping", housekeepingStaff: "housekeeping", restaurantManager: "foodAndBeverage",
  restaurantStaff: "foodAndBeverage", inventoryManager: "inventory", hrManager: "humanResources", receptionStaff: "frontOffice",
};

const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const dayKey = (d) => new Date(d.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (key, n) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mask = (nid) => `${nid.slice(0, 3)}•••••${nid.slice(8)}`;

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

/** `pb`: a client signed in as superuser (or `url` + `email` + `password`). */
export async function seed({ pb: client, url, email, password, force = false, log = console.log }) {
  const pb = client ?? new PocketBase(url);
  if (!client) {
    pb.autoCancellation(false);
    await pb.collection("_superusers").authWithPassword(email, password);
  }

  const existing = await pb.collection("hotels").getList(1, 1);
  if (existing.totalItems > 0 && !force) {
    throw new Error("Server already has hotels; set ZH_SEED_FORCE=1 to seed anyway.");
  }

  const rand = rng(42);
  const now = new Date();
  const today = dayKey(now);

  await pb.collection("hotels").create({
    id: HOTEL_ID,
    name: "هتل بزرگ زرین",
    city: "تهران",
    stars: 5,
    roomCount: 60,
    timezone: "Asia/Tehran",
    currency: "IRR",
    status: "active",
    settings: {
      energyDailyBaseline: { electricity: 2400, water: 38, gas: 310 },
      energyTariff: { electricity: 3200, water: 21000, gas: 4100 },
      energyAlertThresholdPct: 15,
      maintenanceSlaHours: { critical: 2, high: 8, medium: 24, low: 72 },
      targetCleanMinutes: { checkoutClean: 35, stayoverClean: 20, deepClean: 90, inspection: 10, turndown: 10 },
      sessionTimeoutMinutes: 30,
    },
    subscription: { plan: "pilot", status: "active" },
  });

  // Users, staff directory and today's shifts.
  const users = {};
  for (const [nid, role, fullName] of ACCOUNTS) {
    const user = await pb.collection("users").create({
      nationalId: nid,
      nationalIdMasked: mask(nid),
      fullName,
      role,
      hotels: role === "superAdmin" ? [] : [HOTEL_ID],
      primaryHotel: HOTEL_ID,
      status: "active",
      mustChangePassword: false,
      locale: "fa",
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    });
    users[nid] = user;
    if (role === "superAdmin") continue;
    const staff = await pb.collection("staff").create({
      hotel: HOTEL_ID, fullName, department: DEPARTMENT[role], position: role, role, user: user.id, active: true,
    });
    await pb.collection("users").update(user.id, { staffId: staff.id });
    await pb.collection("shifts").create({
      hotel: HOTEL_ID, staff: staff.id, staffName: fullName, user: user.id, department: DEPARTMENT[role],
      day: today, type: "morning", startTime: "07:00", endTime: "15:00", status: "checkedIn",
    });
  }

  // 60 rooms on 6 floors.
  const special = {
    "405": "outOfOrder", "609": "outOfOrder", "102": "vacantDirty", "107": "vacantDirty", "204": "vacantDirty",
    "209": "vacantDirty", "205": "cleaningInProgress", "101": "vacantClean", "110": "vacantClean", "208": "vacantClean",
    "307": "vacantClean",
  };
  const rooms = {};
  for (let floor = 1; floor <= 6; floor++) {
    for (let i = 1; i <= 10; i++) {
      const number = `${floor}${String(i).padStart(2, "0")}`;
      rooms[number] = await pb.collection("rooms").create({
        hotel: HOTEL_ID, number, floor,
        type: floor === 6 ? "suite" : floor === 5 ? "deluxe" : i <= 2 ? "single" : i % 2 === 0 ? "twin" : "double",
        status: special[number] ?? "occupied", updatedByName: "seed",
      });
    }
  }

  // 44 days of operations + energy, with a 4-day electricity spike.
  for (let back = 44; back >= 1; back--) {
    const day = addDays(today, -back);
    const [y, m, d] = day.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const occupied = (weekday === 4 || weekday === 5 ? 50 : 41) + Math.round(rand() * 6 - 3);
    const rate = 85_000_000 * (0.92 + rand() * 0.16);
    const spike = back <= 4 ? 1.22 : 1;
    await pb.collection("dailyOperations").create({
      hotel: HOTEL_ID, day, roomsAvailable: 58, roomsOccupied: occupied, guests: Math.round(occupied * 1.7),
      roomRevenue: Math.round(occupied * rate), fnbRevenue: Math.round(occupied * rate * 0.28),
      otherRevenue: Math.round(occupied * rate * 0.06), source: "seed",
    });
    const readings = [
      ["electricity", (1500 + 18.5 * occupied + (rand() * 2 - 1) * 90) * spike, "kWh"],
      ["water", 12 + 0.6 * occupied + (rand() * 2 - 1) * 2.5, "m³"],
      ["gas", 190 + 2.4 * occupied + (rand() * 2 - 1) * 18, "m³"],
    ];
    for (const [type, value, unit] of readings) {
      await pb.collection("energyReadings").create({
        hotel: HOTEL_ID, type, unit, day, consumption: Math.round(value * 10) / 10, source: "manual",
        recordedByName: "مریم فرهمند",
      });
    }
  }

  // Inventory.
  const items = [
    ["شامپو مهمان ۳۰ میلی‌لیتری", "AM-SH30", "guestAmenities", 140, 200, 85000],
    ["صابون مهمان", "AM-SP25", "guestAmenities", 520, 250, 52000],
    ["حوله حمام", "LN-BT70", "linen", 410, 180, 1450000],
    ["ملحفه دونفره", "LN-SH02", "linen", 260, 120, 2100000],
    ["کیسه زباله بزرگ", "CL-BG90", "cleaningSupplies", 7, 12, 320000],
    ["مایع شیشه‌پاک‌کن", "CL-GL01", "cleaningSupplies", 38, 20, 410000],
    ["فیلتر هواساز G4", "MP-FG4", "maintenanceParts", 3, 6, 2400000],
    ["لامپ LED ۹ وات", "MP-LD09", "maintenanceParts", 64, 30, 180000],
  ];
  for (const [name, sku, category, quantity, reorderLevel, unitCost] of items) {
    await pb.collection("inventoryItems").create({
      hotel: HOTEL_ID, name, sku, category, unit: "عدد", quantity, reorderLevel, reorderQuantity: reorderLevel * 3,
      unitCost, location: "انبار مرکزی",
    });
  }

  // Maintenance tickets (side effects: timeline, alerts, inbox).
  const hk = users["0102345678"];
  const tech = users["0124567894"];
  const iso = (d) => d.toISOString();
  const tickets = [
    ["کولر گازی اتاق ۴۰۵ کار نمی‌کند", "hvac", "critical", "405", "inProgress", tech, 3],
    ["چکه کردن شیر روشویی", "plumbing", "medium", "204", "open", null, 30],
    ["لامپ راهرو طبقه ۳ سوخته", "electrical", "low", null, "assigned", tech, 20],
    ["قفل کارتی اتاق ۶۰۹ خراب است", "appliance", "high", "609", "open", null, 11],
  ];
  for (const [title, category, priority, roomNumber, status, assignee, hoursAgo] of tickets) {
    const sla = { critical: 2, high: 8, medium: 24, low: 72 }[priority];
    const createdAt = new Date(now.getTime() - hoursAgo * 3600e3);
    await pb.collection("maintenanceTickets").create({
      hotel: HOTEL_ID, title, description: title, category, priority, status,
      reportedBy: hk.id, reportedByName: hk.fullName, reportedByRole: "housekeepingStaff",
      room: roomNumber ? rooms[roomNumber].id : "", roomNumber: roomNumber ?? "", area: roomNumber ? "" : "راهرو طبقه ۳",
      assignee: assignee?.id ?? "", assigneeName: assignee?.fullName ?? "",
      slaDueAt: iso(new Date(createdAt.getTime() + sla * 3600e3)),
    });
  }

  // Today's housekeeping tasks.
  const tasks = [
    ["102", "checkoutClean", "pending", "high", hk],
    ["107", "checkoutClean", "pending", "normal", hk],
    ["205", "checkoutClean", "inProgress", "normal", hk],
    ["204", "checkoutClean", "pending", "normal", users["0113456786"]],
    ["209", "deepClean", "pending", "low", users["0113456786"]],
  ];
  const gm = users["0067891233"];
  for (const [roomNumber, type, status, priority, assignee] of tasks) {
    await pb.collection("tasks").create({
      hotel: HOTEL_ID, kind: "housekeeping", day: today, room: rooms[roomNumber].id, roomNumber, type, status, priority,
      assignee: assignee.id, assigneeName: assignee.fullName, createdBy: gm.id, createdByName: gm.fullName,
      startedAt: status === "inProgress" ? iso(new Date(now.getTime() - 18 * 60e3)) : "",
    });
  }

  log(`Seeded hotel ${HOTEL_ID}: ${ACCOUNTS.length} users (password ${PASSWORD}), 60 rooms, 44 days of history.`);
  return { hotelId: HOTEL_ID, users };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const url = await serverUrl({ fallback: "http://127.0.0.1:8090" });
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(url);
    if (!local && interactive() && !(await confirmed(`Demo accounts use a public password. Seed ${url} anyway? [y/N] `))) {
      console.log("Nothing was seeded.");
      process.exit(0);
    }
    const pb = new PocketBase(url);
    pb.autoCancellation(false);
    await superuserLogin(pb);
    await seed({ pb, force: process.env.ZH_SEED_FORCE === "1" });
  } catch (err) {
    console.error(err?.response ?? err?.message ?? err);
    process.exit(1);
  }
}
