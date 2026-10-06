import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { resetHotel } from "../scripts/reset-demo.mjs";
import { SUPERUSER } from "./global-setup.mjs";
import { hotelId, superuser, url } from "./helpers.mjs";

const core = createRequire(import.meta.url)("../pb_hooks/lib/core.js");

/** A valid national ID from 9 digits (Iranian check-digit rule). */
function nationalId(nine) {
  const sum = [...nine].reduce((s, d, i) => s + Number(d) * (10 - i), 0) % 11;
  const id = `${nine}${sum < 2 ? sum : 11 - sum}`;
  if (!core.isValidNationalId(id)) throw new Error(`bad test id ${id}`);
  return id;
}

describe("reset-demo script", () => {
  it("removes a hotel, its data and its own users, and nothing else", async () => {
    const su = await superuser();
    const tmp = await su.collection("hotels").create({ name: "هتل آزمایشی", timezone: "Asia/Tehran", currency: "IRR", status: "active", settings: {} });
    const user = (nine, hotels, role) => su.collection("users").create({
      nationalId: nationalId(nine), fullName: `کاربر ${nine}`, role, hotels, primaryHotel: hotels[0], status: "active",
      password: "Reset-2026a", passwordConfirm: "Reset-2026a",
    });
    const only = await user("900000001", [tmp.id], "generalManager");
    const both = await user("900000002", [tmp.id, hotelId()], "analyst");
    // Like the seed's superAdmin: in no hotel, removed by national ID.
    const loner = await user("900000003", [], "superAdmin");
    await su.collection("rooms").create({ hotel: tmp.id, number: "T101", floor: 1, type: "double", status: "vacantClean" });
    const usersBefore = (await su.collection("users").getList(1, 1)).totalItems;
    const seededRooms = async () => (await su.collection("rooms").getList(1, 1, { filter: `hotel = "${hotelId()}"` })).totalItems;
    const roomsBefore = await seededRooms();
    const options = {
      url: url(), email: SUPERUSER.email, password: SUPERUSER.password, hotelId: tmp.id, log: () => {},
      accounts: [nationalId("900000003")],
    };

    const plan = await resetHotel(options);
    expect(plan).toMatchObject({ found: true, users: 2, deleted: false });
    expect(plan.counts.rooms).toBe(1);
    expect((await su.collection("hotels").getOne(tmp.id)).id).toBe(tmp.id);

    expect(await resetHotel({ ...options, apply: true })).toMatchObject({ deleted: true, users: 2 });
    await expect(su.collection("hotels").getOne(tmp.id)).rejects.toMatchObject({ status: 404 });
    await expect(su.collection("users").getOne(only.id)).rejects.toMatchObject({ status: 404 });
    await expect(su.collection("users").getOne(loner.id)).rejects.toMatchObject({ status: 404 });
    expect((await su.collection("rooms").getList(1, 1, { filter: `hotel = "${tmp.id}"` })).totalItems).toBe(0);
    const kept = await su.collection("users").getOne(both.id);
    expect(kept.hotels).toEqual([hotelId()]);
    expect((await su.collection("users").getList(1, 1)).totalItems).toBe(usersBefore - 2);
    // The seeded hotel and its data are untouched.
    expect(await seededRooms()).toBe(roomsBefore);
    // The deletion itself is audited at platform level.
    const log = await su.collection("auditLogs").getFirstListItem(`action = "hotels.delete" && resourceId = "${tmp.id}"`);
    expect(log.hotel).toBe("");

    expect(await resetHotel(options)).toEqual({ found: false });
  });
});
