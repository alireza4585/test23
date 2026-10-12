import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 request signing shared with n8n (both directions):
 *   x-zarin-timestamp: <unix seconds>
 *   x-zarin-signature: hex(HMAC(secret, `${timestamp}.${rawBody}`))
 * A 5-minute window prevents replay.
 */
export const SIGNATURE_HEADER = "x-zarin-signature";
export const TIMESTAMP_HEADER = "x-zarin-timestamp";
const MAX_SKEW_SECONDS = 300;

export function sign(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verify(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !timestampHeader || !signatureHeader) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) {
    return false;
  }
  const expected = Buffer.from(sign(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(signatureHeader, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
