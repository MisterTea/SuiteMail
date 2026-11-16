import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/services/db/labels", () => ({
  getLabelsForAccount: vi.fn().mockResolvedValue([
    { id: "lbl-work", name: "Work", type: "user" },
    { id: "lbl-news", name: "Newsletters", type: "user" },
  ]),
}));

const mockEmailActions = {
  addThreadLabel: vi.fn(),
  removeThreadLabel: vi.fn(),
  markThreadRead: vi.fn(),
  starThread: vi.fn(),
};

vi.mock("@/services/emailActions", () => ({
  addThreadLabel: vi.fn((...args) => mockEmailActions.addThreadLabel(...args)),
  removeThreadLabel: vi.fn((...args) => mockEmailActions.removeThreadLabel(...args)),
  markThreadRead: vi.fn((...args) => mockEmailActions.markThreadRead(...args)),
  starThread: vi.fn((...args) => mockEmailActions.starThread(...args)),
}));

import { getDb } from "@/services/db/connection";
import {
  getAffectedEmailsForFilter,
  applyFilterActionsToThreads,
} from "./filterEngine";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("filter preview and execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  describe("getAffectedEmailsForFilter", () => {
    it("returns matching emails with computed action changes assuming highest priority", async () => {
      mockDb.select.mockResolvedValueOnce([
        {
          id: "msg-1",
          thread_id: "thread-1",
          from_name: "GitHub",
          from_address: "notifications@github.com",
          to_addresses: "user@example.com",
          subject: "Issue #42 updated",
          snippet: "Someone commented on your issue",
          date: 1774000000000,
          is_read: 0,
          is_starred: 0,
          body_text: "Issue #42 has a new comment",
          body_html: "<p>Issue #42</p>",
          attachment_count: 0,
        },
        {
          id: "msg-2",
          thread_id: "thread-2",
          from_name: "Amazon",
          from_address: "shipment@amazon.com",
          to_addresses: "user@example.com",
          subject: "Your order has shipped",
          snippet: "Tracking number #12345",
          date: 1773900000000,
          is_read: 1,
          is_starred: 1,
          body_text: "Your Amazon package is on the way",
          body_html: "<p>Amazon package</p>",
          attachment_count: 1,
        },
      ]);

      const affected = await getAffectedEmailsForFilter(
        "acc-1",
        { from: "github.com" },
        { markRead: true, archive: true, applyLabel: "lbl-work" },
      );

      expect(affected).toHaveLength(1);
      expect(affected[0]?.id).toBe("msg-1");
      expect(affected[0]?.fromAddress).toBe("notifications@github.com");
      expect(affected[0]?.actionChanges).toContain("Apply label 'Work'");
      expect(affected[0]?.actionChanges).toContain("Archive from Inbox");
      expect(affected[0]?.actionChanges).toContain("Mark as read");
    });

    it("matches on hasAttachment criteria correctly", async () => {
      mockDb.select.mockResolvedValueOnce([
        {
          id: "msg-1",
          thread_id: "thread-1",
          from_name: "Alice",
          from_address: "alice@example.com",
          to_addresses: "user@example.com",
          subject: "Notes without attachment",
          snippet: "Just some notes",
          date: 1774000000000,
          is_read: 0,
          is_starred: 0,
          body_text: "Hello",
          body_html: null,
          attachment_count: 0,
        },
        {
          id: "msg-2",
          thread_id: "thread-2",
          from_name: "Bob",
          from_address: "bob@example.com",
          to_addresses: "user@example.com",
          subject: "Presentation with PDF",
          snippet: "Slides attached",
          date: 1774000100000,
          is_read: 0,
          is_starred: 0,
          body_text: "Please see attached PDF",
          body_html: null,
          attachment_count: 1,
        },
      ]);

      const affected = await getAffectedEmailsForFilter(
        "acc-1",
        { hasAttachment: true },
        { star: true },
      );

      expect(affected).toHaveLength(1);
      expect(affected[0]?.id).toBe("msg-2");
      expect(affected[0]?.hasAttachments).toBe(true);
      expect(affected[0]?.actionChanges).toContain("Star email");
    });

    it("returns empty list if no messages match criteria", async () => {
      mockDb.select.mockResolvedValueOnce([
        {
          id: "msg-1",
          thread_id: "thread-1",
          from_name: "Alice",
          from_address: "alice@example.com",
          to_addresses: "user@example.com",
          subject: "Hello",
          snippet: "Hi there",
          date: 1774000000000,
          is_read: 0,
          is_starred: 0,
          body_text: "Hi",
          body_html: null,
          attachment_count: 0,
        },
      ]);

      const affected = await getAffectedEmailsForFilter(
        "acc-1",
        { from: "unknown-sender@domain.org" },
        { markRead: true },
      );

      expect(affected).toHaveLength(0);
    });
  });

  describe("applyFilterActionsToThreads", () => {
    it("applies computed filter actions across target threads", async () => {
      await applyFilterActionsToThreads(
        "acc-1",
        {
          applyLabel: "lbl-work",
          archive: true,
          markRead: true,
          star: true,
        },
        ["thread-1", "thread-2"],
      );

      expect(mockEmailActions.addThreadLabel).toHaveBeenCalledWith("acc-1", "thread-1", "lbl-work");
      expect(mockEmailActions.addThreadLabel).toHaveBeenCalledWith("acc-1", "thread-2", "lbl-work");
      expect(mockEmailActions.removeThreadLabel).toHaveBeenCalledWith("acc-1", "thread-1", "INBOX");
      expect(mockEmailActions.removeThreadLabel).toHaveBeenCalledWith("acc-1", "thread-2", "INBOX");
      expect(mockEmailActions.markThreadRead).toHaveBeenCalledWith("acc-1", "thread-1", [], true);
      expect(mockEmailActions.markThreadRead).toHaveBeenCalledWith("acc-1", "thread-2", [], true);
      expect(mockEmailActions.starThread).toHaveBeenCalledWith("acc-1", "thread-1", [], true);
      expect(mockEmailActions.starThread).toHaveBeenCalledWith("acc-1", "thread-2", [], true);
    });
  });
});
