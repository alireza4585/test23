// One seeded PocketBase for the whole Node test run.
import { SECRET, SUPERUSER, startTestServer } from "../scripts/test-server.mjs";

export { SECRET, SUPERUSER };

export default async function setup({ provide }) {
  const server = await startTestServer({ keepData: process.env.KEEP_PB_DATA === "1" });
  provide("pbUrl", server.url);
  provide("hotelId", server.hotelId);
  return server.stop;
}
