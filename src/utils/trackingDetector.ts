export type TrackingCarrier = "UPS" | "FedEx" | "USPS" | "DHL" | "Flight";

export interface PackageTrackingItem {
  carrier: TrackingCarrier;
  trackingNumber: string;
  trackingUrl: string;
  label?: string;
}

export function detectShipmentsAndFlights(text?: string | null): PackageTrackingItem[] {
  if (!text) return [];

  const items: PackageTrackingItem[] = [];
  const seenNumbers = new Set<string>();

  // 1. UPS: 1Z followed by 16 alphanumeric chars
  const upsRegex = /\b(1Z[0-9A-Z]{16})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = upsRegex.exec(text)) !== null) {
    const num = match[1]!.toUpperCase();
    if (!seenNumbers.has(num)) {
      seenNumbers.add(num);
      items.push({
        carrier: "UPS",
        trackingNumber: num,
        trackingUrl: `https://www.ups.com/track?tracknum=${num}`,
        label: "UPS Shipment",
      });
    }
  }

  // 2. FedEx: 12 or 15 digits (or 96 + 20 digits), typically preceded by or in proximity to FedEx/tracking
  const fedexRegex = /\b(96\d{20}|\d{12}|\d{15})\b/g;
  const hasFedexKeyword = /fedex/i.test(text);
  if (hasFedexKeyword) {
    while ((match = fedexRegex.exec(text)) !== null) {
      const num = match[1]!;
      if (!seenNumbers.has(num)) {
        seenNumbers.add(num);
        items.push({
          carrier: "FedEx",
          trackingNumber: num,
          trackingUrl: `https://www.fedex.com/fedextrack/?trknbr=${num}`,
          label: "FedEx Package",
        });
      }
    }
  }

  // 3. USPS: 20-22 digits starting with 92/93/94 or 2 letters + 9 digits + 2 letters
  const uspsRegex = /\b(9[234]\d{20}|9[234]\d{18}|[A-Z]{2}\d{9}US)\b/gi;
  while ((match = uspsRegex.exec(text)) !== null) {
    const num = match[1]!.toUpperCase();
    if (!seenNumbers.has(num)) {
      seenNumbers.add(num);
      items.push({
        carrier: "USPS",
        trackingNumber: num,
        trackingUrl: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`,
        label: "USPS Package",
      });
    }
  }

  // 4. DHL: 10 digits when DHL is mentioned
  if (/dhl/i.test(text)) {
    const dhlRegex = /\b(\d{10})\b/g;
    while ((match = dhlRegex.exec(text)) !== null) {
      const num = match[1]!;
      if (!seenNumbers.has(num)) {
        seenNumbers.add(num);
        items.push({
          carrier: "DHL",
          trackingNumber: num,
          trackingUrl: `https://www.dhl.com/en/express/tracking.html?AWB=${num}`,
          label: "DHL Express",
        });
      }
    }
  }

  // 5. Airline reservation confirmation / PNR (6 alphanumeric uppercase chars)
  const flightPnrRegex = /(?:confirmation|record locator|booking reference)\s*(?:code|number|#)?[:\s]+([A-Z0-9]{6})\b/i;
  const pnrMatch = text.match(flightPnrRegex);
  if (pnrMatch && pnrMatch[1]) {
    const code = pnrMatch[1].toUpperCase();
    if (!seenNumbers.has(code)) {
      seenNumbers.add(code);
      items.push({
        carrier: "Flight",
        trackingNumber: code,
        trackingUrl: `https://www.google.com/search?q=${encodeURIComponent("flight " + code)}`,
        label: "Flight Confirmation",
      });
    }
  }

  return items;
}
