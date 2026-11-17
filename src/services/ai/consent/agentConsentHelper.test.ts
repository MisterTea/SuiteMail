import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildConsentRequest, getAffectedEmailsSummary } from "./agentConsentHelper";

vi.mock("@/services/db/messages", () => ({
  getMessagesForThread: vi.fn(),
}));

import { getMessagesForThread } from "@/services/db/messages";

describe("agentConsentHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildConsentRequest", () => {
    it("builds consent request for single send_email", async () => {
      const req = await buildConsentRequest(
        "send_email",
        {
          to: ["bob@example.com"],
          subject: "Project Update",
          body: "Hello Bob, here is the update.",
          cc: ["carol@example.com"],
        },
        "acc-1",
      );

      expect(req.type).toBe("send_email");
      expect(req.tool).toBe("send_email");
      expect(req.title).toContain("Confirm Sending Email");
      expect(req.emails).toBeDefined();
      expect(req.emails?.[0]?.to).toEqual(["bob@example.com"]);
      expect(req.emails?.[0]?.subject).toBe("Project Update");
      expect(req.emails?.[0]?.body).toBe("Hello Bob, here is the update.");
      expect(req.emails?.[0]?.cc).toEqual(["carol@example.com"]);
    });

    it("builds consent request for batch_send_emails", async () => {
      const req = await buildConsentRequest(
        "batch_send_emails",
        {
          emails: [
            { to: ["user1@example.com"], subject: "Sub 1", body: "Body 1" },
            { to: ["user2@example.com"], subject: "Sub 2", body: "Body 2" },
          ],
        },
        "acc-1",
      );

      expect(req.type).toBe("batch_send_emails");
      expect(req.tool).toBe("batch_send_emails");
      expect(req.title).toContain("2 Emails");
      expect(req.emails).toHaveLength(2);
      expect(req.emails?.[0]?.to).toEqual(["user1@example.com"]);
      expect(req.emails?.[1]?.to).toEqual(["user2@example.com"]);
    });

    it("builds consent request for move_emails", async () => {
      vi.mocked(getMessagesForThread).mockResolvedValueOnce([
        {
          id: "m-1",
          account_id: "acc-1",
          thread_id: "t-1",
          subject: "Invoice #101",
          from_name: "Acme Corp",
          from_address: "billing@acme.com",
          date: 1773000000,
          snippet: "Due next week",
        } as any,
      ]);

      const req = await buildConsentRequest(
        "move_emails",
        {
          thread_ids: ["t-1"],
          folder: "Receipts",
        },
        "acc-1",
      );

      expect(req.type).toBe("move_emails");
      expect(req.changes?.action).toBe("move");
      expect(req.changes?.targetFolder).toBe("Receipts");
      expect(req.affectedEmails).toHaveLength(1);
      expect(req.affectedEmails?.[0]?.subject).toBe("Invoice #101");
      expect(req.affectedEmails?.[0]?.sender).toContain("Acme Corp");
    });

    it("builds consent request for relabel_emails", async () => {
      vi.mocked(getMessagesForThread).mockResolvedValueOnce([
        {
          id: "m-2",
          account_id: "acc-1",
          thread_id: "t-2",
          subject: "Client Feedback",
          from_name: "Client",
          from_address: "client@example.com",
          date: 1773100000,
        } as any,
      ]);

      const req = await buildConsentRequest(
        "relabel_emails",
        {
          thread_ids: ["t-2"],
          add_labels: ["Important", "Client"],
          remove_labels: ["Inbox"],
        },
        "acc-1",
      );

      expect(req.type).toBe("relabel_emails");
      expect(req.changes?.action).toBe("relabel");
      expect(req.changes?.addLabels).toEqual(["Important", "Client"]);
      expect(req.changes?.removeLabels).toEqual(["Inbox"]);
      expect(req.affectedEmails).toHaveLength(1);
      expect(req.affectedEmails?.[0]?.subject).toBe("Client Feedback");
    });

    it("builds consent request for delete_emails", async () => {
      vi.mocked(getMessagesForThread).mockResolvedValueOnce([
        {
          id: "m-3",
          account_id: "acc-1",
          thread_id: "t-3",
          subject: "Spam Newsletter",
          from_name: "Spammer",
          from_address: "spam@example.com",
          date: 1773200000,
        } as any,
      ]);

      const req = await buildConsentRequest(
        "delete_emails",
        {
          thread_ids: ["t-3"],
          permanent: true,
        },
        "acc-1",
      );

      expect(req.type).toBe("delete_emails");
      expect(req.changes?.action).toBe("delete");
      expect(req.changes?.permanent).toBe(true);
      expect(req.title).toContain("Permanently Deleting");
      expect(req.affectedEmails).toHaveLength(1);
    });
  });

  describe("getAffectedEmailsSummary", () => {
    it("returns empty array for empty threadIds", async () => {
      const result = await getAffectedEmailsSummary("acc-1", []);
      expect(result).toEqual([]);
    });

    it("falls back to placeholder when getMessagesForThread throws", async () => {
      vi.mocked(getMessagesForThread).mockRejectedValueOnce(new Error("DB error"));
      const result = await getAffectedEmailsSummary("acc-1", ["thread-999"]);
      expect(result).toHaveLength(1);
      expect(result[0]?.threadId).toBe("thread-999");
      expect(result[0]?.subject).toBe("Thread thread-999");
    });
  });
});
