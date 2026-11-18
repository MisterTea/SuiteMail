import { describe, it, expect } from "vitest";
import { buildForwardQuote } from "./forwardQuoteBuilder";

describe("forwardQuoteBuilder", () => {
  it("formats forwarded metadata into a structured card with callout border and chips", () => {
    const quote = buildForwardQuote({
      from_name: "Alice Smith",
      from_address: "alice@example.com",
      date: 1700000000000,
      subject: "Project Roadmap",
      to_addresses: "bob@example.com",
      body_html: "<p>Here is the roadmap for Q4.</p>",
    });

    expect(quote).toContain("---------- Forwarded message ---------");
    expect(quote).toContain("forwarded-message-card");
    expect(quote).toContain("border-left: 3px solid #6366f1");
    expect(quote).toContain("Alice Smith");
    expect(quote).toContain("alice@example.com");
    expect(quote).toContain("Project Roadmap");
    expect(quote).toContain("bob@example.com");
    expect(quote).toContain("Here is the roadmap for Q4.");
  });

  it("handles fallback when from_name or body_html is missing", () => {
    const quote = buildForwardQuote({
      from_address: "sender@example.com",
      date: "2026-11-17T12:00:00Z",
      to_addresses: "recipient@example.com",
      body_text: "Plain text note",
    });

    expect(quote).toContain("sender@example.com");
    expect(quote).toContain("(No Subject)");
    expect(quote).toContain("Plain text note");
  });

  it("escapes malicious HTML content inside forwarded fields", () => {
    const quote = buildForwardQuote({
      from_name: "<script>alert(1)</script>",
      from_address: "evil@hacker.com",
      date: 1700000000000,
      subject: '<img src=x onerror="alert(2)">',
      to_addresses: "victim@example.com",
      body_text: "Clean text",
    });

    expect(quote).not.toContain("<script>");
    expect(quote).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("formats preserved attachment badges cleanly", () => {
    const quote = buildForwardQuote({
      from_address: "sender@example.com",
      date: 1700000000, // seconds timestamp
      subject: "Report with attachments",
      body_text: "Please see attached files",
      attachments: [
        { filename: "financials.pdf", size: 1048576 },
        { filename: "notes.txt", size: 2048 },
      ],
    });

    expect(quote).toContain("financials.pdf");
    expect(quote).toContain("1.0 MB");
    expect(quote).toContain("notes.txt");
    expect(quote).toContain("2 KB");
    expect(quote).toContain("forward-attachment-badge");
  });
});
