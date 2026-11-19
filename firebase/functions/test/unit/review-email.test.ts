import { describe, expect, it } from "vitest";

import { bodyOf, forwardingConfirmation, htmlToText, inboundToken, parseGeneric, ratingIn } from "../../src/analytics/review-email";

describe("inbound address", () => {
  it("finds the hotel's token in r-<token>@domain or name+<token>@domain, on the platform's domain only", () => {
    const t = "abcdefgh12345678xyz0";
    expect(inboundToken(["someone@else.org", `R-${t.toUpperCase()}@reviews.example.org`], "reviews.example.org")).toBe(t);
    expect(inboundToken([`Reviews <reviews+${t}@reviews.example.org>`], "reviews.example.org")).toBe(t);
    expect(inboundToken([`r-${t}@other.example.org`], "reviews.example.org")).toBeNull();
    expect(inboundToken(["r-short@reviews.example.org"], null)).toBeNull();
  });
});

describe("mail text", () => {
  it("HTML to text keeps link targets and decodes entities", () => {
    expect(htmlToText('<style>p{}</style><p>Room &amp; bed: <b>great</b></p><a href="https://www.booking.com/r/1">See review</a>&#1587;'))
      .toBe("Room & bed: great\nSee review https://www.booking.com/r/1 س");
  });

  it("drops forwarding headers, quoted lines, signatures and footers", () => {
    const text = "سلام\n---------- Forwarded message ---------\nFrom: Site <no-reply@booking.com>\nDate: Mon\nSubject: New review\n\nصبحانه سرد بود\n> quoted\nTo unsubscribe click here\n-- \nامضا";
    expect(bodyOf(text)).toBe("سلام\nصبحانه سرد بود");
  });

  it("ratings written in the mail", () => {
    expect(ratingIn("Score: 9/10")).toEqual({ raw: 9, max: 10 });
    expect(ratingIn("امتیاز ۸ از ۱۰")).toEqual({ raw: 8, max: 10 });
    expect(ratingIn("4.5 out of 5")).toEqual({ raw: 4.5, max: 5 });
    expect(ratingIn("★★★★☆")).toEqual({ raw: 4, max: 5 });
    expect(ratingIn("room 101, 2026/10/05")).toBeNull();
  });

  it("a forwarding confirmation is not a review", () => {
    expect(forwardingConfirmation({ from: "Gmail Team <forwarding-noreply@google.com>", subject: "(#123) Gmail Forwarding Confirmation", text: "click https://mail-settings.google.com/mail/vf-abc to confirm" }))
      .toBe("https://mail-settings.google.com/mail/vf-abc");
    expect(forwardingConfirmation({ from: "no-reply@booking.com", subject: "New review", text: "x" })).toBeNull();
  });
});

describe("generic parser", () => {
  it("extracts site, link, rating and text; never more", () => {
    const p = parseGeneric({
      from: "Booking.com <noreply@booking.com>", subject: "Fwd: A guest left a review",
      text: "Score 8/10\nThe breakfast was cold but the staff were kind.\nRead it: https://www.booking.com/reviews/abc.html\nUnsubscribe from these emails",
    });
    expect(p).toMatchObject({ kind: "generic", platform: "booking", url: "https://www.booking.com/reviews/abc.html", rating: { raw: 8, max: 10 }, title: "A guest left a review" });
    expect(p.text).toContain("breakfast was cold");
    expect(p.text).not.toMatch(/https?:|Unsubscribe/);
  });

  it("platform from the sender when the link says nothing; nothing usable → unparsable", () => {
    expect(parseGeneric({ from: "x@tripadvisor.com", text: "Your hotel got a new review, very nice stay" }).platform).toBe("tripadvisor");
    expect(parseGeneric({ subject: "hi", html: "<img src=x>" }).kind).toBe("unparsable");
  });
});
