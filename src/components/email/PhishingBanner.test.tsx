import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhishingBanner } from "./PhishingBanner";
import type { MessageScanResult } from "@/utils/phishingDetector";

const mockScanResult: MessageScanResult = {
  messageId: "msg-123",
  links: [
    {
      url: "http://suspicious-bank-login.xyz",
      displayText: "Verify your bank",
      riskScore: 75,
      riskLevel: "high",
      triggeredRules: [
        {
          ruleId: "lookalike",
          name: "Lookalike Domain",
          score: 75,
          detail: "Lookalike bank domain detected",
        },
      ],
    },
  ],
  maxRiskScore: 75,
  suspiciousLinkCount: 1,
  showBanner: true,
  scannedAt: Date.now(),
};

describe("PhishingBanner", () => {
  it("renders high risk warning and count", () => {
    render(<PhishingBanner scanResult={mockScanResult} onTrustSender={vi.fn()} />);

    expect(screen.getByText("High risk links detected")).toBeInTheDocument();
    expect(screen.getByText(/1 suspicious link found/)).toBeInTheDocument();
    expect(screen.getByText("Critical Threat")).toBeInTheDocument();
  });

  it("calls onTrustSender when Trust this sender button is clicked", () => {
    const onTrust = vi.fn();
    render(<PhishingBanner scanResult={mockScanResult} onTrustSender={onTrust} />);

    const trustBtn = screen.getByRole("button", { name: /Trust this sender/i });
    fireEvent.click(trustBtn);
    expect(onTrust).toHaveBeenCalledTimes(1);
  });

  it("calls onReportSpam when Report Spam is clicked", () => {
    const onReportSpam = vi.fn();
    render(
      <PhishingBanner
        scanResult={mockScanResult}
        onTrustSender={vi.fn()}
        onReportSpam={onReportSpam}
      />,
    );

    const spamBtn = screen.getByRole("button", { name: /Report Spam/i });
    fireEvent.click(spamBtn);
    expect(onReportSpam).toHaveBeenCalledTimes(1);
  });

  it("toggles link inspection details", () => {
    render(<PhishingBanner scanResult={mockScanResult} onTrustSender={vi.fn()} />);

    const toggle = screen.getByText("Inspect flagged links");
    expect(screen.queryByText("Flagged Link Targets:")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Flagged Link Targets:")).toBeInTheDocument();
    expect(screen.getByText(/suspicious-bank-login\.xyz/)).toBeInTheDocument();
  });
});
