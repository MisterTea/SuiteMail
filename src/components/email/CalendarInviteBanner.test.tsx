import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CalendarInviteBanner } from "./CalendarInviteBanner";
import type { InviteDetails } from "@/services/calendar/types";
import type { DbMessage } from "@/services/db/messages";

const mockRespondToInvite = vi.fn();
const mockGetExistingEventRsvp = vi.fn();

vi.mock("@/services/calendar/inviteDetector", () => ({
  respondToInvite: (...args: unknown[]) => mockRespondToInvite(...args),
  getExistingEventRsvp: (...args: unknown[]) => mockGetExistingEventRsvp(...args),
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (s: unknown) => unknown) =>
    selector({
      accounts: [
        { id: "acc-1", email: "user@example.com", displayName: "Test User" },
      ],
    }),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({
      setActiveView: vi.fn(),
    }),
}));

describe("CalendarInviteBanner", () => {
  const dummyMessage: Partial<DbMessage> = {
    id: "msg-1",
    account_id: "acc-1",
    thread_id: "thread-1",
  };

  const dummyInvite: InviteDetails = {
    uid: "test-uid-123",
    summary: "Sprint Architecture Sync",
    description: "Discuss v2 architecture",
    location: "Zoom Room 4",
    startTime: 1763740800,
    endTime: 1763744400,
    isAllDay: false,
    status: "confirmed",
    organizerEmail: "lead@example.com",
    attendees: [],
    icalData: "BEGIN:VCALENDAR\nEND:VCALENDAR",
    method: "REQUEST",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetExistingEventRsvp.mockResolvedValue(null);
    mockRespondToInvite.mockResolvedValue({ success: true });
  });

  it("renders event summary, location, and organizer", () => {
    render(
      <CalendarInviteBanner
        message={dummyMessage as DbMessage}
        invite={dummyInvite}
      />,
    );

    expect(screen.getByText("Sprint Architecture Sync")).toBeInTheDocument();
    expect(screen.getByText("Zoom Room 4")).toBeInTheDocument();
    expect(screen.getByText(/lead@example.com/)).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Tentative")).toBeInTheDocument();
    expect(screen.getByText("Decline")).toBeInTheDocument();
  });

  it("calls respondToInvite when Accept button is clicked", async () => {
    render(
      <CalendarInviteBanner
        message={dummyMessage as DbMessage}
        invite={dummyInvite}
      />,
    );

    const acceptBtn = screen.getByText("Accept");
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(mockRespondToInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          responseStatus: "accepted",
          userEmail: "user@example.com",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/accepted this invitation/i)).toBeInTheDocument();
    });
  });

  it("calls respondToInvite when Decline button is clicked", async () => {
    render(
      <CalendarInviteBanner
        message={dummyMessage as DbMessage}
        invite={dummyInvite}
      />,
    );

    const declineBtn = screen.getByText("Decline");
    fireEvent.click(declineBtn);

    await waitFor(() => {
      expect(mockRespondToInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          responseStatus: "declined",
        }),
      );
    });
  });
});
