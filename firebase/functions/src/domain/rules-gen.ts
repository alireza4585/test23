import { PERMISSIONS, ROOM_TRANSITIONS, rolesWith } from "./rbac";

export const RBAC_BEGIN = "// <rbac:begin> generated from functions/src/domain/rbac.ts — run `npm run gen:rules`";
export const RBAC_END = "// <rbac:end>";

/**
 * Renders the RBAC section of `firestore.rules`: the permission → roles map
 * and the staff room-transition table, straight from `rbac.ts`.
 */
export function rulesRbacBlock(indent = "    "): string {
  const perms = PERMISSIONS.map(
    (p) => `${indent}    '${p}': [${rolesWith(p).map((r) => `'${r}'`).join(", ")}]`,
  ).join(",\n");
  const transitions = Object.entries(ROOM_TRANSITIONS)
    .map(([role, map]) => {
      const inner = Object.entries(map ?? {})
        .map(([from, to]) => `'${from}': [${to.map((t) => `'${t}'`).join(", ")}]`)
        .join(", ");
      return `${indent}    '${role}': {${inner}}`;
    })
    .join(",\n");
  return [
    `${indent}${RBAC_BEGIN}`,
    `${indent}function permRoles() {`,
    `${indent}  return {`,
    perms,
    `${indent}  };`,
    `${indent}}`,
    ``,
    `${indent}function roomTransitions() {`,
    `${indent}  return {`,
    transitions,
    `${indent}  };`,
    `${indent}}`,
    `${indent}${RBAC_END}`,
  ].join("\n");
}

/** Replaces the generated block inside a rules file's source. */
export function injectRbacBlock(rulesSource: string): string {
  const start = rulesSource.indexOf(RBAC_BEGIN);
  const end = rulesSource.indexOf(RBAC_END);
  if (start < 0 || end < 0) throw new Error("rbac markers not found in rules file");
  const lineStart = rulesSource.lastIndexOf("\n", start) + 1;
  const lineEnd = rulesSource.indexOf("\n", end);
  return rulesSource.slice(0, lineStart) + rulesRbacBlock() + rulesSource.slice(lineEnd);
}
