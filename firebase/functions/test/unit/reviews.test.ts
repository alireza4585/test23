import { describe, expect, it } from "vitest";

import {
  canonicalUrl, firstLink, guessPlatform, matchMention, normalizeText, parseCsv, parseDay, ratingTo5,
  readImport, redactText, sanitizeText, textSimilarity, type ProfileForMatch,
} from "../../src/analytics/reviews";

// Two fictional hotels with the same brand in different cities, and a third one.
const A: ProfileForMatch = {
  hotelId: "hotelA", names: ["هتل نیلوفر کویر", "Niloofar Kavir Hotel"], aliases: ["نیلوفر کویر", "niloufar kavir"],
  cities: ["یزد", "yazd"], negativeKeywords: ["کرمان", "kerman"],
  listings: [{ platform: "booking", url: "https://www.booking.com/hotel/ir/niloofar-kavir-yazd.html", externalId: "bk-111" }],
};
const B: ProfileForMatch = {
  hotelId: "hotelB", names: ["هتل نیلوفر کویر کرمان", "Niloofar Kavir Kerman"], aliases: ["نیلوفر کویر"],
  cities: ["کرمان", "kerman"], negativeKeywords: ["یزد", "yazd"], listings: [],
};
const C: ProfileForMatch = { hotelId: "hotelC", names: ["هتل سپیدار ساحل"], aliases: ["سپیدار"], cities: ["بندرعباس"], negativeKeywords: [], listings: [] };

describe("text", () => {
  it("normalises Arabic letters, digits, joiners and diacritics for matching", () => {
    expect(normalizeText("هتلِ نيلوفر‌كوير ۱۲")).toBe("هتل نیلوفر کویر 12");
    expect(normalizeText("Niloufar  KAVIR!")).toBe("niloufar kavir");
  });

  it("redacts phone numbers, national IDs, e-mails, handles and links", () => {
    const out = redactText("call 0912 345 6789 or +98 21 22334455, mail a.b@example.com, @guest_99, id 001-234567-8, see https://x.example/p?q=1 ۰۹۱۲۳۴۵۶۷۸۹");
    expect(out).not.toMatch(/0912|22334455|example\.com|guest_99|001-234567-8|x\.example|09123456789/);
    expect(out).toContain("[phone]");
    expect(out).toContain("[email]");
    expect(out).toContain("[handle]");
    expect(out).toContain("[id]");
    expect(out).toContain("[link]");
    // Dates and prices stay.
    expect(redactText("از 2026-10-05 تا 2026-10-07، 2500000 تومان")).toBe("از 2026-10-05 تا 2026-10-07، 2500000 تومان");
  });

  it("sanitises: keeps line breaks, drops control/bidi characters and markup", () => {
    expect(sanitizeText("خوب‮<b>بود</b>\r\n\r\n\r\nعالی\u0007")).toBe("خوب b بود /b\n\nعالی");
  });
});

describe("ratings", () => {
  it("maps any scale linearly to 1–5", () => {
    expect(ratingTo5(10, 1, 10)).toBe(5);
    expect(ratingTo5(1, 1, 10)).toBe(1);
    expect(ratingTo5(5.5, 1, 10)).toBe(3);
    expect(ratingTo5(4, 1, 5)).toBe(4);
    expect(ratingTo5(11, 1, 10)).toBeNull();
    expect(ratingTo5(null, 1, 5)).toBeNull();
  });
});

