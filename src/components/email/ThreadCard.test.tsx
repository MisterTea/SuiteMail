import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThreadCard } from "./ThreadCard";
import type { Thread } from "@/stores/threadStore";

const mockArchiveThread = vi.fn();
const mockStarThread = vi.fn();
const mockPinThread = vi.fn();
const mockUnpinThread = vi.fn();

vi.mock("@/services/emailActions", () => ({
  archiveThread: (...args: unknown[]) => mockArchiveThread(...args),
  starThread: (...args: unknown[]) => mockStarThread(...args),
}));

vi.mock("@/services/db/threads", () => ({
  pinThread: (...args: unknown[]) => mockPinThread(...args),
  unpinThread: (...args: unknown[]) => mockUnpinThread(...args),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
  }),
}));

vi.mock("@/stores/threadStore", () => ({
  useThreadStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        selectedThreadIds: new Set(),
        toggleThreadSelection: vi.fn(),
        selectThreadRange: vi.fn(),
        updateThread: vi.fn(),
        searchQuery: "",
      }),
    { getState: () => ({ selectedThreadIds: new Set(), updateThread: vi.fn() }) },
  ),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ emailDensity: "default" }),
}));

vi.mock("@/hooks/useRouteNavigation", () => ({
  useActiveLabel: () => "inbox",
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    accountId: "a1",
    subject: "Test subject",
    snippet: "Test snippet",
    lastMessageAt: Date.now(),
    messageCount: 1,
    isRead: false,
    isStarred: false,
    isPinned: false,
    isMuted: false,
    hasAttachments: false,
    labelIds: ["INBOX"],
    fromName: "Alice",
    fromAddress: "alice@example.com",
    ...overrides,
  };
}

describe("ThreadCard", () => {
  const onClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sender name and subject", () => {
    render(<ThreadCard thread={makeThread()} isSelected={false} onClick={onClick} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Test subject")).toBeInTheDocument();
  });

  it("applies red background for spam threads", () => {
    const { container } = render(
      <ThreadCard
        thread={makeThread({ labelIds: ["SPAM"] })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    const button = container.querySelector("button")!;
    expect(button.className).toContain("bg-red-500/8");
  });

  it("does not apply red background for non-spam threads", () => {
    const { container } = render(
      <ThreadCard
        thread={makeThread({ labelIds: ["INBOX"] })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    const button = container.querySelector("button")!;
    expect(button.className).not.toContain("bg-red-500");
  });

  it("applies red background for spam even when thread has other labels", () => {
    const { container } = render(
      <ThreadCard
        thread={makeThread({ labelIds: ["INBOX", "SPAM", "IMPORTANT"] })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    const button = container.querySelector("button")!;
    expect(button.className).toContain("bg-red-500/8");
  });

  it("renders pinned badge and accent left border when thread is pinned", () => {
    const { container } = render(
      <ThreadCard
        thread={makeThread({ isPinned: true })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    const button = container.querySelector("button")!;
    expect(button.className).toContain("border-l-accent");
    expect(button.className).toContain("bg-accent/[0.03]");
  });

  it("renders Draft badge and italic styling for draft threads", () => {
    const { container } = render(
      <ThreadCard
        thread={makeThread({ labelIds: ["DRAFT"] })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    expect(screen.getByTestId("draft-badge")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    const subjectEl = container.querySelector(".italic");
    expect(subjectEl).toBeInTheDocument();
    expect(subjectEl?.textContent).toContain("Test subject");
  });

  it("triggers archive when swiped left past threshold", async () => {
    const { container } = render(
      <ThreadCard thread={makeThread()} isSelected={false} onClick={onClick} />,
    );
    const button = container.querySelector("button")!;

    fireEvent.touchStart(button, { touches: [{ clientX: 200 }] });
    fireEvent.touchMove(button, { touches: [{ clientX: 100 }] }); // -100px swipe
    fireEvent.touchEnd(button);

    await waitFor(() => {
      expect(mockArchiveThread).toHaveBeenCalledWith("a1", "t1", expect.any(Array));
    });
  });

  it("triggers star when swiped right past threshold", async () => {
    const { container } = render(
      <ThreadCard thread={makeThread({ isStarred: false })} isSelected={false} onClick={onClick} />,
    );
    const button = container.querySelector("button")!;

    fireEvent.touchStart(button, { touches: [{ clientX: 100 }] });
    fireEvent.touchMove(button, { touches: [{ clientX: 200 }] }); // +100px swipe
    fireEvent.touchEnd(button);

    await waitFor(() => {
      expect(mockStarThread).toHaveBeenCalledWith("a1", "t1", expect.any(Array), true);
    });
  });

  it("renders unread dot indicator and distinct styles when thread is unread", () => {
    const { container } = render(
      <ThreadCard thread={makeThread({ isRead: false })} isSelected={false} onClick={onClick} />,
    );
    expect(screen.getByTestId("unread-dot")).toBeInTheDocument();
    const button = container.querySelector("button")!;
    expect(button.className).toContain("border-l-accent");
    expect(button.className).toContain("bg-bg-primary");
  });

  it("does not render unread dot indicator and uses neutral styling when thread is read", () => {
    const { container } = render(
      <ThreadCard thread={makeThread({ isRead: true })} isSelected={false} onClick={onClick} />,
    );
    expect(screen.queryByTestId("unread-dot")).not.toBeInTheDocument();
    const button = container.querySelector("button")!;
    expect(button.className).toContain("border-l-transparent");
    expect(button.className).toContain("bg-transparent");
  });

  it("toggles star when star button is clicked without triggering card onClick", async () => {
    render(
      <ThreadCard
        thread={makeThread({ isStarred: false })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    const starBtn = screen.getByRole("button", { name: "Star" });
    expect(starBtn).toBeInTheDocument();
    expect(starBtn).toHaveAttribute("title", "Star (s)");

    fireEvent.click(starBtn);

    await waitFor(() => {
      expect(mockStarThread).toHaveBeenCalledWith("a1", "t1", expect.any(Array), true);
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders unstar title and toggles star off when thread is already starred", async () => {
    render(
      <ThreadCard
        thread={makeThread({ isStarred: true })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    const starBtn = screen.getByRole("button", { name: "Unstar" });
    expect(starBtn).toBeInTheDocument();
    expect(starBtn).toHaveAttribute("title", "Unstar (s)");

    fireEvent.click(starBtn);

    await waitFor(() => {
      expect(mockStarThread).toHaveBeenCalledWith("a1", "t1", expect.any(Array), false);
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("toggles pin on when pin button is clicked without triggering card onClick", async () => {
    render(
      <ThreadCard
        thread={makeThread({ isPinned: false })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    const pinBtn = screen.getByRole("button", { name: "Pin thread" });
    expect(pinBtn).toBeInTheDocument();
    expect(pinBtn).toHaveAttribute("title", "Pin thread");

    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(mockPinThread).toHaveBeenCalledWith("a1", "t1");
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders unpin title and toggles pin off when thread is already pinned", async () => {
    render(
      <ThreadCard
        thread={makeThread({ isPinned: true })}
        isSelected={false}
        onClick={onClick}
      />,
    );
    const pinBtn = screen.getByRole("button", { name: "Unpin thread" });
    expect(pinBtn).toBeInTheDocument();
    expect(pinBtn).toHaveAttribute("title", "Unpin thread");

    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(mockUnpinThread).toHaveBeenCalledWith("a1", "t1");
    });
    expect(onClick).not.toHaveBeenCalled();
  });
});
