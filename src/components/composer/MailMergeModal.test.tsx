import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MailMergeModal } from "./MailMergeModal";

const mockSendEmail = vi.fn();
vi.mock("@/services/emailActions", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn(() => Promise.resolve({ id: "acc-1", email: "me@example.com" })),
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (s: { activeAccountId: string }) => unknown) =>
    selector({ activeAccountId: "acc-1" }),
}));

describe("MailMergeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders upload and paste UI when open", () => {
    render(
      <MailMergeModal
        isOpen={true}
        onClose={vi.fn()}
        subjectTemplate="Hello {{Name}}"
        bodyHtmlTemplate="<p>Welcome to {{Company}}</p>"
      />,
    );

    expect(screen.getByText("Mail Merge Campaign")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste CSV here/)).toBeInTheDocument();
  });

  it("parses pasted CSV, displays tags, and enables send campaign", async () => {
    render(
      <MailMergeModal
        isOpen={true}
        onClose={vi.fn()}
        subjectTemplate="Hello {{Name}}"
        bodyHtmlTemplate="<p>Welcome to {{Company}}</p>"
      />,
    );

    const textarea = screen.getByPlaceholderText(/Paste CSV here/);
    fireEvent.change(textarea, {
      target: {
        value: `Email,Name,Company\nalice@example.com,Alice,Acme Corp\nbob@example.com,Bob,Wayne Tech`,
      },
    });

    expect(screen.getByText(/Found 2 valid recipients/)).toBeInTheDocument();
    expect(screen.getByText("{{Name}}")).toBeInTheDocument();
    expect(screen.getByText("{{Company}}")).toBeInTheDocument();
    expect(screen.getByText("Send to 2 Recipients")).toBeInTheDocument();
  });

  it("sends personalized emails when user clicks Send to Recipients", async () => {
    mockSendEmail.mockResolvedValue(undefined);

    render(
      <MailMergeModal
        isOpen={true}
        onClose={vi.fn()}
        subjectTemplate="Hello {{Name}}"
        bodyHtmlTemplate="<p>Welcome to {{Company}}</p>"
      />,
    );

    const textarea = screen.getByPlaceholderText(/Paste CSV here/);
    fireEvent.change(textarea, {
      target: {
        value: `Email,Name,Company\nalice@example.com,Alice,Acme Corp`,
      },
    });

    const sendBtn = screen.getByText("Send to 1 Recipient");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        "acc-1",
        expect.any(String),
      );
      expect(screen.getByText("Campaign Completed!")).toBeInTheDocument();
    });
  });
});
