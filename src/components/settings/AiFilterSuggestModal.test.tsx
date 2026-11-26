import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AiFilterSuggestModal } from "./AiFilterSuggestModal";
import { useNativePhone } from "@/hooks/useNativePhone";

vi.mock("@/hooks/useNativePhone", () => ({ useNativePhone: vi.fn(() => false) }));

import { useAccountStore } from "@/stores/accountStore";

// Mock services
vi.mock("@/services/ai/piEmailAgent", () => ({
  suggestFilterWithPiAgent: vi.fn(),
}));

vi.mock("@/services/filters/filterEngine", () => ({
  getAffectedEmailsForFilter: vi.fn(),
  applyFilterActionsToThreads: vi.fn(),
}));

vi.mock("@/services/db/filters", () => ({
  insertFilter: vi.fn(),
}));

vi.mock("@/services/db/labels", () => ({
  getLabelsForAccount: vi.fn().mockResolvedValue([
    { id: "lbl-work", name: "Work", type: "user" },
  ]),
  ensureLabelOrFolder: vi.fn().mockResolvedValue("created-folder-id-123"),
}));


import { suggestFilterWithPiAgent } from "@/services/ai/piEmailAgent";
import {
  getAffectedEmailsForFilter,
  applyFilterActionsToThreads,
} from "@/services/filters/filterEngine";
import { insertFilter } from "@/services/db/filters";
import { ensureLabelOrFolder } from "@/services/db/labels";

