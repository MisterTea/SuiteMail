import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { MessageItem } from "./MessageItem";
import type { DbMessage } from "@/services/db/messages";
import { useAccountStore } from "@/stores/accountStore";

const { detectInvite, turnOffEmailReminders } = vi.hoisted(() => ({
  detectInvite: vi.fn(() => null as unknown),
  turnOffEmailReminders: vi.fn(),
}));
vi.mock("@/services/calendar/inviteDetector", () => ({ detectInviteFromMessage: detectInvite }));
vi.mock("@/services/calendar/googleCalendarProvider", () => ({
  GoogleCalendarProvider: class {
    turnOffEmailReminders = turnOffEmailReminders;
  },
}));
vi.mock("./CalendarInviteBanner", () => ({ CalendarInviteBanner: () => <div data-testid="calendar-invite" /> }));
vi.mock("./CalendarSuggestions", () => ({ CalendarSuggestions: () => <div data-testid="calendar-suggestions" /> }));

vi.mock("./EmailRenderer", () => ({
  EmailRenderer: () => <div data-testid="email-renderer" />,
}));

vi.mock("./InlineAttachmentPreview", () => ({
  InlineAttachmentPreview: () => null,
}));

vi.mock("./AttachmentList", () => ({
  AttachmentList: () => null,
  getAttachmentsForMessage: vi.fn().mockResolvedValue([]),
}));

vi.mock("./AuthBadge", () => ({
  AuthBadge: () => null,
}));

vi.mock("./AuthWarningBanner", () => ({
  AuthWarningBanner: () => null,
}));

function makeMessage(overrides: Partial<DbMessage> = {}): DbMessage {
  return {
    id: "m1",
    account_id: "a1",
    thread_id: "t1",
    from_address: "bob@example.com",
    from_name: "Bob",
    to_addresses: "alice@example.com",
    cc_addresses: null,
    bcc_addresses: null,
    reply_to: null,
    subject: "Test subject",
    snippet: "Test snippet",
    date: Date.now(),
    is_read: 0,
    is_starred: 0,
    body_html: "<p>Hello</p>",
    body_text: "Hello",
    body_cached: 1,
    raw_size: 100,
    internal_date: null,
    list_unsubscribe: null,
    list_unsubscribe_post: null,
    auth_results: null,
    message_id_header: null,
    references_header: null,
    in_reply_to_header: null,
    ...overrides,
  };
}

describe("MessageItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectInvite.mockReturnValue(null);
    useAccountStore.setState({ accounts: [] });
  });

  it("mounts AI calendar suggestions only when the email body is opened", async () => {
    const message = makeMessage();
    const { rerender } = render(<MessageItem message={message} isLast={false} blockImages={false} />);
    expect(screen.queryByTestId("calendar-suggestions")).not.toBeInTheDocument();
    await act(async () => rerender(<MessageItem message={message} isLast={false} focused blockImages={false} />));
    expect(screen.getByTestId("calendar-suggestions")).toBeInTheDocument();
  });

  it("preserves the RSVP banner and suppresses AI suggestions for actual invitations", async () => {
    detectInvite.mockReturnValue({ uid: "invite" });
    await act(async () => render(<MessageItem message={makeMessage()} isLast blockImages={false} />));
    expect(screen.getByTestId("calendar-invite")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-suggestions")).not.toBeInTheDocument();
  });

  it("replaces the event creation suggestion with the reminder action", async () => {
    useAccountStore.setState({ accounts: [{
      id: "a1", email: "alice@gmail.com", displayName: null, avatarUrl: null, isActive: true, provider: "gmail_api",
    }] });
    turnOffEmailReminders.mockResolvedValue({ isSeries: true });
    const eid = btoa("series_20261124T003000Z alice@m");
    const otherEid = btoa("different alice@m");
    const message = makeMessage({
      from_address: "calendar-notification@google.com",
      subject: "Notification: Brady-TKD @ Mon Nov 23, 2026 6:30pm - 7:30pm (CST)",
      body_html: `<p>You have an upcoming event</p>
        <a href="https://calendar.google.com/calendar/event?eid=${otherEid}">Another event</a>
        <a href="https://calendar.google.com/calendar/event?action=VIEW&amp;eid=${eid}">View all event details</a>`,
    });

    await act(async () => render(<MessageItem message={message} isLast blockImages={false} />));
    expect(screen.queryByTestId("calendar-suggestions")).not.toBeInTheDocument();
    expect(turnOffEmailReminders).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn off email reminders" }));
    expect(await screen.findByText("Email reminders are off for this series.")).toBeInTheDocument();
    expect(turnOffEmailReminders).toHaveBeenCalledExactlyOnceWith("alice@gmail.com", "series_20261124T003000Z");
  });

  it("suppresses event creation for a calendar reminder without a usable event link", async () => {
    const message = makeMessage({
      from_address: "calendar-notification@google.com",
      subject: "Notification: Brady-TKD",
      body_html: '<a href="https://calendar.google.com.example.com/calendar/event?eid=bad">View all event details</a>',
    });
    await act(async () => render(<MessageItem message={message} isLast blockImages={false} />));
    expect(screen.getByText("Calendar reminder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /email reminders/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-suggestions")).not.toBeInTheDocument();
  });

  it("renders sender name", () => {
    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("applies red background when isSpam is true", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} isSpam={true} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("bg-red-500/8");
  });

  it("does not apply red background when isSpam is false", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} isSpam={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("bg-red-500");
  });

  it("does not apply red background when isSpam is undefined", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("bg-red-500");
  });

  it("applies focus ring when focused prop is true", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={true} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("ring-accent/50");
  });

  it("does not apply focus ring when focused is false", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("ring-accent/50");
  });

  it("auto-expands when focused becomes true", () => {
    // Render collapsed (isLast=false, not focused)
    const { container, rerender } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={false} />,
    );
    // Should be collapsed — no email renderer visible
    expect(container.querySelector("[data-testid='email-renderer']")).toBeNull();

    // Now set focused=true
    rerender(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={true} />,
    );
    // Should now be expanded — email renderer visible
    expect(container.querySelector("[data-testid='email-renderer']")).toBeInTheDocument();
  });

  it("forwards ref to outer div", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <MessageItem ref={ref} message={makeMessage()} isLast={true} blockImages={false} />,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
