/**
 * Guest reviews by e-mail (F10, R2): the pure parsing.
 *
 * A hotel forwards the review notifications it gets from review sites to its
 * own unguessable address (r-<token>@<platform mail domain>). n8n reads the
 * shared mailbox over IMAP and posts each mail to PocketBase, which parses it
 * here and drops the mail. Until per-site templates exist (they need real,
 * anonymised samples), the generic parser below extracts what it safely can
 * and every result waits for a person ("needs review"); a mail with nothing
 * usable waits too, as a short excerpt.
 */
import { guessPlatform } from "./reviews";

/** The inbound token from one of the mail's recipient addresses, or null. */
export function inboundToken(addresses: string[], domain?: string | null): string | null {
  for (const raw of addresses) {
    const m = /<?([^<>\s@]+)@([^<>\s@]+)>?\s*$/.exec(String(raw ?? "").trim().toLowerCase());
    if (!m) continue;
    if (domain && m[2] !== domain.toLowerCase()) continue;
    const local = m[1];
    const t = /^r-([a-z0-9]{16,64})$/.exec(local) || /^[a-z0-9._-]+\+([a-z0-9]{16,64})$/.exec(local);
    if (t) return t[1];
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", zwnj: "‌" };

/** Plain text of an HTML mail: scripts and styles dropped, blocks become lines, entities decoded. */
export function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    // Link targets matter (the review's link): keep them next to their text.
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, " $2 $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A mail provider's "confirm forwarding" message (not a review). Returns its confirmation link, or "" when it is one without a link. */
export function forwardingConfirmation(m: { from?: string | null; subject?: string | null; text: string }): string | null {
  const subject = String(m.subject ?? "");
  const from = String(m.from ?? "").toLowerCase();
  const looks = /forwarding[- ]confirmation|confirm (?:the )?forward|تأیید.{0,20}(?:هدایت|فوروارد|ارسال خودکار)/i.test(subject) ||
    /forwarding-noreply@google\.com/.test(from);
  if (!looks) return null;
  const link = /https?:\/\/[^\s<>"']*(?:mail\.google\.com|mail-settings\.google\.com|outlook\.|live\.com|yahoo\.)[^\s<>"']*/i.exec(m.text);
  return link ? link[0] : "";
}

const FORWARD_HEADER = /^-{2,}\s*(?:forwarded message|original message|پیام (?:هدایت|ارسال)\s*شده|پیام اصلی)\s*-{2,}$/i;
const HEADER_LINE = /^(?:from|to|cc|date|sent|subject|از|به|تاریخ|موضوع)\s*:/i;
const FOOTER = /unsubscribe|لغو اشتراک|privacy policy|حریم خصوصی|manage (?:your )?(?:email )?(?:preferences|notifications)|this (?:e-?mail|message) was sent|©|all rights reserved|کلیه حقوق/i;

/** The words of a forwarded notification without quoting, forwarding headers, signatures and footers. */
export function bodyOf(text: string): string {
  const out: string[] = [];
  let inHeader = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "-- " || line === "--") break; // signature
    if (FORWARD_HEADER.test(line)) { inHeader = true; continue; }
    if (inHeader) {
      if (HEADER_LINE.test(line)) continue;
      if (!line) { inHeader = false; continue; }
      inHeader = false;
    }
    if (line.startsWith(">")) continue;
    if (FOOTER.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const digits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** A rating written in the mail: "9/10", "8 از 10", "4.5 out of 5", or stars (★★★★☆). */
export function ratingIn(text: string): { raw: number; max: number } | null {
  const s = digits(text);
  const m = /(?:^|[^\d.])(\d{1,2}(?:[.,]\d)?)\s*(?:\/|از|out of|of)\s*(10|5)(?![\d])/i.exec(s);
  if (m) {
    const raw = Number(m[1].replace(",", "."));
    const max = Number(m[2]);
    if (raw >= 0 && raw <= max) return { raw, max };
  }
  const stars = /([★⭐]{1,5})(☆{0,4})/.exec(text);
  if (stars) return { raw: [...stars[1]].length, max: 5 };
  return null;
}

const SITE_HOSTS = /(booking\.com|google\.[a-z.]+|goo\.gl|tripadvisor\.[a-z.]+|expedia\.[a-z.]+|hotels\.com|instagram\.com|t\.me|snapptrip\.com|jabama\.com|eghamat24\.com|alibaba\.ir)/i;

export interface ParsedMail {
  /** generic: extracted, needs a person; unparsable: nothing usable (an excerpt waits for a person). */
  kind: "generic" | "unparsable";
  platform: string;
  url: string | null;
  text: string;
  title: string | null;
  rating: { raw: number; max: number } | null;
}

/**
 * The generic fallback for a forwarded review notification. It never decides
 * on its own: the result is stored for a person to confirm (needs review).
 */
export function parseGeneric(m: { from?: string | null; subject?: string | null; text?: string | null; html?: string | null }): ParsedMail {
  const full = m.text && m.text.trim() ? String(m.text) : htmlToText(String(m.html ?? ""));
  const body = bodyOf(full);
  const links = (body.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((l) => l.replace(/[).,،]+$/, ""));
  const url = links.find((l) => SITE_HOSTS.test(l.split("/")[2] ?? "")) ?? null;
  const fromDomain = (/@([a-z0-9.-]+)/i.exec(String(m.from ?? ""))?.[1] ?? "").toLowerCase();
  let platform = guessPlatform(url);
  if (platform === "other" && fromDomain) platform = guessPlatform(`https://${fromDomain}/`);
  const rating = ratingIn(`${m.subject ?? ""}\n${body}`);
  // Links are not review text; they are kept apart (the review's own link above).
  const text = body.replace(/https?:\/\/[^\s<>"']+/gi, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const title = m.subject ? String(m.subject).replace(/^\s*(?:(?:fwd?|fw|re|ارسال|پاسخ)\s*:\s*)+/i, "").trim().slice(0, 300) || null : null;
  return { kind: words >= 3 || rating ? "generic" : "unparsable", platform, url, text, title, rating };
}
