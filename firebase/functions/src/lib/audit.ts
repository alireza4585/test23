import { db, FieldValue, paths } from "./admin";

export interface AuditEntry {
  action: string;
  resource: { collection: string; id: string };
  actor: {
    uid: string;
    role?: string | null;
    name?: string | null;
    type: "user" | "system" | "integration";
  };
  changes?: Record<string, { from: unknown; to: unknown }>;
  source: "client" | "function" | "n8n" | "iot";
}

/** Append-only audit log. Clients can read (with `audit.view`) but never write. */
export async function writeAudit(hotelId: string, entry: AuditEntry): Promise<void> {
  await db.collection(paths.audit(hotelId)).add({
    ...entry,
    at: FieldValue.serverTimestamp(),
  });
}

/** Shallow diff of two documents, ignoring bookkeeping fields. */
export function diff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): Record<string, { from: unknown; to: unknown }> {
  const ignored = new Set(["updatedAt", "updatedBy", "createdAt"]);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (ignored.has(k)) continue;
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}
