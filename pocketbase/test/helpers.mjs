import { createHmac } from "node:crypto";
import PocketBase from "pocketbase";
import { inject } from "vitest";

import { PASSWORD } from "../scripts/seed.mjs";
import { SECRET, SUPERUSER } from "./global-setup.mjs";

export const url = () => inject("pbUrl");
export const hotelId = () => inject("hotelId");

export const NID = {
  superAdmin: "0157891232",
  owner: "0023456787",
  gm: "0012345679",
  ops: "0034567895",
  energy: "0045678911",
  maintenanceManager: "0056789122",
  housekeepingManager: "0067891233",
  inventory: "0078912342",
  hr: "0089123451",
  reception: "0091234565",
  housekeeper: "0102345678",
  housekeeper2: "0113456786",
  technician: "0124567894",
  restaurantManager: "0135678919",
  restaurantStaff: "0168912341",
  analyst: "0146789121",
};

export function client() {
  const pb = new PocketBase(url());
  pb.autoCancellation(false);
  return pb;
}

export async function login(nationalId, password = PASSWORD) {
  const pb = client();
  await pb.collection("users").authWithPassword(nationalId, password);
  return pb;
}

export async function superuser() {
  const pb = client();
  await pb.collection("_superusers").authWithPassword(SUPERUSER.email, SUPERUSER.password);
  return pb;
}

export const post = (pb, path, body) => pb.send(path, { method: "POST", body });

/** Machine-readable error code of a rejected request. */
export async function errorOf(promise) {
  try {
    await promise;
  } catch (err) {
    return { status: err.status, code: err.response?.data?.code?.code ?? null, data: err.response?.data ?? {} };
  }
  throw new Error("expected the request to be rejected");
}

export const roomByNumber = async (pb, number) =>
  pb.collection("rooms").getFirstListItem(`number = "${number}"`);

/** Signed request to the integration API (as n8n would send it). */
export async function signed(path, { method = "GET", body, secret = SECRET, timestamp } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const res = await fetch(`${url()}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-zarin-timestamp": String(ts), "x-zarin-signature": sig },
    body: raw || undefined,
  });
  return { status: res.status, json: await res.json() };
}
