/** Iranian national ID (کد ملی) validation — mirrors `iran_national_id.dart`. */

const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC = "٠١٢٣٤٥٦٧٨٩";

export function normalizeNationalId(input: string): string {
  let out = "";
  for (const ch of input) {
    if (ch.trim() === "" || ch === "-") continue;
    const p = PERSIAN.indexOf(ch);
    const a = ARABIC.indexOf(ch);
    out += p >= 0 ? String(p) : a >= 0 ? String(a) : ch;
  }
  return out;
}

export function isValidNationalId(input: string): boolean {
  const v = normalizeNationalId(input);
  if (!/^\d{10}$/.test(v) || /^(\d)\1{9}$/.test(v)) return false;
  const digits = [...v].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += digits[i] * (10 - i);
  const r = sum % 11;
  return (r < 2 ? r : 11 - r) === digits[9];
}

export function maskNationalId(input: string): string {
  const v = normalizeNationalId(input);
  return v.length === 10 ? `${v.slice(0, 3)}•••••${v.slice(8)}` : v;
}

/** Synthetic Firebase Auth e-mail for a national ID (never shown to users). */
export function authEmailFor(nationalId: string, domain: string): string {
  return `${normalizeNationalId(nationalId)}@${domain}`;
}
