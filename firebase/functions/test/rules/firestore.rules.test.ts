/**
 * Security-rules tests against the Firestore emulator.
 *   npm run test:rules   (wraps `firebase emulators:exec`)
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  addDoc,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const H = "hotel-a";
const OTHER = "hotel-b";
let env: RulesTestEnvironment;

const as = (uid: string, role: string, hotelIds = [H]) =>
  env.authenticatedContext(uid, { role, hotelIds }).firestore();
const actor = (uid: string, role: string) => ({ uid, name: uid, role });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-zarin-rules",
    firestore: {
      rules: readFileSync(join(__dirname, "..", "..", "..", "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const h of [H, OTHER]) {
      await setDoc(doc(db, `hotels/${h}`), { name: h, status: "active" });
      await setDoc(doc(db, `hotels/${h}/rooms/room-101`), { number: "101", status: "vacantDirty" });
    }
    await setDoc(doc(db, `hotels/${H}/rooms/room-102`), { number: "102", status: "vacantClean" });
    await setDoc(doc(db, `hotels/${H}/rooms/room-103`), { number: "103", status: "occupied" });
    await setDoc(doc(db, `hotels/${H}/tasks/t-mine`), {
      kind: "housekeeping", day: "2026-10-05", status: "pending", assigneeId: "hk1", roomId: "room-101",
    });
    await setDoc(doc(db, `hotels/${H}/tasks/t-other`), {
      kind: "housekeeping", day: "2026-10-05", status: "pending", assigneeId: "hk2", roomId: "room-102",
    });
    await setDoc(doc(db, `hotels/${H}/maintenanceTickets/mt-hk1`), {
      title: "Leak", status: "open", priority: "high", reportedById: "hk1", assigneeId: "tech1",
    });
    await setDoc(doc(db, `hotels/${H}/maintenanceTickets/mt-other`), {
      title: "TV", status: "open", priority: "low", reportedById: "fo1",
    });
    await setDoc(doc(db, `hotels/${H}/inventoryItems/inv-1`), { name: "Soap", quantity: 10, reorderLevel: 5 });
    await setDoc(doc(db, `hotels/${H}/alerts/al-1`), {
      title: "Energy", status: "open", audienceRoles: ["generalManager", "energyManager"],
    });
    await setDoc(doc(db, `users/hk1`), { role: "housekeepingStaff", mustChangePassword: true, hotelIds: [H] });
  });
});

describe("tenant isolation", () => {
  it("members read their hotel, never another one", async () => {
    const gm = as("gm", "generalManager");
    await assertSucceeds(getDoc(doc(gm, `hotels/${H}/rooms/room-101`)));
    await assertFails(getDoc(doc(gm, `hotels/${OTHER}/rooms/room-101`)));
  });
  it("forged claims for another hotel are useless without membership", async () => {
    const outsider = as("x", "generalManager", [OTHER]);
    await assertFails(getDoc(doc(outsider, `hotels/${H}`)));
  });
  it("unauthenticated users read nothing", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `hotels/${H}`)));
  });
});

describe("housekeeping staff", () => {
  const hk = () => as("hk1", "housekeepingStaff");

  it("can list only their own tasks", async () => {
    const tasks = collection(hk(), `hotels/${H}/tasks`);
    await assertSucceeds(getDocs(query(tasks, where("assigneeId", "==", "hk1"))));
    await assertFails(getDocs(query(tasks, where("day", "==", "2026-10-05"))));
  });

  it("starts their task with a server timestamp, but cannot skip to done", async () => {
    const ref = doc(hk(), `hotels/${H}/tasks/t-mine`);
    await assertFails(updateDoc(ref, { status: "done", completedAt: serverTimestamp(), updatedBy: actor("hk1", "housekeepingStaff") }));
    await assertSucceeds(updateDoc(ref, { status: "inProgress", startedAt: serverTimestamp(), updatedBy: actor("hk1", "housekeepingStaff") }));
  });

  it("cannot touch someone else's task", async () => {
    await assertFails(updateDoc(doc(hk(), `hotels/${H}/tasks/t-other`), {
      status: "inProgress", startedAt: serverTimestamp(), updatedBy: actor("hk1", "housekeepingStaff"),
    }));
  });

  it("follows the room cleaning workflow only", async () => {
    const stamp = { updatedBy: actor("hk1", "housekeepingStaff"), updatedAt: serverTimestamp() };
    await assertSucceeds(updateDoc(doc(hk(), `hotels/${H}/rooms/room-101`), {
      status: "cleaningInProgress", previousStatus: "vacantDirty", ...stamp,
    }));
    await assertFails(updateDoc(doc(hk(), `hotels/${H}/rooms/room-102`), {
      status: "occupied", previousStatus: "vacantClean", ...stamp,
    }));
  });

  it("cannot read energy data or the audit log", async () => {
    await assertFails(getDocs(collection(hk(), `hotels/${H}/energyReadings`)));
    await assertFails(getDocs(collection(hk(), `hotels/${H}/auditLogs`)));
  });

  it("may clear only their temporary-password flag", async () => {
    await assertSucceeds(updateDoc(doc(hk(), "users/hk1"), { mustChangePassword: false }));
    await assertFails(updateDoc(doc(hk(), "users/hk1"), { role: "generalManager" }));
  });
});

describe("reception", () => {
  it("checks a guest out (occupied → vacantDirty) but cannot mark rooms clean", async () => {
    const fo = as("fo1", "receptionStaff");
    const stamp = { updatedBy: actor("fo1", "receptionStaff"), updatedAt: serverTimestamp() };
    await assertSucceeds(updateDoc(doc(fo, `hotels/${H}/rooms/room-103`), {
      status: "vacantDirty", previousStatus: "occupied", ...stamp,
    }));
    await assertFails(updateDoc(doc(fo, `hotels/${H}/rooms/room-101`), {
      status: "vacantClean", previousStatus: "vacantDirty", ...stamp,
    }));
  });
});

describe("maintenance", () => {
  it("staff report faults only in their own name", async () => {
    const hk = as("hk1", "housekeepingStaff");
    const base = {
      title: "AC not cooling", description: "", category: "hvac", priority: "medium", status: "open",
      photoPaths: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(hk, `hotels/${H}/maintenanceTickets/new1`), { ...base, reportedById: "hk1" }));
    await assertFails(setDoc(doc(hk, `hotels/${H}/maintenanceTickets/new2`), { ...base, reportedById: "gm" }));
    await assertFails(setDoc(doc(hk, `hotels/${H}/maintenanceTickets/new3`), { ...base, reportedById: "hk1", assigneeId: "hk1" }));
  });

  it("staff read their own tickets, not others'", async () => {
    const hk = as("hk1", "housekeepingStaff");
    await assertSucceeds(getDoc(doc(hk, `hotels/${H}/maintenanceTickets/mt-hk1`)));
    await assertFails(getDoc(doc(hk, `hotels/${H}/maintenanceTickets/mt-other`)));
  });

  it("ticket + first timeline event are created atomically; timeline is private and immutable", async () => {
    const hk = as("hk1", "housekeepingStaff");
    const batch = writeBatch(hk);
    const t = doc(collection(hk, `hotels/${H}/maintenanceTickets`));
    batch.set(t, {
      title: "Broken lamp", description: "", category: "electrical", priority: "low", status: "open",
      reportedById: "hk1", photoPaths: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    const ev = doc(collection(hk, `hotels/${H}/maintenanceTickets/${t.id}/events`));
    batch.set(ev, { type: "created", actor: actor("hk1", "housekeepingStaff"), actorName: "hk1", at: serverTimestamp() });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDocs(collection(hk, `hotels/${H}/maintenanceTickets/${t.id}/events`)));
    await assertFails(updateDoc(ev, { type: "comment" }));
    await assertFails(getDocs(collection(as("fo1", "receptionStaff"), `hotels/${H}/maintenanceTickets/${t.id}/events`)));
  });

  it("the app's 'my tickets' queries are permitted", async () => {
    const hk = as("hk1", "housekeepingStaff");
    const col = collection(hk, `hotels/${H}/maintenanceTickets`);
    await assertSucceeds(getDocs(query(col, where("reportedById", "==", "hk1"))));
    await assertSucceeds(getDocs(query(col, where("assigneeId", "==", "hk1"))));
    await assertFails(getDocs(col));
  });

  it("technicians progress assigned tickets but cannot re-prioritise", async () => {
    const tech = as("tech1", "maintenanceStaff");
    const ref = doc(tech, `hotels/${H}/maintenanceTickets/mt-hk1`);
    await assertSucceeds(updateDoc(ref, { status: "inProgress", updatedBy: actor("tech1", "maintenanceStaff"), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { priority: "low", updatedBy: actor("tech1", "maintenanceStaff") }));
  });
});

describe("energy", () => {
  it("energy manager records valid readings with matching ids", async () => {
    const em = as("em", "energyManager");
    const reading = {
      type: "electricity", unit: "kWh", day: "2026-10-04", consumption: 2500, source: "manual",
      recordedBy: actor("em", "energyManager"), recordedByName: "em", createdAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(em, `hotels/${H}/energyReadings/2026-10-04_electricity`), reading));
    await assertFails(setDoc(doc(em, `hotels/${H}/energyReadings/2026-10-04_water`), reading));
    await assertFails(setDoc(doc(em, `hotels/${H}/energyReadings/2026-10-03_electricity`), { ...reading, day: "2026-10-03", consumption: -5 }));
  });
});

describe("inventory ledger", () => {
  it("quantity changes only with a matching movement in the same batch", async () => {
    const im = as("im", "inventoryManager");
    await assertFails(updateDoc(doc(im, `hotels/${H}/inventoryItems/inv-1`), { quantity: 999 }));

    const batch = writeBatch(im);
    const mv = doc(collection(im, `hotels/${H}/inventoryMovements`));
    batch.set(mv, {
      itemId: "inv-1", itemName: "Soap", type: "issue", delta: -4, quantityBefore: 10, quantityAfter: 6,
      actor: actor("im", "inventoryManager"), actorName: "im", createdAt: serverTimestamp(),
    });
    batch.update(doc(im, `hotels/${H}/inventoryItems/inv-1`), {
      quantity: 6, lastMovementId: mv.id, updatedAt: serverTimestamp(), updatedBy: actor("im", "inventoryManager"),
    });
    await assertSucceeds(batch.commit());
    await assertFails(updateDoc(mv, { delta: -1 }));
  });
});

describe("alerts & server-only data", () => {
  it("the app's audience query for alerts is permitted", async () => {
    const em = as("em", "energyManager");
    await assertSucceeds(getDocs(query(collection(em, `hotels/${H}/alerts`), where("audienceRoles", "array-contains", "energyManager"))));
  });

  it("only the audience reads alerts; nobody creates them from the client", async () => {
    await assertSucceeds(getDoc(doc(as("em", "energyManager"), `hotels/${H}/alerts/al-1`)));
    await assertFails(getDoc(doc(as("hk1", "housekeepingStaff"), `hotels/${H}/alerts/al-1`)));
    await assertFails(addDoc(collection(as("gm", "generalManager"), `hotels/${H}/alerts`), { title: "fake" }));
  });

  it("audit log, metrics and members are read-only for clients", async () => {
    const gm = as("gm", "generalManager");
    await assertSucceeds(getDocs(collection(gm, `hotels/${H}/auditLogs`)));
    await assertFails(addDoc(collection(gm, `hotels/${H}/auditLogs`), { action: "x" }));
    await assertFails(setDoc(doc(gm, `hotels/${H}/dailyMetrics/2026-10-04`), { x: 1 }));
    await assertFails(setDoc(doc(gm, `hotels/${H}/members/someone`), { role: "superAdmin" }));
  });
});
