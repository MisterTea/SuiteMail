export interface ParsedVCard {
  fn: string | null;
  email: string | null;
  avatarUrl: string | null;
  phone: string | null;
  note: string | null;
}

/**
 * Parses raw vCard string (RFC 6350 / RFC 2426) into contact objects.
 * Supports multiple vCards concatenated in one payload.
 */
export function parseVCards(vcardData: string): ParsedVCard[] {
  const cards: ParsedVCard[] = [];
  const lines = vcardData.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Unfold folded lines (lines starting with space or tab)
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  let currentCard: ParsedVCard | null = null;

  for (const line of unfolded) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.toUpperCase() === "BEGIN:VCARD") {
      currentCard = {
        fn: null,
        email: null,
        avatarUrl: null,
        phone: null,
        note: null,
      };
      continue;
    }

    if (trimmed.toUpperCase() === "END:VCARD" && currentCard) {
      if (currentCard.email) {
        cards.push(currentCard);
      }
      currentCard = null;
      continue;
    }

    if (!currentCard) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const keyPart = trimmed.slice(0, colonIndex).toUpperCase();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (keyPart === "FN" || keyPart.startsWith("FN;")) {
      currentCard.fn = value;
    } else if (keyPart === "EMAIL" || keyPart.startsWith("EMAIL;")) {
      currentCard.email = value.toLowerCase();
    } else if (keyPart === "PHOTO" || keyPart.startsWith("PHOTO;")) {
      currentCard.avatarUrl = value;
    } else if (keyPart === "TEL" || keyPart.startsWith("TEL;")) {
      currentCard.phone = value;
    } else if (keyPart === "NOTE" || keyPart.startsWith("NOTE;")) {
      currentCard.note = value;
    }
  }

  return cards;
}

/**
 * Generates an RFC 2426 vCard 3.0 string.
 */
export function generateVCard(contact: {
  displayName: string | null;
  email: string;
  avatarUrl?: string | null;
  note?: string | null;
}): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${contact.displayName ?? contact.email}`,
    `EMAIL;TYPE=INTERNET:${contact.email}`,
  ];

  if (contact.avatarUrl) {
    lines.push(`PHOTO;VALUE=URI:${contact.avatarUrl}`);
  }
  if (contact.note) {
    lines.push(`NOTE:${contact.note}`);
  }

  lines.push("END:VCARD");
  return lines.join("\r\n");
}
