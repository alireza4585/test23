// Prints an accounts file for the local test server (npm run test-server),
// built from the demo seed at run time. Write it outside the repository:
//   node ai-worker/eval/local-accounts.mjs > "$TMPDIR/zarin-eval-accounts.json"
import { ACCOUNTS, PASSWORD } from "../../pocketbase/scripts/seed.mjs";

const roles = ["generalManager", "energyManager", "operationsManager", "analyst", "hotelOwner"];
const out = {};
for (const [nationalId, role] of ACCOUNTS) if (roles.includes(role) && !out[role]) out[role] = { nationalId, password: PASSWORD };
console.log(JSON.stringify(out, null, 2));
