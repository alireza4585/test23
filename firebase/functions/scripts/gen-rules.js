// Regenerates the RBAC block of ../firestore.rules from src/domain/rbac.ts.
// Usage: npm run gen:rules   (builds first)
const fs = require("node:fs");
const path = require("node:path");
const { injectRbacBlock } = require("../lib/domain/rules-gen.js");

const file = path.join(__dirname, "..", "..", "firestore.rules");
const before = fs.readFileSync(file, "utf8");
const after = injectRbacBlock(before);
if (after !== before) {
  fs.writeFileSync(file, after);
  console.log("firestore.rules RBAC block updated");
} else {
  console.log("firestore.rules RBAC block already up to date");
}
