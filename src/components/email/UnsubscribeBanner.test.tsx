import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UnsubscribeBanner } from "./UnsubscribeBanner";
import type { DbMessage } from "@/services/db/messages";
import * as unsubscribeManager from "@/services/unsubscribe/unsubscribeManager";
import * as filtersDb from "@/services/db/filters";

vi.mock("@/services/unsubscribe/unsubscribeManager", () => ({
  executeUnsubscribe: vi.fn(),
  parseUnsubscribeHeaders: vi.fn(),
  getUnsubscribeStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/db/filters", () => ({
  insertFilter: vi.fn().mockResolvedValue("filter-1"),
}));

vi.mock("@/platform", () => ({
  platformOpenUrl: vi.fn(),
}));

function makeMessage(overrides: Partial<DbMessage> = {}): DbMessage {
  return {
    id: "m-unsub-1",
    account_id: "acc-1",
    thread_id: "t-1",
    from_address: "newsletter@example.com",
    from_name: "Weekly Digest",
    to_addresses: "user@example.com",
    cc_addresses: null,
    bcc_addresses: null,
    reply_to: null,
    subject: "Weekly Newsletter Issue #42",
    snippet: "Top tech stories this week",
    date: Date.now(),
    is_read: 0,
    is_starred: 0,
    body_html: "<p>Newsletter content</p>",
    body_text: "Newsletter content",
    body_cached: 1,
    raw_size: 100,
    internal_date: null,
    list_unsubscribe: "<https://example.com/unsub>",
    list_unsubscribe_post: "List-Unsubscribe=One-Click",
    auth_results: null,
    message_id_header: null,
    references_header: null,
    in_reply_to_header: null,
    ...overrides,
  };
}

describe("UnsubscribeBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(unsubscribeManager.parseUnsubscribeHeaders).mockReturnValue({
      httpUrl: "https://example.com/unsub",
      mailtoAddress: null,
      hasOneClick: true,
    });
    vi.mocked(unsubscribeManager.getUnsubscribeStatus).mockResolvedValue(null);
  });

  it("renders nothing when message has no list_unsubscribe header", () => {
    const { container } = render(
      <UnsubscribeBanner
        accountId="acc-1"
        threadId="t-1"
        message={makeMessage({ list_unsubscribe: null })}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders subtle utility bar with Unsubscribe button and mailing list label", () => {
    render(
      <UnsubscribeBanner
        accountId="acc-1"
        threadId="t-1"
        message={makeMessage()}
      />,
    );

    expect(screen.getByText(/mailing list or newsletter/i)).toBeInTheDocument();
    expect(screen.getByText(/Weekly Digest/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unsubscribe/i })).toBeInTheDocument();
    expect(screen.getByText("1-Click")).toBeInTheDocument();
  });

  it("executes unsubscribe and shows polished confirmation feedback on click", async () => {
    vi.mocked(unsubscribeManager.executeUnsubscribe).mockResolvedValue({
      method: "http_post",
      success: true,
    });

    const onAutoArchive = vi.fn();

    render(
      <UnsubscribeBanner
        accountId="acc-1"
        threadId="t-1"
        message={makeMessage()}
        onAutoArchive={onAutoArchive}
      />,
    );

    const unsubButton = screen.getByRole("button", { name: /unsubscribe/i });
    fireEvent.click(unsubButton);

    await waitFor(() => {
      expect(unsubscribeManager.executeUnsubscribe).toHaveBeenCalledWith(
        "acc-1",
        "t-1",
        "newsletter@example.com",
        "Weekly Digest",
        "<https://example.com/unsub>",
        "List-Unsubscribe=One-Click",
      );
    });

    // Confirmation message shown
    await waitFor(() => {
      expect(screen.getByText(/Unsubscribed from Weekly Digest/i)).toBeInTheDocument();
    });

    // Option to auto-archive future emails checkbox shown
    const checkbox = screen.getByLabelText(/auto-archive future emails from this sender/i);
    expect(checkbox).toBeInTheDocument();
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    // Auto-archive filter created in database
    expect(filtersDb.insertFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-1",
        actions: { archive: true },
        criteria: { from: "newsletter@example.com" },
      }),
    );

    // Click "Archive now"
    const archiveButton = screen.getByRole("button", { name: /archive now/i });
    fireEvent.click(archiveButton);
    expect(onAutoArchive).toHaveBeenCalled();
  });

  it("dismisses banner when close button is clicked", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <UnsubscribeBanner
        accountId="acc-1"
        threadId="t-1"
        message={makeMessage()}
        onDismiss={onDismiss}
      />,
    );

    const dismissButton = screen.getByTitle(/dismiss banner/i);
    fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it("shows failure state with retry and fallback link when unsubscribe fails", async () => {
    vi.mocked(unsubscribeManager.executeUnsubscribe).mockResolvedValue({
      method: "http_post",
      success: false,
    });

    render(
      <UnsubscribeBanner
        accountId="acc-1"
        threadId="t-1"
        message={makeMessage()}
      />,
    );

    const unsubButton = screen.getByRole("button", { name: /unsubscribe/i });
    fireEvent.click(unsubButton);

    await waitFor(() => {
      expect(screen.getByText(/Could not automatically unsubscribe/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open page/i })).toBeInTheDocument();
  });
});
