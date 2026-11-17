import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePiEmailTool, isMutableTool, MUTABLE_TOOLS } from "./piEmailTools";

// Mock emailActions
vi.mock("@/services/emailActions", () => ({
  sendEmail: vi.fn(() => Promise.resolve({ success: true })),
  moveThread: vi.fn(() => Promise.resolve({ success: true })),
  trashThread: vi.fn(() => Promise.resolve({ success: true })),
  permanentDeleteThread: vi.fn(() => Promise.resolve({ success: true })),
  archiveThread: vi.fn(() => Promise.resolve({ success: true })),
  spamThread: vi.fn(() => Promise.resolve({ success: true })),
  addThreadLabel: vi.fn(() => Promise.resolve({ success: true })),
  removeThreadLabel: vi.fn(() => Promise.resolve({ success: true })),
}));

// Mock messages
vi.mock("@/services/db/messages", () => ({
  getMessagesForThread: vi.fn(() => Promise.resolve([
    { id: "msg-1", thread_id: "t-1", subject: "Test Subject", from_address: "sender@example.com", date: 1000 },
  ])),
}));

// Mock accounts store
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: {
    getState: vi.fn(() => ({
      accounts: [{ id: "acc-1", email: "me@example.com" }],
    })),
  },
}));

import {
  sendEmail,
  moveThread,
  trashThread,
  permanentDeleteThread,
  addThreadLabel,
  removeThreadLabel,
} from "@/services/emailActions";

describe("piEmailTools - Consent Enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isMutableTool", () => {
    it("identifies mutable operations that require consent", () => {
      expect(isMutableTool("send_email")).toBe(true);
      expect(isMutableTool("batch_send_emails")).toBe(true);
      expect(isMutableTool("move_emails")).toBe(true);
      expect(isMutableTool("relabel_emails")).toBe(true);
      expect(isMutableTool("delete_emails")).toBe(true);
    });

    it("identifies read-only tools as not mutable", () => {
      expect(isMutableTool("search_emails")).toBe(false);
      expect(isMutableTool("semantic_search_emails")).toBe(false);
      expect(isMutableTool("get_thread")).toBe(false);
      expect(isMutableTool("get_email_stats")).toBe(false);
      expect(isMutableTool("run_readonly_sql")).toBe(false);
      expect(isMutableTool("list_labels")).toBe(false);
      expect(isMutableTool("suggest_filter")).toBe(false);
    });
  });

  describe("send_email", () => {
    it("stops and returns consentRefused: true when user refuses consent", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(false);

      const result = await executePiEmailTool(
        "send_email",
        {
          to: ["test@example.com"],
          subject: "Important announcement",
          body: "Hello world",
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBe(true);
      expect(result.text).toContain("Consent was refused");
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("executes sendEmail when consent is granted", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(true);

      const result = await executePiEmailTool(
        "send_email",
        {
          to: ["test@example.com"],
          subject: "Important announcement",
          body: "Hello world",
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBeFalsy();
      expect(sendEmail).toHaveBeenCalledOnce();
      expect(result.text).toContain("Email sent successfully to test@example.com");
    });
  });

  describe("batch_send_emails", () => {
    it("stops and returns consentRefused: true when user refuses consent for batch send", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(false);

      const result = await executePiEmailTool(
        "batch_send_emails",
        {
          emails: [
            { to: ["alice@example.com"], subject: "Hello Alice", body: "Msg 1" },
            { to: ["bob@example.com"], subject: "Hello Bob", body: "Msg 2" },
          ],
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBe(true);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("sends all emails in batch when consent is granted", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(true);

      const result = await executePiEmailTool(
        "batch_send_emails",
        {
          emails: [
            { to: ["alice@example.com"], subject: "Hello Alice", body: "Msg 1" },
            { to: ["bob@example.com"], subject: "Hello Bob", body: "Msg 2" },
          ],
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBeFalsy();
      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(result.text).toContain("Successfully sent all 2 emails");
    });
  });

  describe("move_emails", () => {
    it("stops and returns consentRefused: true when user refuses consent to move", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(false);

      const result = await executePiEmailTool(
        "move_emails",
        {
          thread_ids: ["t-1"],
          folder: "Archive",
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBe(true);
      expect(moveThread).not.toHaveBeenCalled();
    });

    it("moves emails when consent is granted", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(true);

      const result = await executePiEmailTool(
        "move_emails",
        {
          thread_ids: ["t-1"],
          folder: "Receipts",
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBeFalsy();
      expect(moveThread).toHaveBeenCalledWith("acc-1", "t-1", ["msg-1"], "Receipts");
    });
  });

  describe("relabel_emails", () => {
    it("stops and returns consentRefused: true when user refuses consent to relabel", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(false);

      const result = await executePiEmailTool(
        "relabel_emails",
        {
          thread_ids: ["t-1"],
          add_labels: ["Urgent"],
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBe(true);
      expect(addThreadLabel).not.toHaveBeenCalled();
    });

    it("applies and removes labels when consent is granted", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(true);

      const result = await executePiEmailTool(
        "relabel_emails",
        {
          thread_ids: ["t-1"],
          add_labels: ["Urgent"],
          remove_labels: ["Later"],
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBeFalsy();
      expect(addThreadLabel).toHaveBeenCalledWith("acc-1", "t-1", "Urgent");
      expect(removeThreadLabel).toHaveBeenCalledWith("acc-1", "t-1", "Later");
    });
  });

  describe("delete_emails", () => {
    it("stops and returns consentRefused: true when user refuses consent to delete", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(false);

      const result = await executePiEmailTool(
        "delete_emails",
        {
          thread_ids: ["t-1"],
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBe(true);
      expect(trashThread).not.toHaveBeenCalled();
    });

    it("trashes emails when consent is granted", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(true);

      const result = await executePiEmailTool(
        "delete_emails",
        {
          thread_ids: ["t-1"],
          permanent: false,
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBeFalsy();
      expect(trashThread).toHaveBeenCalledWith("acc-1", "t-1", ["msg-1"]);
    });

    it("permanently deletes emails when permanent: true and consent is granted", async () => {
      const onConsentRequest = vi.fn().mockResolvedValue(true);

      const result = await executePiEmailTool(
        "delete_emails",
        {
          thread_ids: ["t-1"],
          permanent: true,
        },
        "acc-1",
        { onConsentRequest },
      );

      expect(onConsentRequest).toHaveBeenCalledOnce();
      expect(result.consentRefused).toBeFalsy();
      expect(permanentDeleteThread).toHaveBeenCalledWith("acc-1", "t-1", ["msg-1"]);
    });
  });
});
