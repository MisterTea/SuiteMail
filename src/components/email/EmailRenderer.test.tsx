import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmailRenderer } from "./EmailRenderer";
import type { DbAttachment } from "@/services/db/attachments";
import { addToAllowlist } from "@/services/db/imageAllowlist";

const themeState = vi.hoisted(() => ({ theme: "light" }));

// Mock dependencies
vi.mock("@/platform", () => ({
  platformOpenUrl: vi.fn(),
}));

vi.mock("@/utils/sanitize", () => ({
  sanitizeHtml: (html: string) => html,
  escapeHtml: (text: string) => text,
}));

vi.mock("@/services/db/imageAllowlist", () => ({
  addToAllowlist: vi.fn(),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: (selector: (s: { theme: string }) => string) =>
    selector(themeState),
}));

const mockFetchAttachment = vi.fn();

vi.mock("@/services/email/providerFactory", () => ({
  getEmailProvider: vi.fn().mockResolvedValue({
    fetchAttachment: (...args: unknown[]) => mockFetchAttachment(...args),
  }),
}));

// Mock ResizeObserver for jsdom
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

function makeAttachment(overrides: Partial<DbAttachment> = {}): DbAttachment {
  return {
    id: "att-1",
    message_id: "msg-1",
    account_id: "acc-1",
    filename: "icon.png",
    mime_type: "image/png",
    size: 1024,
    gmail_attachment_id: "gmail-att-1",
    content_id: "icon@example.com",
    is_inline: 1,
    local_path: null,
    ...overrides,
  };
}

