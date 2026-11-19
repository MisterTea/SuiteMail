import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PackageTrackingCard } from "./PackageTrackingCard";
import type { PackageTrackingItem } from "@/utils/trackingDetector";
import { platformOpenUrl } from "@/platform";

vi.mock("@/platform", () => ({
  platformOpenUrl: vi.fn(),
}));

describe("PackageTrackingCard", () => {
  it("renders nothing when items list is empty", () => {
    const { container } = render(<PackageTrackingCard items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders carrier, tracking number, and track button", () => {
    const items: PackageTrackingItem[] = [
      {
        carrier: "UPS",
        trackingNumber: "1Z1234567890123456",
        trackingUrl: "https://www.ups.com/track?tracknum=1Z1234567890123456",
        label: "UPS Shipment",
      },
    ];

    render(<PackageTrackingCard items={items} />);
    expect(screen.getByText("UPS Shipment")).toBeInTheDocument();
    expect(screen.getByText("1Z1234567890123456")).toBeInTheDocument();
    expect(screen.getByText("Track")).toBeInTheDocument();
  });

  it("calls openUrl when track button is clicked", async () => {
    const items: PackageTrackingItem[] = [
      {
        carrier: "Flight",
        trackingNumber: "XYZ123",
        trackingUrl: "https://google.com/search?q=flight+XYZ123",
        label: "Flight Confirmation",
      },
    ];

    render(<PackageTrackingCard items={items} />);
    const trackBtn = screen.getByText("Track Flight");
    fireEvent.click(trackBtn);

    expect(platformOpenUrl).toHaveBeenCalledWith("https://google.com/search?q=flight+XYZ123");
  });
});
