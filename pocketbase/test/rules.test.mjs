import { describe, expect, it } from "vitest";

import { nationalIdError, passwordError, wholeNumberError } from "../scripts/rules.mjs";

/** A valid national ID from 9 digits (Iranian check-digit rule). */
function nationalId(nine) {
  const sum = [...nine].reduce((s, d, i) => s + Number(d) * (10 - i), 0) % 11;
  return `${nine}${sum < 2 ? sum : 11 - sum}`;
}
const toPersian = (s) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

describe("admin script input rules", () => {
  it("accepts a national ID only with a valid check digit", () => {
    const valid = nationalId("481203957");
    expect(nationalIdError(valid)).toBeUndefined();
    expect(nationalIdError(toPersian(valid))).toBeUndefined();
    const wrong = `${valid.slice(0, 9)}${(Number(valid[9]) + 1) % 10}`;
    expect(nationalIdError(wrong)).toMatch(/check digit/);
    expect(nationalIdError("123456789")).toMatch(/exactly 10 digits/);
    expect(nationalIdError("1111111111")).toMatch(/check digit/);
  });

  it("matches the server's password rule", () => {
    expect(passwordError("short1")).toMatch(/at least 8/);
    expect(passwordError("onlyletters")).toMatch(/letter and at least one digit/);
    expect(passwordError("12345678")).toMatch(/letter and at least one digit/);
    expect(passwordError("Welcome2026")).toBeUndefined();
  });

  it("checks whole numbers and their range", () => {
    expect(wholeNumberError("80")).toBeUndefined();
    expect(wholeNumberError("8.5")).toMatch(/whole number/);
    expect(wholeNumberError("9", { max: 7 })).toMatch(/0 to 7/);
  });
});
