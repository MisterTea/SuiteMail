import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackButton } from "./FeedbackButton";
import { BUGCATCHER_URL, submitFeedbackIssue } from "./feedback-service";

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.supermail;
});

describe("feedback reports", () => {
  it("captures before opening and submits a feature with screenshot to SuiteLeaf's collector", async () => {
    const screenshot = "data:image/png;base64,c2NyZWVuc2hvdA==";
    window.supermail = { captureScreenshot: vi.fn(async () => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      return screenshot;
    }) };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, number: 42 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Report bug or request feature" }));
    await screen.findByRole("dialog");
    expect(screen.getByAltText("Screenshot of current application window")).toHaveAttribute("src", screenshot);
    fireEvent.click(screen.getByLabelText("New feature"));
    fireEvent.change(screen.getByLabelText("Feature Details"), { target: { value: "  Add shared labels  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText(/filed as #42/);
    expect(fetchMock).toHaveBeenCalledWith(`${BUGCATCHER_URL}/report`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ type: "feature", text: "Add shared labels", screenshot, context: `SuperMail · ${location.pathname} · ${navigator.userAgent}` }),
    }));
  });

  it("rejects empty descriptions and reports collector/network failures", async () => {
    const fetchMock = vi.fn();
    expect(await submitFeedbackIssue({ type: "bug", text: " " }, fetchMock)).toMatchObject({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "Try later" }) });
    expect(await submitFeedbackIssue({ type: "bug", text: "Broken" }, fetchMock)).toEqual({ success: false, error: "Try later" });
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await submitFeedbackIssue({ type: "bug", text: "Broken" }, fetchMock)).toMatchObject({ success: false, error: expect.stringContaining("Could not reach") });
  });

  it("keeps the report available for retry after a failed submission", async () => {
    window.supermail = { captureScreenshot: vi.fn().mockResolvedValue("data:image/png;base64,c2NyZWVuc2hvdA==") };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Report bug or request feature" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please write a description");
    fireEvent.change(screen.getByLabelText("Bug Details"), { target: { value: "Sync stopped" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not reach"));
    expect(screen.getByLabelText("Bug Details")).toHaveValue("Sync stopped");
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});
