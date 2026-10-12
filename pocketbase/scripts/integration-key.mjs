// Creates or revokes a scoped integration key (AI phase 0, v2 signing).
//
//   npm run integration-key                    # create: asks for label and hotel ids
//   npm run integration-key -- revoke <keyId>  # revoke
//
// The key's secret is printed once, here, in your terminal: copy it straight
// into the service that signs with it (e.g. the AI worker's ZH_WORKER_SECRET
// on Liara) and never into chat, tickets or the repository. The server keeps
// only an encrypted copy (ZH_SECRETS_KEY must be set on PocketBase).
//
// Values can come from the environment instead of prompts: ZH_PB_URL,
// ZH_PB_SUPERUSER_EMAIL / ZH_PB_SUPERUSER_PASSWORD, KEY_LABEL, KEY_HOTEL_IDS
// (comma-separated).
import PocketBase from "pocketbase";

import { confirmed, interactive, serverUrl, superuserLogin, value } from "./prompt.mjs";

const [mode = "create", keyId] = process.argv.slice(2);

try {
  const url = await serverUrl();
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  await superuserLogin(pb);

  if (mode === "revoke") {
    if (!keyId) throw new Error("usage: npm run integration-key -- revoke <keyId>");
    const res = await pb.send(`/api/zarin/admin/integration-keys/${encodeURIComponent(keyId)}/revoke`, { method: "POST" });
    console.log(`Key ${res.keyId} revoked.`);
    process.exit(0);
  }
  if (mode !== "create") throw new Error(`unknown mode "${mode}" (create | revoke <keyId>)`);

  const label = await value("KEY_LABEL", { question: "Label (e.g. ai-worker, n8n): " });
  const hotels = (await value("KEY_HOTEL_IDS", {
    question: "Hotel ids this key may access (comma-separated): ",
    validate: async (v) => {
      for (const id of v.split(",").map((s) => s.trim()).filter(Boolean)) {
        try {
          await pb.collection("hotels").getOne(id, { fields: "id" });
        } catch {
          return `No hotel with id ${id} on this server.`;
        }
      }
      return undefined;
    },
  })).split(",").map((s) => s.trim()).filter(Boolean);

  if (interactive() && !(await confirmed(`Create key «${label}» for ${hotels.length} hotel(s)? [y/N] `))) {
    console.log("Nothing was created.");
    process.exit(0);
  }
  const key = await pb.send("/api/zarin/admin/integration-keys", { method: "POST", body: { label, hotels } });
  console.log(`\nKey id:  ${key.keyId}`);
  console.log(`Secret:  ${key.secret}`);
  console.log("\nThe secret is shown only this once. Put it in the signing service's environment now.");
} catch (err) {
  console.error(err?.response?.data?.code?.code ?? err?.message ?? String(err));
  process.exit(1);
}
