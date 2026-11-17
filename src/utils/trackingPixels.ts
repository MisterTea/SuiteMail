export interface DetectedTracker {
  provider: string;
  url: string;
}

export interface TrackingAuditResult {
  hasTrackers: boolean;
  trackers: DetectedTracker[];
  sanitizedHtml: string;
}

const KNOWN_TRACKING_SERVICES: Array<{ name: string; pattern: RegExp }> = [
  { name: "Mailchimp", pattern: /mandrillapp\.com\/track|list-manage\.com\/track/i },
  { name: "Superhuman", pattern: /superhuman\.com\/track/i },
  { name: "HubSpot", pattern: /hubspot\.com|sidekickopen\.com|hsms06\.com|hs-analytics\.net/i },
  { name: "Mixmax", pattern: /mixmax\.com\/api\/track/i },
  { name: "Yesware", pattern: /yesware\.com/i },
  { name: "Streak", pattern: /mailfoogae\.appspot\.com|streak\.com/i },
  { name: "SendGrid", pattern: /sendgrid\.net\/wf\/open|ct\.sendgrid\.net/i },
  { name: "Mailgun", pattern: /email\.mailgun\.net|mailgun\.org\/tag/i },
  { name: "Salesforce / Pardot", pattern: /pardot\.com|exacttarget\.com/i },
  { name: "Marketo", pattern: /marketo\.com|mktoresp\.com/i },
  { name: "Klaviyo", pattern: /klaviyo\.com|trk\.klaviyo\.com/i },
  { name: "ActiveCampaign", pattern: /activehosted\.com|lt\.acemlna\.com/i },
  { name: "Intercom", pattern: /intercom-mail\.com/i },
  { name: "ConvertKit", pattern: /convertkit-mail\.com/i },
  { name: "Apollo", pattern: /apollo\.io\/api\/v1\/email_accounts\/track/i },
];

/**
 * Audit an HTML string for tracking pixels (known spy pixel services or 0/1px hidden images).
 * Removes tracking pixels and returns the list of detected trackers.
 */
export function auditTrackingPixels(html: string): TrackingAuditResult {
  if (!html) {
    return { hasTrackers: false, trackers: [], sanitizedHtml: "" };
  }

  const trackers: DetectedTracker[] = [];
  const seenUrls = new Set<string>();

  // Match <img> tags
  const imgRegex = /<img\b([^>]*?)>/gi;

  const sanitizedHtml = html.replace(imgRegex, (fullImg, attributes: string) => {
    // Extract src
    const srcMatch = attributes.match(/\bsrc\s*=\s*(["'])(https?:\/\/[^"']*)\1/i) ||
      attributes.match(/\bdata-blocked-src\s*=\s*(["'])(https?:\/\/[^"']*)\1/i);
    if (!srcMatch || !srcMatch[2]) return fullImg;

    const url = srcMatch[2];

    // Check 1: Known tracker domain/path
    let matchedProvider: string | null = null;
    for (const service of KNOWN_TRACKING_SERVICES) {
      if (service.pattern.test(url)) {
        matchedProvider = service.name;
        break;
      }
    }

    // Check 2: 1x1 or 0x0 image dimensions or hidden styles
    const isDimensionPixel =
      /\b(width|height)\s*=\s*(["']?)[01](px)?\2/i.test(attributes) ||
      /style\s*=\s*["'][^"']*\b(width|height)\s*:\s*[01]px[^"']*["']/i.test(attributes) ||
      /style\s*=\s*["'][^"']*\bdisplay\s*:\s*none[^"']*["']/i.test(attributes);

    if (matchedProvider || isDimensionPixel) {
      const provider = matchedProvider ?? "Tracking Pixel";
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        trackers.push({ provider, url });
      }
      // Replace with harmless placeholder comment
      return `<!-- blocked tracking pixel: ${provider} -->`;
    }

    return fullImg;
  });

  return {
    hasTrackers: trackers.length > 0,
    trackers,
    sanitizedHtml,
  };
}
