import { describe, expect, it } from "vitest";
import {
  formatGraphAddresses,
  graphMessageToStored,
  graphMoveDestination,
  mapGraphFolder,
  receivedAfterIso,
} from "./graphModel";
import type { GraphMessageDto } from "./graphModel";

describe("graph message mapping", () => {
  const message: GraphMessageDto = {
    id: "msg-1",
    subject: "Hello",
    bodyPreview: "Preview text",
    bodyContent: "<p>Hi</p>",
    bodyContentType: "html",
    from: { name: "Ada Lovelace", address: "ada@utexas.edu" },
    toRecipients: [
      { name: "Office", address: "office@utexas.edu" },
      { address: "second@utexas.edu" },
    ],
    receivedDateTime: "2026-11-01T15:04:05Z",
    isRead: false,
    isDraft: false,
    hasAttachments: true,
    internetMessageId: "<abc@utexas.edu>",
    headers: [
      { name: "List-Unsubscribe", value: "<mailto:off@utexas.edu>" },
      { name: "In-Reply-To", value: "<parent@utexas.edu>" },
    ],
    importance: "high",
    flagStatus: "flagged",
    parentFolderId: "folder-inbox",
    conversationId: "conv-9",
    attachments: [
      { id: "att-1", name: "notes.pdf", contentType: "application/pdf", size: 12, isInline: false },
    ],
  };

  it("formats recipients and keeps the conversation id", () => {
    const stored = graphMessageToStored(message);
    expect(stored.parsed.fromAddress).toBe("ada@utexas.edu");
    expect(stored.parsed.fromName).toBe("Ada Lovelace");
    expect(stored.parsed.toAddresses).toBe("Office <office@utexas.edu>, second@utexas.edu");
    expect(formatGraphAddresses([{ name: "Only" }])).toBe("Only");
    expect(stored.parsed.threadId).toBe("conv-9");
    expect(stored.parsed.bodyHtml).toBe("<p>Hi</p>");
    expect(stored.parsed.bodyText).toBeNull();
    expect(stored.parsed.snippet).toBe("Preview text");
    expect(stored.parsed.isStarred).toBe(true);
    expect(stored.parsed.date).toBe(Date.parse("2026-11-01T15:04:05Z"));
    expect(stored.parsed.listUnsubscribe).toBe("<mailto:off@utexas.edu>");
    expect(stored.inReplyTo).toBe("<parent@utexas.edu>");
    expect(stored.isImportant).toBe(true);
    expect(stored.parsed.attachments[0]?.gmailAttachmentId).toBe("att-1");
  });

  it("uses the message id when Graph has no conversation id", () => {
    const stored = graphMessageToStored({ ...message, conversationId: null, bodyContentType: "text", bodyContent: "plain" });
    expect(stored.parsed.threadId).toBe("msg-1");
    expect(stored.parsed.bodyText).toBe("plain");
    expect(stored.parsed.bodyHtml).toBeNull();
  });

  it("marks isFocused when inferenceClassification is focused", () => {
    const focusedStored = graphMessageToStored({ ...message, inferenceClassification: "focused" });
    expect(focusedStored.isFocused).toBe(true);

    const otherStored = graphMessageToStored({ ...message, inferenceClassification: "other" });
    expect(otherStored.isFocused).toBe(false);

    const unsetStored = graphMessageToStored(message);
    expect(unsetStored.isFocused).toBe(false);
  });
});

describe("graph folders", () => {
  it("maps well-known folders onto the inbox label ids", () => {
    expect(mapGraphFolder({
      id: "graph-inbox",
      displayName: "Inbox",
      wellKnownName: "inbox",
    })).toEqual({
      labelId: "INBOX",
      name: "Inbox",
      type: "system",
      specialUse: "\\Inbox",
    });
    expect(mapGraphFolder({
      id: "graph-junk",
      displayName: "Junk Email",
      wellKnownName: "junkemail",
    }).labelId).toBe("SPAM");
  });

  it("keeps a user folder id as the label id", () => {
    expect(mapGraphFolder({
      id: "folder-projects",
      displayName: "Projects",
    })).toMatchObject({ labelId: "folder-projects", type: "user" });
  });

  it("turns system label ids into Graph folder names", () => {
    expect(graphMoveDestination("INBOX")).toBe("inbox");
    expect(graphMoveDestination("TRASH")).toBe("deleteditems");
    expect(graphMoveDestination("archive")).toBe("archive");
    expect(graphMoveDestination("folder-projects")).toBe("folder-projects");
  });

  it("builds a UTC receivedDateTime bound", () => {
    const iso = receivedAfterIso(7);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const age = Date.now() - Date.parse(iso);
    expect(age).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(age).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });
});
