import { describe, expect, it } from "vitest";

import { isValidNationalId, maskNationalId, normalizeNationalId } from "../../src/domain/national-id";
import { sign, verify } from "../../src/lib/signature";

describe("national ID", () => {
  it("validates checksums (incl. Persian digits)", () => {
    expect(isValidNationalId("0012345679")).toBe(true);
    expect(isValidNationalId("۰۰۱۲۳۴۵۶۷۹")).toBe(true);
    expect(isValidNationalId("0012345678")).toBe(false);
    expect(isValidNationalId("1111111111")).toBe(false);
  });
  it("normalizes and masks", () => {
    expect(normalizeNationalId("001-234567-9")).toBe("0012345679");
    expect(maskNationalId("0012345679")).toBe("001•••••79");
  });
});

describe("HMAC request signing", () => {
  const secret = "s3cret";
  const body = JSON.stringify({ a: 1 });
  it("accepts a fresh, correct signature", () => {
    const ts = 1_800_000_000;
    expect(verify(secret, String(ts), sign(secret, ts, body), body, ts + 10)).toBe(true);
  });
  it("rejects tampering, wrong secret and replays", () => {
    const ts = 1_800_000_000;
    const sig = sign(secret, ts, body);
    expect(verify(secret, String(ts), sig, body + " ", ts)).toBe(false);
    expect(verify("other", String(ts), sig, body, ts)).toBe(false);
    expect(verify(secret, String(ts), sig, body, ts + 3600)).toBe(false);
    expect(verify(secret, undefined, sig, body, ts)).toBe(false);
  });
});
