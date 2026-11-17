import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DetectedEventChip } from "./DetectedEventChip";
import type { DetectedDateTime } from "@/utils/dateTimeDetector";

const mockUpsertEvent = vi.fn();

vi.mock("@/services/db/calendarEvents", () => ({
  upsertCalendarEvent: (...args: unknown[]) => mockUpsertEvent(...args),
}));

vi.mock("@/router/navigate", () => ({
  navigateToLabel: vi.fn(),
}));

describe("DetectedEventChip", () => {
  const dummyDetected: DetectedDateTime = {
    rawMatch: "tomorrow at 3pm",
    startDate: new Date("2026-11-17T15:00:00Z"),
    endDate: new Date("2026-11-17T16:00:00Z"),
    formattedDisplay: "Tue, Nov 17 · 3:00 PM",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertEvent.mockResolvedValue(undefined);
  });

  it("renders formatted date time and Add button", () => {
    render(
      <DetectedEventChip
        detected={dummyDetected}
        accountId="acc-1"
        defaultTitle="Catchup"
      />,
    );

    expect(screen.getByText("Tue, Nov 17 · 3:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Add to Calendar")).toBeInTheDocument();
  });

  it("adds event to calendar on button click", async () => {
    render(
      <DetectedEventChip
        detected={dummyDetected}
        accountId="acc-1"
        defaultTitle="Catchup"
      />,
    );

    const addBtn = screen.getByText("Add to Calendar");
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(mockUpsertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          summary: "Catchup",
          status: "confirmed",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Added")).toBeInTheDocument();
    });
  });
});
