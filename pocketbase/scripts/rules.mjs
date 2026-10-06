// Input rules shared by the admin scripts, with messages a person can act on.
// They match what the server enforces (pb_hooks/lib/zarin.js validPassword).
import { createRequire } from "node:module";

export const core = createRequire(import.meta.url)("../pb_hooks/lib/core.js");

/** Iranian national ID: 10 digits (Persian digits accepted), last one a check digit. */
export function nationalIdError(input) {
  if (!/^\d{10}$/.test(core.normalizeNationalId(input))) return "A national ID has exactly 10 digits.";
  if (!core.isValidNationalId(input)) {
    return "Not a valid national ID: the last digit is a check digit computed from the first nine, so a mistyped or made-up number is rejected.";
  }
  return undefined;
}

export function passwordError(input) {
  if (input.length < 8) return "Use at least 8 characters.";
  if (!/[A-Za-z]/.test(input) || !/\d/.test(input)) return "Use at least one English letter and at least one digit.";
  return undefined;
}

export function wholeNumberError(input, { max } = {}) {
  if (!/^\d+$/.test(input)) return "Enter a whole number.";
  if (max !== undefined && Number(input) > max) return `Enter a number from 0 to ${max}.`;
  return undefined;
}
