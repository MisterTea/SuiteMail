import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentConsentPopover } from "./AgentConsentPopover";
import { useConsentStore } from "@/services/ai/consent/consentStore";
import type { ConsentRequest } from "@/services/ai/consent/types";

describe("AgentConsentPopover", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useConsentStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(<AgentConsentPopover />);
    expect(container.firstChild).toBeNull();
  });

  it("renders popover for single email send with details and buttons", () => {
    const req: ConsentRequest = {
      id: "req-1",
      type: "send_email",
      tool: "send_email",
      title: "Confirm Sending Email",
      description: "Send email to client@example.com",
      args: {},
      emails: [
        {
          to: ["client@example.com"],
          cc: ["manager@example.com"],
          subject: "Quarterly Review Deck",
          body: "Please find attached the quarterly review deck.",
        },
      ],
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm Sending Email")).toBeInTheDocument();
    expect(screen.getByText("client@example.com")).toBeInTheDocument();
    expect(screen.getByText("manager@example.com")).toBeInTheDocument();
    expect(screen.getByText("Quarterly Review Deck")).toBeInTheDocument();
    expect(screen.getByText("Please find attached the quarterly review deck.")).toBeInTheDocument();

    const refuseBtn = screen.getByText("Don't Send");
    const approveBtn = screen.getByText("Send Email");
    expect(refuseBtn).toBeInTheDocument();
    expect(approveBtn).toBeInTheDocument();
  });

  it("renders popover for batch email send with multiple email cards", () => {
    const req: ConsentRequest = {
      id: "req-batch",
      type: "batch_send_emails",
      tool: "batch_send_emails",
      title: "Confirm Sending Batch (2 Emails)",
      description: "Send 2 emails",
      args: {},
      emails: [
        { to: ["user1@example.com"], subject: "Welcome 1", body: "Hello user 1" },
        { to: ["user2@example.com"], subject: "Welcome 2", body: "Hello user 2" },
      ],
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    expect(screen.getByText("Confirm Sending Batch (2 Emails)")).toBeInTheDocument();
    expect(screen.getByText("Total recipients to email:")).toBeInTheDocument();
    expect(screen.getByText("2 emails")).toBeInTheDocument();
    expect(screen.getByText("Email #1")).toBeInTheDocument();
    expect(screen.getByText("Email #2")).toBeInTheDocument();
    expect(screen.getByText("Welcome 1")).toBeInTheDocument();
    expect(screen.getByText("Welcome 2")).toBeInTheDocument();
    expect(screen.getByText("Don't Send Batch")).toBeInTheDocument();
    expect(screen.getByText("Send All (2)")).toBeInTheDocument();
  });

  it("renders popover for moving emails with what will change and affected emails", () => {
    const req: ConsentRequest = {
      id: "req-move",
      type: "move_emails",
      tool: "move_emails",
      title: "Confirm Moving 1 Email(s)",
      description: "Move emails",
      args: {},
      changes: {
        action: "move",
        targetFolder: "Archive",
      },
      affectedEmails: [
        {
          id: "m-1",
          threadId: "t-1",
          subject: "Project Specs",
          sender: "Alice <alice@example.com>",
          date: 1773000000,
        },
      ],
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    expect(screen.getByText("Confirm Moving 1 Email(s)")).toBeInTheDocument();
    expect(screen.getByText("What will change:")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByText("Project Specs")).toBeInTheDocument();
    expect(screen.getByText("From: Alice <alice@example.com>")).toBeInTheDocument();
    expect(screen.getByText("Move Emails")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("renders popover for relabeling emails showing added and removed labels", () => {
    const req: ConsentRequest = {
      id: "req-relabel",
      type: "relabel_emails",
      tool: "relabel_emails",
      title: "Confirm Relabeling 1 Email(s)",
      description: "Relabel",
      args: {},
      changes: {
        action: "relabel",
        addLabels: ["Work", "Urgent"],
        removeLabels: ["Personal"],
      },
      affectedEmails: [
        {
          id: "m-2",
          threadId: "t-2",
          subject: "Status Report",
          sender: "Bob <bob@example.com>",
          date: 1773000000,
        },
      ],
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    expect(screen.getByText("+Work")).toBeInTheDocument();
    expect(screen.getByText("+Urgent")).toBeInTheDocument();
    expect(screen.getByText("-Personal")).toBeInTheDocument();
    expect(screen.getByText("Status Report")).toBeInTheDocument();
    expect(screen.getByText("Apply Label Changes")).toBeInTheDocument();
  });

  it("renders popover for deleting emails with warning and danger button", () => {
    const req: ConsentRequest = {
      id: "req-del",
      type: "delete_emails",
      tool: "delete_emails",
      title: "Confirm Moving 2 Email(s) to Trash",
      description: "Delete",
      args: {},
      changes: {
        action: "delete",
        permanent: false,
      },
      affectedEmails: [
        { id: "m-1", threadId: "t-1", subject: "Spam 1", sender: "spam@bad.com", date: 1000 },
        { id: "m-2", threadId: "t-2", subject: "Spam 2", sender: "spam2@bad.com", date: 2000 },
      ],
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    expect(screen.getByText("Moving to Trash")).toBeInTheDocument();
    expect(screen.getByText("These 2 email thread(s) will be moved to the Trash.")).toBeInTheDocument();
    expect(screen.getByText("Spam 1")).toBeInTheDocument();
    expect(screen.getByText("Spam 2")).toBeInTheDocument();
    expect(screen.getByText("Move to Trash")).toBeInTheDocument();
  });

  it("calls approve when user clicks the approve button", () => {
    const approveSpy = vi.spyOn(useConsentStore.getState(), "approve");

    const req: ConsentRequest = {
      id: "req-test",
      type: "send_email",
      tool: "send_email",
      title: "Confirm Send",
      description: "Test",
      args: {},
      emails: [{ to: ["test@example.com"], subject: "Hello", body: "Body" }],
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    fireEvent.click(screen.getByText("Send Email"));
    expect(approveSpy).toHaveBeenCalledOnce();
  });

  it("calls refuse when user clicks Don't Send / Cancel", () => {
    const refuseSpy = vi.spyOn(useConsentStore.getState(), "refuse");

    const req: ConsentRequest = {
      id: "req-test",
      type: "send_email",
      tool: "send_email",
      title: "Confirm Send",
      description: "Test",
      args: {},
      emails: [{ to: ["test@example.com"], subject: "Hello", body: "Body" }],
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    fireEvent.click(screen.getByText("Don't Send"));
    expect(refuseSpy).toHaveBeenCalledOnce();
    refuseSpy.mockRestore();
  });

  it("calls refuse when Escape key is pressed", () => {
    const refuseSpy = vi.spyOn(useConsentStore.getState(), "refuse");

    const req: ConsentRequest = {
      id: "req-test",
      type: "move_emails",
      tool: "move_emails",
      title: "Confirm Move",
      description: "Test",
      args: {},
    };

    useConsentStore.setState({ isOpen: true, activeRequest: req });
    render(<AgentConsentPopover />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(refuseSpy).toHaveBeenCalledOnce();
    refuseSpy.mockRestore();
  });
});