describe("AiFilterSuggestModal", () => {
  const onClose = vi.fn();
  const onFilterAdded = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNativePhone).mockReturnValue(false);
    useAccountStore.setState({ activeAccountId: "test-acc-1" });
  });

  it("renders when closed returns null", () => {
    const { container } = render(
      <AiFilterSuggestModal isOpen={false} onClose={onClose} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("allows user to enter prompt and generates filter via Pi Agent with affected emails preview and whole inbox checkbox", async () => {
    vi.mocked(suggestFilterWithPiAgent).mockResolvedValueOnce({
      filter: {
        name: "GitHub Notifications",
        criteria: { from: "notifications@github.com" },
        actions: { archive: true, markRead: true },
        explanation: "Automatically archives and marks GitHub notifications as read.",
      },
      toolCallsExecuted: [
        { tool: "suggest_filter", args: {}, output: "Filter captured" },
      ],
    });

    vi.mocked(getAffectedEmailsForFilter).mockResolvedValueOnce([
      {
        id: "msg-101",
        threadId: "thread-101",
        fromName: "GitHub",
        fromAddress: "notifications@github.com",
        toAddresses: "user@example.com",
        subject: "[Repo] New release v2.0",
        snippet: "Release v2.0 is now available",
        date: 1774000000000,
        isRead: false,
        isStarred: false,
        hasAttachments: false,
        actionChanges: ["Archive from Inbox", "Mark as read"],
      },
    ]);

    render(
      <AiFilterSuggestModal
        isOpen={true}
        onClose={onClose}
        onFilterAdded={onFilterAdded}
      />,
    );

    expect(screen.getByText("AI Filter Assistant")).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Move all receipts into a new Receipts folder/i);
    fireEvent.change(textarea, {
      target: { value: "Archive emails from github notifications and mark as read" },
    });

    const generateBtn = screen.getByRole("button", { name: /Generate Filter/i });
    fireEvent.click(generateBtn);

    // Verify loading and Pi agent call
    await waitFor(() => {
      expect(suggestFilterWithPiAgent).toHaveBeenCalledWith({
        prompt: "Archive emails from github notifications and mark as read",
        accountId: "test-acc-1",
        onProgress: expect.any(Function),
      });
    });

    // Verify suggested filter card and affected emails list
    await waitFor(() => {
      expect(screen.getByText("Filter Rule Summary")).toBeInTheDocument();
      expect(screen.getByDisplayValue("GitHub Notifications")).toBeInTheDocument();
      expect(screen.getByText("notifications@github.com")).toBeInTheDocument();
      expect(screen.getAllByText("Archive from Inbox").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Mark as read").length).toBeGreaterThan(0);
      expect(screen.getByText("1 matching email")).toBeInTheDocument();
      expect(screen.getByText("[Repo] New release v2.0")).toBeInTheDocument();
    });

    // Verify "Apply this new filter to whole inbox" checkbox is present and checked by default
    const wholeInboxCheckbox = screen.getByLabelText(/Also apply to matching existing emails/i);
    expect(wholeInboxCheckbox).toBeInTheDocument();
    expect(wholeInboxCheckbox).not.toBeChecked();

    // Verify "Add Filter (Highest Priority)" and "Discard" choices are presented
    expect(
      screen.getByText("Add this filter to your rules or discard?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Filter \(Highest Priority\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Discard/i })).toBeInTheDocument();
  });

  it("creates suggested folder and adds filter with highest priority when user agrees", async () => {
    vi.mocked(suggestFilterWithPiAgent).mockResolvedValueOnce({
      filter: {
        name: "Uber Receipts",
        newFolder: "Expenses",
        criteria: { from: "receipts@uber.com" },
        actions: { applyLabel: "Expenses", star: true },
        explanation: "Files Uber receipts into new Expenses folder and stars them.",
      },
      toolCallsExecuted: [],
    });

    vi.mocked(getAffectedEmailsForFilter).mockResolvedValueOnce([
      {
        id: "msg-uber-1",
        threadId: "thread-uber-1",
        fromName: "Uber",
        fromAddress: "receipts@uber.com",
        toAddresses: "user@example.com",
        subject: "Your Friday evening trip",
        snippet: "Total: $24.50",
        date: 1774000000000,
        isRead: true,
        isStarred: false,
        hasAttachments: false,
        actionChanges: ["Apply label 'Expenses'", "Star email"],
      },
    ]);

    vi.mocked(insertFilter).mockResolvedValueOnce("new-filter-uuid");

    render(
      <AiFilterSuggestModal
        isOpen={true}
        onClose={onClose}
        onFilterAdded={onFilterAdded}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Move all receipts into a new Receipts folder/i);
    fireEvent.change(textarea, {
      target: { value: "Put all Uber receipts in Expenses folder and star them" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Filter/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Uber Receipts")).toBeInTheDocument();
      expect(screen.getByText(/Creates new folder: "Expenses"/i)).toBeInTheDocument();
    });

    const addBtn = screen.getByRole("button", { name: /Add Filter \(Highest Priority\)/i });
    fireEvent.click(screen.getByLabelText(/Also apply to matching existing emails/i));
    fireEvent.click(addBtn);

    await waitFor(() => {
      // 1. Created the new folder
      expect(ensureLabelOrFolder).toHaveBeenCalledWith("test-acc-1", "Expenses");

      // 2. Inserted filter with highest priority and the created folder ID
      expect(insertFilter).toHaveBeenCalledWith({
        accountId: "test-acc-1",
        name: "Uber Receipts",
        criteria: { from: "receipts@uber.com" },
        actions: { applyLabel: "created-folder-id-123", star: true },
        isEnabled: true,
        highestPriority: true,
      });

      // 3. Applied to whole inbox
      expect(applyFilterActionsToThreads).toHaveBeenCalledWith(
        "test-acc-1",
        { applyLabel: "created-folder-id-123", star: true },
        ["thread-uber-1"],
      );

      expect(onFilterAdded).toHaveBeenCalledWith("new-filter-uuid");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("does not apply to existing emails when whole inbox checkbox is unchecked", async () => {
    vi.mocked(suggestFilterWithPiAgent).mockResolvedValueOnce({
      filter: {
        name: "GitHub Notifications",
        criteria: { from: "notifications@github.com" },
        actions: { archive: true },
      },
      toolCallsExecuted: [],
    });

    vi.mocked(getAffectedEmailsForFilter).mockResolvedValueOnce([
      {
        id: "msg-1",
        threadId: "thread-1",
        fromName: "GitHub",
        fromAddress: "notifications@github.com",
        toAddresses: "user@example.com",
        subject: "Ping",
        snippet: "Notification",
        date: 1774000000000,
        isRead: false,
        isStarred: false,
        hasAttachments: false,
        actionChanges: ["Archive from Inbox"],
      },
    ]);

    vi.mocked(insertFilter).mockResolvedValueOnce("new-filter-2");

    render(
      <AiFilterSuggestModal
        isOpen={true}
        onClose={onClose}
        onFilterAdded={onFilterAdded}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Move all receipts into a new Receipts folder/i);
    fireEvent.change(textarea, { target: { value: "Archive github" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Filter/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("GitHub Notifications")).toBeInTheDocument();
    });

    // Uncheck "Apply this new filter to whole inbox"
    const wholeInboxCheckbox = screen.getByLabelText(/Also apply to matching existing emails/i);
    expect(wholeInboxCheckbox).not.toBeChecked();

    const addBtn = screen.getByRole("button", { name: /Add Filter \(Highest Priority\)/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(insertFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          highestPriority: true,
        }),
      );
      // Because unchecked, should NOT apply to existing threads
      expect(applyFilterActionsToThreads).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("discards suggestion without creating folder or saving filter when user clicks Discard", async () => {
    vi.mocked(suggestFilterWithPiAgent).mockResolvedValueOnce({
      filter: {
        name: "Trash Promotions",
        newFolder: "Unwanted",
        criteria: { subject: "promo" },
        actions: { trash: true },
      },
      toolCallsExecuted: [],
    });

    vi.mocked(getAffectedEmailsForFilter).mockResolvedValueOnce([]);

    render(
      <AiFilterSuggestModal
        isOpen={true}
        onClose={onClose}
        onFilterAdded={onFilterAdded}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Move all receipts into a new Receipts folder/i);
    fireEvent.change(textarea, { target: { value: "Trash promo emails" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Filter/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Trash Promotions")).toBeInTheDocument();
    });

    const discardBtn = screen.getByRole("button", { name: /Discard/i });
    fireEvent.click(discardBtn);

    expect(ensureLabelOrFolder).not.toHaveBeenCalled();
    expect(insertFilter).not.toHaveBeenCalled();
    expect(onFilterAdded).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("restarts after editing while the previous email preview is still pending", async () => {
    let finishOldPreview!: (emails: never[]) => void;
    const oldPreview = new Promise<never[]>((resolve) => { finishOldPreview = resolve; });
    vi.mocked(suggestFilterWithPiAgent)
      .mockResolvedValueOnce({
        filter: { name: "Original", criteria: { from: "old@example.com" }, actions: { archive: true } },
        toolCallsExecuted: [],
      })
      .mockResolvedValueOnce({
        filter: { name: "Revised", criteria: { from: "new@example.com" }, actions: { star: true } },
        toolCallsExecuted: [],
      });
    vi.mocked(getAffectedEmailsForFilter)
      .mockReturnValueOnce(oldPreview)
      .mockResolvedValueOnce([]);

    render(<AiFilterSuggestModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Archive old mail" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Filter/i }));
    expect(await screen.findByDisplayValue("Original")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to edit/i }));
    expect(screen.getByRole("textbox")).toHaveValue("Archive old mail");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Star new mail" } });
    expect(screen.getByRole("button", { name: /Generate Filter/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Generate Filter/i }));
    expect(await screen.findByDisplayValue("Revised")).toBeInTheDocument();
    expect(suggestFilterWithPiAgent).toHaveBeenLastCalledWith({
      prompt: "Star new mail", accountId: "test-acc-1", onProgress: expect.any(Function),
    });
    finishOldPreview([]);
    await waitFor(() => expect(screen.getByDisplayValue("Revised")).toBeInTheDocument());
    expect(insertFilter).not.toHaveBeenCalled();
  });

  it("supports manual filter creation UX and presents the same accept/reject pane", async () => {
    vi.mocked(getAffectedEmailsForFilter).mockResolvedValueOnce([
      {
        id: "msg-manual-1",
        threadId: "thread-manual-1",
        fromName: "Client A",
        fromAddress: "client@example.com",
        toAddresses: "user@example.com",
        subject: "Contract Agreement",
        snippet: "Please find attached the signed contract",
        date: 1774000000000,
        isRead: false,
        isStarred: false,
        hasAttachments: true,
        actionChanges: ["Star email", "Apply label 'Legal'"],
      },
    ]);

    vi.mocked(insertFilter).mockResolvedValueOnce("manual-filter-id");

    render(
      <AiFilterSuggestModal
        isOpen={true}
        initialMode="manual"
        onClose={onClose}
        onFilterAdded={onFilterAdded}
      />,
    );

    // Verify Manual creation form is displayed
    expect(screen.getByText("Create Filter Manually")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Important Client Updates/i)).toBeInTheDocument();

    // Fill in manual fields
    fireEvent.change(screen.getByPlaceholderText(/Important Client Updates/i), {
      target: { value: "Client Contracts" },
    });
    fireEvent.change(screen.getByPlaceholderText(/boss@corp.com/i), {
      target: { value: "client@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Invoice, Receipt/i), {
      target: { value: "Contract" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Invoices, Taxes/i), {
      target: { value: "Legal" },
    });

    // Check Star email
    fireEvent.click(screen.getByLabelText(/Star email/i));

    // Click Preview & Continue
    fireEvent.click(screen.getByRole("button", { name: /Preview & Continue/i }));

    // Verify it transitioned to the SAME accept/reject review pane
    await waitFor(() => {
      expect(screen.getByText("Filter Rule Summary")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Client Contracts")).toBeInTheDocument();
      expect(screen.getByText("client@example.com")).toBeInTheDocument();
      expect(screen.getByText("Contract")).toBeInTheDocument();
      expect(screen.getByText(/Creates new folder: "Legal"/i)).toBeInTheDocument();
      expect(screen.getByText("Star email")).toBeInTheDocument();
      expect(screen.getByText(/Contract Agreement/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Also apply to matching existing emails/i)).toBeInTheDocument();
      expect(screen.getByText("Add this filter to your rules or discard?")).toBeInTheDocument();
    });

    // User explicitly includes existing messages.
    fireEvent.click(screen.getByLabelText(/Also apply to matching existing emails/i));
    fireEvent.click(screen.getByRole("button", { name: /Add Filter \(Highest Priority\)/i }));

    await waitFor(() => {
      expect(ensureLabelOrFolder).toHaveBeenCalledWith("test-acc-1", "Legal");
      expect(insertFilter).toHaveBeenCalledWith({
        accountId: "test-acc-1",
        name: "Client Contracts",
        criteria: { from: "client@example.com", subject: "Contract" },
        actions: { applyLabel: "created-folder-id-123", star: true },
        isEnabled: true,
        highestPriority: true,
      });
      expect(applyFilterActionsToThreads).toHaveBeenCalledWith(
        "test-acc-1",
        { applyLabel: "created-folder-id-123", star: true },
        ["thread-manual-1"],
      );
      expect(onFilterAdded).toHaveBeenCalledWith("manual-filter-id");
      expect(onClose).toHaveBeenCalled();
    });
  });
  it("uses a readable Android sheet and labeled fields with native Back dismissal", async () => {
    vi.mocked(useNativePhone).mockReturnValue(true);
    render(<AiFilterSuggestModal isOpen onClose={onClose} initialMode="manual" />);
    expect(screen.getByRole("dialog")).toHaveStyle({ height: "var(--mobile-viewport-height, 100dvh)" });
    await screen.findByRole("option", { name: "Work" });
    expect(screen.getByLabelText("From contains")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manual" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("fetches all matches, caps the rendered preview, and applies all after explicit consent", async () => {
    vi.mocked(suggestFilterWithPiAgent).mockResolvedValueOnce({ filter: { name: "Many matches", criteria: { from: "example.com" }, actions: { archive: true }, explanation: "Archive" } } as Awaited<ReturnType<typeof suggestFilterWithPiAgent>>);
    const matches = Array.from({ length: 51 }, (_, index) => ({ id: `email-${index}`, threadId: `thread-${index}`, fromAddress: "sender@example.com", subject: `Subject ${index}`, date: 1, actionChanges: ["Archive"] }));
    vi.mocked(getAffectedEmailsForFilter).mockResolvedValueOnce(matches);
    render(<AiFilterSuggestModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Archive example" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Filter/i }));
    await screen.findByText(/Showing 50 of 51/);
    expect(getAffectedEmailsForFilter).toHaveBeenCalledWith("test-acc-1", { from: "example.com" }, { archive: true }, Number.POSITIVE_INFINITY);
    expect(screen.queryByText("Subject 50")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Also apply to matching existing emails/));
    fireEvent.click(screen.getByRole("button", { name: /Add Filter \(Highest Priority\)/ }));
    await waitFor(() => expect(applyFilterActionsToThreads).toHaveBeenCalledWith("test-acc-1", { archive: true }, matches.map((match) => match.threadId)));
  });

  it("blocks creation after preview failure without reporting zero matches", async () => {
    vi.mocked(suggestFilterWithPiAgent).mockResolvedValueOnce({ filter: { name: "Failed preview", criteria: { from: "example.com" }, actions: { archive: true }, explanation: "Archive" } } as Awaited<ReturnType<typeof suggestFilterWithPiAgent>>);
    vi.mocked(getAffectedEmailsForFilter).mockRejectedValueOnce(new Error("Preview unavailable"));
    render(<AiFilterSuggestModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Archive example" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Filter/i }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Add Filter \(Highest Priority\)/ })).toBeDisabled();
    expect(screen.queryByText(/No existing emails match/)).not.toBeInTheDocument();
  });

});
