// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MetadataHistorySettings } from "./MetadataHistorySettings";
import * as metadataHistory from "@/services/db/metadataHistory";
import * as metadataReversion from "@/services/crdt/metadataReversion";
import { useAccountStore } from "@/stores/accountStore";
import { useToastStore } from "@/stores/toastStore";

vi.mock("@/services/db/metadataHistory", () => ({
  getMetadataHistory: vi.fn(),
  getMetadataChangesPastHour: vi.fn(),
}));

vi.mock("@/services/crdt/metadataReversion", () => ({
  reverseMetadataChangesPastHour: vi.fn(),
  reverseMetadataChange: vi.fn(),
}));

describe("MetadataHistorySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({ activeAccountId: "acc-1" } as any);
  });

  it("renders empty state when no history exists", async () => {
    vi.mocked(metadataHistory.getMetadataHistory).mockResolvedValue([]);
    vi.mocked(metadataHistory.getMetadataChangesPastHour).mockResolvedValue([]);

    render(<MetadataHistorySettings />);

    expect(screen.getByText("Metadata Audit Ledger & Reversibility")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No metadata history recorded yet.")).toBeInTheDocument();
    });

    const revertBtn = screen.getByRole("button", { name: /Reverse Changes/i });
    expect(revertBtn).toBeDisabled();
  });

  it("renders changes from the past hour and triggers reverse on button click", async () => {
    const mockRecords: metadataHistory.MetadataHistoryRecord[] = [
      {
        id: "rec-1",
        account_id: "acc-1",
        conversation_id: "conv-101",
        timestamp: Date.now() - 1000 * 60 * 5, // 5 min ago
        action: "set_labels",
        field: "labels",
        old_value: '["INBOX"]',
        new_value: '["INBOX", "Archive"]',
        change_summary: "Set conversation labels: [INBOX, Archive]",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
    ];

    vi.mocked(metadataHistory.getMetadataHistory).mockResolvedValue(mockRecords);
    vi.mocked(metadataHistory.getMetadataChangesPastHour).mockResolvedValue(mockRecords);
    vi.mocked(metadataReversion.reverseMetadataChangesPastHour).mockResolvedValue({
      reversedCount: 1,
      affectedConversations: ["conv-101"],
      reversals: [
        {
          originalChangeId: "rec-1",
          conversationId: "conv-101",
          action: "set_labels",
          field: "labels",
          restoredValue: ["INBOX"],
          reversalEntryId: "rev-rec-1",
        },
      ],
    });

    const toastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    render(<MetadataHistorySettings />);

    await waitFor(() => {
      expect(screen.getByText(/1 metadata change recorded in the past hour/i)).toBeInTheDocument();
      expect(screen.getByText("Set conversation labels: [INBOX, Archive]")).toBeInTheDocument();
    });

    const revertBtn = screen.getByRole("button", { name: /Reverse Changes/i });
    expect(revertBtn).not.toBeDisabled();

    fireEvent.click(revertBtn);

    await waitFor(() => {
      expect(metadataReversion.reverseMetadataChangesPastHour).toHaveBeenCalledWith("acc-1");
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Reversed 1 metadata change from the past hour",
        }),
      );
    });
  });

  it("allows reversing an individual change record", async () => {
    const mockRecords: metadataHistory.MetadataHistoryRecord[] = [
      {
        id: "rec-single",
        account_id: "acc-1",
        conversation_id: "conv-202",
        timestamp: Date.now() - 1000 * 60 * 10,
        action: "set_category",
        field: "category",
        old_value: null,
        new_value: '"Promotions"',
        change_summary: "Set category to Promotions",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
    ];

    vi.mocked(metadataHistory.getMetadataHistory).mockResolvedValue(mockRecords);
    vi.mocked(metadataHistory.getMetadataChangesPastHour).mockResolvedValue(mockRecords);
    vi.mocked(metadataReversion.reverseMetadataChange).mockResolvedValue(true);

    render(<MetadataHistorySettings />);

    await waitFor(() => {
      expect(screen.getByText("Set category to Promotions")).toBeInTheDocument();
    });

    const singleReverseBtn = screen.getByRole("button", { name: "Reverse" });
    fireEvent.click(singleReverseBtn);

    await waitFor(() => {
      expect(metadataReversion.reverseMetadataChange).toHaveBeenCalledWith("rec-single", "acc-1");
    });
  });
});