describe("matching", () => {
  const all = [A, B, C];

  it("a confirmed listing decides", () => {
    const r = matchMention({ text: "عالی", url: "https://booking.com/hotel/ir/niloofar-kavir-yazd.html?aid=3" }, all);
    expect(r).toMatchObject({ hotelId: "hotelA", status: "accepted", reasons: ["listing"] });
  });

  it("name + city is accepted; the confusable hotel's negative keyword keeps it out", () => {
    expect(matchMention({ text: "اقامت در هتل نیلوفر کویر یزد عالی بود" }, all)).toMatchObject({ hotelId: "hotelA", status: "accepted" });
    expect(matchMention({ text: "هتل نیلوفر کویر کرمان صبحانهٔ خوبی داشت" }, all)).toMatchObject({ hotelId: "hotelB", status: "accepted" });
  });

  it("the shared brand name without a city is ambiguous: needs review", () => {
    const r = matchMention({ text: "نیلوفر کویر تمیز بود" }, all);
    expect(r.status).toBe("needsReview");
    expect(r.candidates.map((c) => c.hotelId).sort()).toEqual(["hotelA", "hotelB"]);
  });

  it("no name: unmatched", () => {
    expect(matchMention({ text: "اتاق تمیز بود" }, all)).toMatchObject({ hotelId: null, status: "unmatched" });
  });

  it("with the hotel as context: accepted, unless another hotel clearly fits better", () => {
    expect(matchMention({ text: "اتاق تمیز بود" }, all, "hotelC")).toMatchObject({ hotelId: "hotelC", status: "accepted" });
    expect(matchMention({ text: "هتل نیلوفر کویر کرمان بد بود" }, all, "hotelC")).toMatchObject({ hotelId: "hotelC", status: "needsReview" });
    // The context hotel's own negative keyword (the other city) also asks for review.
    expect(matchMention({ text: "در کرمان، هتل نیلوفر کویر" }, all, "hotelA").status).toBe("needsReview");
  });
});

describe("duplicates", () => {
  it("near-identical texts score high, different ones low", () => {
    expect(textSimilarity("صبحانه عالی بود و کارکنان مهربان بودند", "صبحانه عالی بود، و کارکنان مهربان بودند!")).toBeGreaterThanOrEqual(0.9);
    expect(textSimilarity("صبحانه عالی بود", "اتاق سرد بود و صدای خیابان زیاد")).toBeLessThan(0.2);
  });
});

describe("CSV and links", () => {
  it("parses quotes, commas and line breaks inside fields", () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2 ""q"""\n')).toEqual([["a", "b"], ["x, y", 'line1\nline2 "q"']]);
  });

  it("reads the generic import format with English or Persian headers", () => {
    const { rows, errors, columns } = readImport("شناسه,تاریخ,امتیاز,از,متن,لینک\nr1,۱۴۰۵/۰۸/۲۸,۹,10,عالی,https://example.org/r1\nr2,2026-11-01,,,,\nr3,bad,8,10,خوب,\n");
    expect(columns).toEqual(expect.arrayContaining(["externalId", "postedAt", "rating", "scaleMax", "text", "url"]));
    expect(rows).toEqual([expect.objectContaining({ externalId: "r1", rating: 9, scaleMax: 10, text: "عالی" })]);
    expect(errors.map((e) => e.reason)).toEqual(["no_text_or_rating", "bad_date"]);
    expect(parseDay("19/11/2026")).toBe("2026-11-19");
  });

  it("guesses the platform from a shared link", () => {
    expect(guessPlatform("https://www.instagram.com/p/abc/")).toBe("instagram");
    expect(guessPlatform("https://maps.app.goo.gl/xyz")).toBe("google");
    expect(guessPlatform("https://www.google.com/maps/place/x")).toBe("google");
    expect(guessPlatform("https://www.google.com/search?q=x")).toBe("other");
    expect(guessPlatform("https://t.me/somechannel/12")).toBe("telegram");
    expect(guessPlatform("https://www.booking.com/hotel/ir/x.html")).toBe("booking");
    expect(guessPlatform(null)).toBe("other");
    expect(firstLink("این نظر را ببین: https://t.me/c/1/2، ممنون")).toBe("https://t.me/c/1/2");
    expect(canonicalUrl("HTTPS://www.Booking.com/hotel/x.html/?a=1#r")).toBe("booking.com/hotel/x.html");
  });
});
