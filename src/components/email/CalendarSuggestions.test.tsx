import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { CalendarSuggestions } from "./CalendarSuggestions";
import type { DbMessage } from "@/services/db/messages";
import type { CalendarSuggestion } from "@/services/ai/calendarSuggestions";
const mocks = vi.hoisted(() => ({ analyze: vi.fn(), getCreated: vi.fn(), targets: vi.fn(), create: vi.fn() }));
vi.mock("@/services/ai/calendarSuggestions", () => ({ getCalendarSuggestions: mocks.analyze }));
vi.mock("@/services/calendar/eventCreation", () => ({ createCalendarEvent: mocks.create, getCreatedSuggestion: mocks.getCreated, loadEventTargets: mocks.targets }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: (selector: (state: unknown) => unknown) => selector({ accounts: [{ id: "source", email: "me@example.com", isActive: true }] }) }));
vi.mock("@/router/navigate", () => ({ navigateToSettings: vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }));
vi.mock("@/components/calendar/EventDetailModal", () => ({ EventDetailModal: () => <div>Event details</div> }));
const message = { id: "message", account_id: "source", thread_id: "thread", subject: "Review", body_text: "Review tomorrow", date: Date.now() } as DbMessage;
const suggestion: CalendarSuggestion = { id: "suggestion", title: "Design review", startTime: "2030-01-02T15:00:00Z", endTime: "2030-01-02T16:00:00Z", timeZone: "UTC", isAllDay: false, attendees: ["bob@example.com"], location: "", description: "", evidence: "Review tomorrow", missingDetails: [] };
const target = { id: "cal", account_id: "other", accountEmail: "organizer@example.com", display_name: "Work", is_primary: 1, canCreate: true, canInvite: true };

describe("email calendar suggestions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.analyze.mockResolvedValue([suggestion]); mocks.getCreated.mockResolvedValue(null);
    mocks.targets.mockResolvedValue({ targets: [target], errors: [] });
    mocks.create.mockResolvedValue({ accountId: "other", calendarId: "cal", event: { remoteEventId: "saved" } });
  });

  it("opens review without creating, supports cancel, and confirms into the selected account", async () => {
    render(<CalendarSuggestions message={message} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to calendar" }));
    await screen.findByLabelText("Title");
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    await screen.findByLabelText("Title");
    fireEvent.click(screen.getByRole("button", { name: "Create & send invitations" }));
    await screen.findByRole("button", { name: "View event" });
    expect(mocks.create).toHaveBeenCalledWith(target, expect.objectContaining({ attendees: [{ email: "bob@example.com" }] }), expect.objectContaining({ accountId: "source", messageId: "message" }));
  });

  it("restores already-created suggestions without another creation", async () => {
    mocks.getCreated.mockResolvedValue({ accountId: "other", calendarId: "cal", event: { remoteEventId: "saved" } });
    render(<CalendarSuggestions message={message} />);
    await screen.findByRole("button", { name: "View event" });
    expect(screen.queryByRole("button", { name: "Add to calendar" })).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("shows calendar setup and discovery errors when no writable target exists", async () => {
    mocks.targets.mockResolvedValue({ targets: [], errors: ["Reauthorize your calendar"] });
    render(<CalendarSuggestions message={message} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to calendar" }));
    await screen.findByText("Open calendar settings");
    expect(screen.getByRole("alert")).toHaveTextContent("Reauthorize your calendar");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ignores old analysis after navigating to a different email", async () => {
    let resolve!: (items: CalendarSuggestion[]) => void;
    mocks.analyze.mockImplementationOnce(() => new Promise<CalendarSuggestion[]>((done) => { resolve = done; })).mockResolvedValueOnce([]);
    const { rerender } = render(<CalendarSuggestions message={message} />);
    rerender(<CalendarSuggestions message={{ ...message, id: "other-message" }} />);
    await act(async () => resolve([suggestion]));
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Add to calendar" })).not.toBeInTheDocument();
  });

  it("lays out multiple suggestions two per row", async () => {
    mocks.analyze.mockResolvedValue([suggestion, { ...suggestion, id: "suggestion-2", title: "IEEE Humanoid Summit" }]);
    const { container } = render(<CalendarSuggestions message={message} />);
    await screen.findByText("IEEE Humanoid Summit");
    expect(container.querySelector(".grid.grid-cols-2")).toBeInTheDocument();
  });

  it("fails quietly when AI is unavailable or extraction fails", async () => {
    mocks.analyze.mockRejectedValue(new Error("offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<CalendarSuggestions message={message} />);
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    warning.mockRestore();
  });
});
