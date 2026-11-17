import { describe, it, expect } from "vitest";
import { auditTrackingPixels } from "./trackingPixels";

describe("auditTrackingPixels", () => {
  it("detects and strips known tracking services like Mailchimp and Superhuman", () => {
    const html = `
      <div>
        <p>Hello world</p>
        <img src="https://mandrillapp.com/track/open.php?u=123" width="1" height="1" />
        <img src="https://superhuman.com/track/read?id=xyz" />
        <img src="https://example.com/legit-logo.png" width="200" height="50" />
      </div>
    `;

    const result = auditTrackingPixels(html);
    expect(result.hasTrackers).toBe(true);
    expect(result.trackers.length).toBe(2);
    expect(result.trackers.some((t) => t.provider === "Mailchimp")).toBe(true);
    expect(result.trackers.some((t) => t.provider === "Superhuman")).toBe(true);
    expect(result.sanitizedHtml).not.toContain("mandrillapp.com/track");
    expect(result.sanitizedHtml).not.toContain("superhuman.com/track");
    expect(result.sanitizedHtml).toContain("legit-logo.png");
  });

  it("detects generic 1x1 tracking pixels by width/height", () => {
    const html = `
      <div>
        <p>Welcome!</p>
        <img src="https://custom-analytics.biz/pixel.gif" width="1" height="1" />
      </div>
    `;

    const result = auditTrackingPixels(html);
    expect(result.hasTrackers).toBe(true);
    expect(result.trackers[0]?.provider).toBe("Tracking Pixel");
    expect(result.sanitizedHtml).not.toContain("https://custom-analytics.biz/pixel.gif");
  });

  it("detects style-based hidden tracking pixels", () => {
    const html = `
      <p>Invoice attached</p>
      <img src="https://crm.corp.internal/t.gif" style="display:none;width:1px;height:1px" />
    `;

    const result = auditTrackingPixels(html);
    expect(result.hasTrackers).toBe(true);
    expect(result.sanitizedHtml).toContain("<!-- blocked tracking pixel: Tracking Pixel -->");
  });

  it("returns hasTrackers=false for clean HTML", () => {
    const html = `
      <div>
        <h1>Welcome</h1>
        <p>No tracking here.</p>
        <img src="https://cdn.example.com/hero.jpg" width="600" height="400" />
      </div>
    `;

    const result = auditTrackingPixels(html);
    expect(result.hasTrackers).toBe(false);
    expect(result.trackers.length).toBe(0);
    expect(result.sanitizedHtml).toContain("hero.jpg");
  });
});