describe("EmailRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    themeState.theme = "light";
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("darkens HTML colors and restores sender colors when switching to light mode", () => {
    const html = '<p style="background-color: white; color: black">Hello</p>';
    themeState.theme = "dark";
    const { container, rerender } = render(<EmailRenderer html={html} text={null} />);
    const iframe = container.querySelector("iframe")!;
    const darkParagraph = iframe.contentDocument!.querySelector("p")!;
    expect(darkParagraph.style.backgroundColor).not.toBe("white");
    expect(darkParagraph.style.color).not.toBe("black");
    themeState.theme = "light";
    rerender(<EmailRenderer html={html} text={null} />);
    const lightParagraph = iframe.contentDocument!.querySelector("p")!;
    expect(lightParagraph.style.backgroundColor).toBe("white");
    expect(lightParagraph.style.color).toBe("black");
  });

  it("honors the sender's light-only opt-out", () => {
    themeState.theme = "dark";
    const { container } = render(<EmailRenderer
      html={'<meta name="color-scheme" content="light only"><p style="color: black; background: white">Hello</p>'}
      text={null}
    />);
    expect(container.querySelector("iframe")!.contentDocument!.querySelector("p")!.style.color).toBe("black");
  });

  it("updates open emails when the system theme changes", () => {
    themeState.theme = "system";
    const query = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.mocked(window.matchMedia).mockReturnValue(query as unknown as MediaQueryList);
    const { container, unmount } = render(<EmailRenderer html='<p style="color: black">Hello</p>' text={null} />);
    const doc = () => container.querySelector("iframe")!.contentDocument!;
    expect(doc().querySelector("p")!.style.color).toBe("black");
    const onChange = query.addEventListener.mock.calls[0]![1] as () => void;
    act(() => { query.matches = true; onChange(); });
    expect(doc().querySelector("p")!.style.color).not.toBe("black");
    act(() => { query.matches = false; onChange(); });
    expect(doc().querySelector("p")!.style.color).toBe("black");
    unmount();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", onChange);
  });

  it("renders plain text when no html provided", () => {
    const { container } = render(
      <EmailRenderer html={null} text="Hello world" />,
    );
    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("renders html content in iframe", () => {
    const { container } = render(
      <EmailRenderer html="<p>Hello</p>" text={null} />,
    );
    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("saves trust from a message and applies a later revocation", async () => {
    const props = {
      html: '<img src="https://example.com/image.png" alt="Example" />',
      text: null,
      blockImages: true,
      senderAddress: "sender@example.com",
      accountId: "acc-1",
    };
    const { rerender } = render(<EmailRenderer {...props} senderAllowlisted={false} />);
    expect(screen.queryByText(/Images hidden to protect your privacy/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Images hidden")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Always load from sender" })));
    expect(addToAllowlist).toHaveBeenCalledWith("acc-1", "sender@example.com");
    rerender(<EmailRenderer {...props} senderAllowlisted />);
    expect(screen.queryByRole("button", { name: "Load images" })).not.toBeInTheDocument();
    rerender(<EmailRenderer {...props} senderAllowlisted={false} />);
    expect(screen.getByRole("button", { name: "Load images" })).toBeInTheDocument();
  });

  it("resolves cid: references by fetching inline attachment data", async () => {
    const base64Data = btoa("fake-image-data");
    mockFetchAttachment.mockResolvedValue({ data: base64Data, size: 100 });

    const inlineAttachments = [makeAttachment()];

    const { container } = render(
      <EmailRenderer
        html='<img src="cid:icon@example.com" />'
        text={null}
        accountId="acc-1"
        messageId="msg-1"
        inlineAttachments={inlineAttachments}
      />,
    );

    await waitFor(() => {
      expect(mockFetchAttachment).toHaveBeenCalledWith("msg-1", "gmail-att-1");
    });

    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("skips cid resolution when no inline attachments", () => {
    render(
      <EmailRenderer
        html='<img src="cid:missing@example.com" />'
        text={null}
        accountId="acc-1"
        messageId="msg-1"
        inlineAttachments={[]}
      />,
    );

    expect(mockFetchAttachment).not.toHaveBeenCalled();
  });

  it("skips cid resolution when accountId or messageId missing", () => {
    const inlineAttachments = [makeAttachment()];

    render(
      <EmailRenderer
        html='<img src="cid:icon@example.com" />'
        text={null}
        inlineAttachments={inlineAttachments}
      />,
    );

    expect(mockFetchAttachment).not.toHaveBeenCalled();
  });

  it("handles fetch failure gracefully", async () => {
    mockFetchAttachment.mockRejectedValue(new Error("Network error"));

    const inlineAttachments = [makeAttachment()];

    const { container } = render(
      <EmailRenderer
        html='<img src="cid:icon@example.com" />'
        text={null}
        accountId="acc-1"
        messageId="msg-1"
        inlineAttachments={inlineAttachments}
      />,
    );

    await waitFor(() => {
      expect(mockFetchAttachment).toHaveBeenCalled();
    });

    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("resolves multiple cid references", async () => {
    mockFetchAttachment
      .mockResolvedValueOnce({ data: btoa("img1"), size: 50 })
      .mockResolvedValueOnce({ data: btoa("img2"), size: 60 });

    const inlineAttachments = [
      makeAttachment({ id: "att-1", content_id: "img1@ex.com", gmail_attachment_id: "g1" }),
      makeAttachment({ id: "att-2", content_id: "img2@ex.com", gmail_attachment_id: "g2", mime_type: "image/jpeg" }),
    ];

    render(
      <EmailRenderer
        html='<img src="cid:img1@ex.com" /><img src="cid:img2@ex.com" />'
        text={null}
        accountId="acc-1"
        messageId="msg-1"
        inlineAttachments={inlineAttachments}
      />,
    );

    await waitFor(() => {
      expect(mockFetchAttachment).toHaveBeenCalledTimes(2);
      expect(mockFetchAttachment).toHaveBeenCalledWith("msg-1", "g1");
      expect(mockFetchAttachment).toHaveBeenCalledWith("msg-1", "g2");
    });
  });

  it("ignores attachments without content_id or gmail_attachment_id", () => {
    const inlineAttachments = [
      makeAttachment({ content_id: null }),
      makeAttachment({ id: "att-2", gmail_attachment_id: null }),
    ];

    render(
      <EmailRenderer
        html='<img src="cid:icon@example.com" />'
        text={null}
        accountId="acc-1"
        messageId="msg-1"
        inlineAttachments={inlineAttachments}
      />,
    );

    expect(mockFetchAttachment).not.toHaveBeenCalled();
  });
});
