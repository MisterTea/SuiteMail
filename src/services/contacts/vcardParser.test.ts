import { describe, it, expect } from "vitest";
import { parseVCards, generateVCard } from "./vcardParser";

describe("vcardParser", () => {
  it("parses standard RFC 2426 / RFC 6350 vCards", () => {
    const raw = `BEGIN:VCARD
VERSION:3.0
FN:Alice Wonder
EMAIL;TYPE=INTERNET:alice@example.com
TEL;TYPE=WORK:+1-555-0100
NOTE:Engineer
END:VCARD`;

    const cards = parseVCards(raw);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.fn).toBe("Alice Wonder");
    expect(cards[0]?.email).toBe("alice@example.com");
    expect(cards[0]?.phone).toBe("+1-555-0100");
    expect(cards[0]?.note).toBe("Engineer");
  });

  it("handles multiple concatenated vCards and line unfolding", () => {
    const raw = `BEGIN:VCARD
VERSION:3.0
FN:Alice
EMAIL:alice@example.com
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Bob
 Long
EMAIL:bob@example.com
END:VCARD`;

    const cards = parseVCards(raw);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.email).toBe("alice@example.com");
    expect(cards[1]?.fn).toBe("BobLong");
    expect(cards[1]?.email).toBe("bob@example.com");
  });

  it("generates valid vCard 3.0 string", () => {
    const card = generateVCard({
      displayName: "Carol Danvers",
      email: "carol@marvel.com",
      note: "Captain",
    });

    expect(card).toContain("BEGIN:VCARD");
    expect(card).toContain("VERSION:3.0");
    expect(card).toContain("FN:Carol Danvers");
    expect(card).toContain("EMAIL;TYPE=INTERNET:carol@marvel.com");
    expect(card).toContain("NOTE:Captain");
    expect(card).toContain("END:VCARD");
  });
});
