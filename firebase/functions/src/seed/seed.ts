/**
 * Seeds a demo hotel into the Firebase emulators (or a dev project).
 *
 *   firebase emulators:start            # in another terminal
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   GCLOUD_PROJECT=zarin-hoshmand npm run seed   # the app's projectId
 *
 * Refuses to touch a real project unless ZH_SEED_ALLOW_REMOTE=1.
 */
import { applyClaims, departmentOf } from "../admin/users";
import { AUTH_EMAIL_DOMAIN } from "../config";
import { authEmailFor, maskNationalId } from "../domain/national-id";
import { PERMISSIONS, Role, ROLE_PERMISSIONS, ROLE_TIER, ROLES, ASSIGNABLE_ROLES } from "../domain/rbac";
import { addDays, auth, dayKey, db, FieldValue, paths, Timestamp } from "../lib/admin";

const HOTEL_ID = "zarin-grand-tehran";
const PASSWORD = "Zarin@2026";

const USERS: [string, Role, string][] = [
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

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

async function main() {
  const remote = !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (remote && process.env.ZH_SEED_ALLOW_REMOTE !== "1") {
    throw new Error("Refusing to seed a non-emulator project (set ZH_SEED_ALLOW_REMOTE=1 to override).");
  }
  const rand = rng(42);
  const now = new Date();
  const today = dayKey(now);

  // Catalogs ------------------------------------------------------------
  const catalog = db.batch();
  for (const p of PERMISSIONS) {
    catalog.set(db.doc(`permissions/${p}`), { code: p, module: p.split(".")[0] });
  }
  for (const r of ROLES) {
    catalog.set(db.doc(`roleTemplates/${r}`), {
      role: r,
      tier: ROLE_TIER[r],
      permissions: ROLE_PERMISSIONS[r],
      assignableRoles: ASSIGNABLE_ROLES[r] ?? [],
      version: 1,
    });
  }
  catalog.set(db.doc(paths.hotel(HOTEL_ID)), {
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
    createdAt: FieldValue.serverTimestamp(),
  });
  await catalog.commit();

  // Users ---------------------------------------------------------------
  for (const [nid, role, name] of USERS) {
    const email = authEmailFor(nid, AUTH_EMAIL_DOMAIN);
    const user = await auth.getUserByEmail(email).catch(() =>
      auth.createUser({ email, password: PASSWORD, displayName: name }),
    );
    const hotelIds = role === "superAdmin" ? [] : [HOTEL_ID];
    await applyClaims(user.uid, role, hotelIds);
    const staffId = `s-${user.uid}`;
    const b = db.batch();
    b.set(db.doc(paths.user(user.uid)), {
      nationalId: nid,
      nationalIdMasked: maskNationalId(nid),
      fullName: name,
      role,
      hotelIds,
      primaryHotelId: role === "superAdmin" ? HOTEL_ID : HOTEL_ID,
      staffId,
      status: "active",
      mustChangePassword: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (role !== "superAdmin") {
      b.set(db.doc(`${paths.members(HOTEL_ID)}/${user.uid}`), {
        fullName: name,
        nationalIdMasked: maskNationalId(nid),
        role,
        tier: ROLE_TIER[role],
        status: "active",
      });
      b.set(db.doc(`${paths.staff(HOTEL_ID)}/${staffId}`), {
        fullName: name,
        department: departmentOf(role),
        position: role,
        role,
        userId: user.uid,
        active: true,
      });
      b.set(db.doc(`${paths.shifts(HOTEL_ID)}/sh-${staffId}-${today}`), {
        staffId,
        staffName: name,
        userId: user.uid,
        department: departmentOf(role),
        day: today,
        type: "morning",
        startTime: "07:00",
        endTime: "15:00",
        status: "checkedIn",
      });
    }
    await b.commit();
  }

  // Rooms ---------------------------------------------------------------
  const rooms = db.batch();
  const special: Record<string, string> = {
    "405": "outOfOrder", "609": "outOfOrder", "102": "vacantDirty", "107": "vacantDirty",
    "204": "vacantDirty", "209": "vacantDirty", "205": "cleaningInProgress", "101": "vacantClean",
    "110": "vacantClean", "208": "vacantClean", "307": "vacantClean",
  };
  for (let floor = 1; floor <= 6; floor++) {
    for (let i = 1; i <= 10; i++) {
      const number = `${floor}${String(i).padStart(2, "0")}`;
      rooms.set(db.doc(`${paths.rooms(HOTEL_ID)}/room-${number}`), {
        number,
        floor,
        type: floor === 6 ? "suite" : floor === 5 ? "deluxe" : i <= 2 ? "single" : i % 2 === 0 ? "twin" : "double",
        status: special[number] ?? "occupied",
        updatedAt: FieldValue.serverTimestamp(),
        updatedByName: "seed",
      });
    }
  }
  await rooms.commit();

  // 45 days of operations + energy (with a 4-day electricity spike) -----
  for (let back = 44; back >= 1; back--) {
    const day = addDays(today, -back);
    const [y, m, d] = day.split("-").map(Number);
    const date = Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d)));
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const occupied = (weekday === 4 || weekday === 5 ? 50 : 41) + Math.round(rand() * 6 - 3);
    const rate = 85_000_000 * (0.92 + rand() * 0.16);
    const spike = back <= 4 ? 1.22 : 1;
    const b = db.batch();
    b.set(db.doc(`${paths.operations(HOTEL_ID)}/${day}`), {
      day, date, roomsAvailable: 58, roomsOccupied: occupied, guests: Math.round(occupied * 1.7),
      roomRevenue: Math.round(occupied * rate), fnbRevenue: Math.round(occupied * rate * 0.28),
      otherRevenue: Math.round(occupied * rate * 0.06), source: "seed",
    });
    const readings: [string, number, string][] = [
      ["electricity", (1500 + 18.5 * occupied + (rand() * 2 - 1) * 90) * spike, "kWh"],
      ["water", 12 + 0.6 * occupied + (rand() * 2 - 1) * 2.5, "m³"],
      ["gas", 190 + 2.4 * occupied + (rand() * 2 - 1) * 18, "m³"],
    ];
    for (const [type, value, unit] of readings) {
      b.set(db.doc(`${paths.energy(HOTEL_ID)}/${day}_${type}`), {
        type, unit, day, date, consumption: Math.round(value * 10) / 10, source: "manual",
        recordedByName: "مریم فرهمند", createdAt: FieldValue.serverTimestamp(),
      });
    }
    await b.commit();
  }

  // Inventory -------------------------------------------------------------
  const items: [string, string, string, string, number, number, number][] = [
    ["inv-1", "شامپو مهمان ۳۰ میلی‌لیتری", "AM-SH30", "guestAmenities", 140, 200, 85000],
    ["inv-2", "صابون مهمان", "AM-SP25", "guestAmenities", 520, 250, 52000],
    ["inv-4", "حوله حمام", "LN-BT70", "linen", 410, 180, 1450000],
    ["inv-7", "کیسه زباله بزرگ", "CL-BG90", "cleaningSupplies", 7, 12, 320000],
    ["inv-11", "فیلتر هواساز G4", "MP-FG4", "maintenanceParts", 3, 6, 2400000],
  ];
  const inv = db.batch();
  for (const [id, name, sku, category, quantity, reorderLevel, unitCost] of items) {
    inv.set(db.doc(`${paths.items(HOTEL_ID)}/${id}`), {
      name, sku, category, unit: "عدد", quantity, reorderLevel, reorderQuantity: reorderLevel * 3,
      unitCost, location: "انبار مرکزی", updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await inv.commit();

  console.log(`Seeded ${HOTEL_ID}: ${USERS.length} users (password ${PASSWORD}), 60 rooms, 44 days of history.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
