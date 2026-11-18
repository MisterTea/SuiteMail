import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EmptyState } from "./EmptyState";
import { InboxClearIllustration, InboxZeroIllustration } from "./illustrations";
import { Mail } from "lucide-react";

describe("EmptyState", () => {
  it("renders title and subtitle", () => {
    render(
      <EmptyState
        title="You're all caught up"
        subtitle="No new conversations — enjoy your day!"
      />,
    );

    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByText("No new conversations — enjoy your day!")).toBeInTheDocument();
  });

  it("renders celebratory badge when provided", () => {
    render(
      <EmptyState
        title="Inbox Zero"
        badge="Inbox Zero"
      />,
    );

    expect(screen.getByText("Inbox Zero", { selector: "span" })).toBeInTheDocument();
  });

  it("renders illustration when provided", () => {
    const { container } = render(
      <EmptyState
        illustration={InboxClearIllustration}
        title="Empty"
      />,
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    const { container } = render(
      <EmptyState
        icon={Mail}
        title="No emails"
      />,
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("exports InboxZeroIllustration matching InboxClearIllustration", () => {
    expect(InboxZeroIllustration).toBe(InboxClearIllustration);
  });
});
