import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackingPixelBadge } from "./TrackingPixelBadge";

describe("TrackingPixelBadge", () => {
  it("renders nothing when trackers list is empty", () => {
    const { container } = render(<TrackingPixelBadge trackers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders badge with provider name when 1 tracker detected", () => {
    render(
      <TrackingPixelBadge
        trackers={[{ provider: "Mailchimp", url: "https://mandrillapp.com/track/123" }]}
      />,
    );
    expect(screen.getByText("Blocked: Mailchimp")).toBeInTheDocument();
  });

  it("opens popover with details on click", () => {
    render(
      <TrackingPixelBadge
        trackers={[
          { provider: "Superhuman", url: "https://superhuman.com/track/456" },
          { provider: "HubSpot", url: "https://t.sidekickopen.com/789" },
        ]}
      />,
    );
    expect(screen.getByText("2 Trackers Blocked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Email Tracking Blocked")).toBeInTheDocument();
    expect(screen.getByText("Superhuman")).toBeInTheDocument();
    expect(screen.getByText("HubSpot")).toBeInTheDocument();
  });
});
