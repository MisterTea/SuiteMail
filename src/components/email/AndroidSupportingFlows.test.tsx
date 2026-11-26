import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthWarningBanner } from "./AuthWarningBanner";
import { ScheduleSendDialog } from "../composer/ScheduleSendDialog";
vi.mock("@/hooks/useNativePhone", () => ({ useNativePhone: () => true }));
const authResults = JSON.stringify({ aggregate: "fail", spf: { result: "fail" }, dkim: { result: "fail" }, dmarc: { result: "fail" } });
describe("Android supporting flows", () => {
  it("requires explicit confirmation before trusting and has one spam action", () => {
    const trust = vi.fn();
    render(<AuthWarningBanner authResults={authResults} senderAddress="sender@example.com" onDismiss={vi.fn()} onReportSpam={vi.fn()} onTrustSender={trust} />);
    expect(screen.queryByRole("button", { name: "Move to Spam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trust sender…" }));
    expect(trust).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trust).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Trust sender…" }));
    fireEvent.click(screen.getByRole("button", { name: "Trust sender" }));
    expect(trust).toHaveBeenCalledOnce();
  });
  it("warns that scheduling needs the open app and rejects past custom times", () => {
    const schedule = vi.fn();
    render(<ScheduleSendDialog onSchedule={schedule} onClose={vi.fn()} />);
    expect(screen.getByText(/Keep SuiteMail open and connected/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Custom delivery date and time"), { target: { value: "2020-01-01T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Send" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a future date and time");
    expect(schedule).not.toHaveBeenCalled();
  });
});
