import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ScheduledSendToast } from "./ScheduledSendToast";
import { useComposerStore } from "@/stores/composerStore";

vi.mock("@/services/db/scheduledEmails", () => ({
  deleteScheduledEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/router/navigate", () => ({
  navigateToLabel: vi.fn(),
}));

describe("ScheduledSendToast", () => {
  beforeEach(() => {
    useComposerStore.setState({
      scheduledToast: null,
    });
  });

  it("renders when scheduledToast is present in store", () => {
    render(<ScheduledSendToast />);
    expect(screen.queryByText(/Delivery scheduled/i)).not.toBeInTheDocument();

    act(() => {
      useComposerStore.getState().setScheduledToast({
        id: "sch-1",
        timestamp: 1735689600,
        formattedTime: "Tomorrow at 9:00 AM",
        recipient: "team@workplace.org",
        subject: "Morning Agenda",
        recurrenceRule: null,
      });
    });

    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Delivery scheduled for Tomorrow at 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Undo")).toBeInTheDocument();
    expect(screen.getByText("View in Outbox")).toBeInTheDocument();
  });

  it("displays recurrence rule when set", () => {
    render(<ScheduledSendToast />);

    act(() => {
      useComposerStore.getState().setScheduledToast({
        id: "sch-2",
        timestamp: 1735689600,
        formattedTime: "Monday at 9:00 AM",
        recipient: "team@workplace.org",
        subject: "Weekly Sync",
        recurrenceRule: "weekly",
      });
    });

    expect(screen.getByText("Repeats weekly")).toBeInTheDocument();
  });

  it("clears toast when dismiss is clicked", () => {
    render(<ScheduledSendToast />);

    act(() => {
      useComposerStore.getState().setScheduledToast({
        id: "sch-3",
        timestamp: 1735689600,
        formattedTime: "Tomorrow at 9:00 AM",
        recipient: "team@workplace.org",
        subject: "Morning Agenda",
      });
    });

    const dismissBtn = screen.getByTitle("Dismiss");
    fireEvent.click(dismissBtn);

    expect(useComposerStore.getState().scheduledToast).toBeNull();
  });
});
