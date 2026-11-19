import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatSingleEml,
  formatMessagesAsEml,
  formatMessagesAsMbox,
  exportThreadToFile,
  exportAccountToMbox,
  type ExportableMessage,
} from "./mailboxExport";
import { platformSaveFile } from "@/platform";

vi.mock("@/platform", () => ({
  platformSaveFile: vi.fn(),
}));

const mockPlatformSaveFile = vi.mocked(platformSaveFile);

const mockDb = {
  select: vi.fn(),
};

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
}));

describe("mailboxExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleMsg: ExportableMessage = {
    id: "msg-1",
    from_address: "alice@example.com",
    from_name: "Alice Smith",
    to_addresses: "bob@example.com",
    cc_addresses: "carol@example.com",
    subject: "Meeting Tomorrow",
    date: 1700000000000,
    body_html: "<p>Hi Bob</p>",
    body_text: "Hi Bob",
    message_id_header: "<msg1@example.com>",
  };

  it("formats a single message as RFC 2822 EML", () => {
    const eml = formatSingleEml(sampleMsg);
    expect(eml).toContain('From: "Alice Smith" <alice@example.com>');
    expect(eml).toContain("To: bob@example.com");
    expect(eml).toContain("Cc: carol@example.com");
    expect(eml).toContain("Subject: Meeting Tomorrow");
    expect(eml).toContain("Message-ID: <msg1@example.com>");
    expect(eml).toContain("Content-Type: text/html; charset=UTF-8");
    expect(eml).toContain("<p>Hi Bob</p>");
  });

  it("formats messages as concatenated EMLs", () => {
    const eml = formatMessagesAsEml([sampleMsg, { ...sampleMsg, id: "msg-2", subject: "Follow Up" }]);
    expect(eml).toContain("Subject: Meeting Tomorrow");
    expect(eml).toContain("Subject: Follow Up");
  });

  it("formats messages as MBOX with From_ separator and mboxrd escaping", () => {
    const msgWithFromLine: ExportableMessage = {
      ...sampleMsg,
      body_html: null,
      body_text: "Hello\nFrom my perspective\nCheers",
    };

    const mbox = formatMessagesAsMbox([msgWithFromLine]);
    expect(mbox).toMatch(/^From alice@example\.com /);
    expect(mbox).toContain(">From my perspective");
  });

  it("returns false from exportThreadToFile if no messages exist", async () => {
    const res = await exportThreadToFile("Test", []);
    expect(res.success).toBe(false);
    expect(mockPlatformSaveFile).not.toHaveBeenCalled();
  });

  it("exports thread to selected file", async () => {
    mockPlatformSaveFile.mockResolvedValue(undefined);

    const res = await exportThreadToFile("Test", [sampleMsg]);
    expect(res.success).toBe(true);
    expect(res.filePath).toBe("Test.eml");
    expect(mockPlatformSaveFile).toHaveBeenCalledWith("Test.eml", expect.anything());
  });

  it("exports account messages to MBOX", async () => {
    mockPlatformSaveFile.mockResolvedValue(undefined);
    mockDb.select.mockResolvedValue([sampleMsg]);

    const res = await exportAccountToMbox("acc-1", "alice@example.com");
    expect(res.count).toBe(1);
    expect(res.filePath).toBe("alice_example_com-archive.mbox");
    expect(mockPlatformSaveFile).toHaveBeenCalledWith("alice_example_com-archive.mbox", expect.anything());
  });
});
