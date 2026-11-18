import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SnoozeDialog } from "./SnoozeDialog";

describe("SnoozeDialog", () => {
  it("renders title and all 5 preset rows when open", () => {
    render(
      <SnoozeDialog
        isOpen={true}
        onSnooze={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Snooze until...")).toBeInTheDocument();
    expect(screen.getByText("Later today")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow morning")).toBeInTheDocument();
    expect(screen.getByText("This weekend")).toBeInTheDocument();
    expect(screen.getByText("Next week")).toBeInTheDocument();
    expect(screen.getByText("Custom date & time")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <SnoozeDialog
        isOpen={false}
        onSnooze={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("Snooze until...")).not.toBeInTheDocument();
  });

  it("calls onSnooze when Tomorrow morning preset is clicked", () => {
    const onSnooze = vi.fn();
    render(
      <SnoozeDialog
        isOpen={true}
        onSnooze={onSnooze}
        onClose={() => {}}
      />,
    );
    const tomorrowBtn = screen.getByText("Tomorrow morning");
    fireEvent.click(tomorrowBtn);
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(typeof onSnooze.mock.calls[0][0]).toBe("number");
    expect(onSnooze.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it("calls onClose when Close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <SnoozeDialog
        isOpen={true}
        onSnooze={() => {}}
        onClose={onClose}
      />,
    );
    const closeBtn = screen.getByLabelText("Close");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders mobile drag handle", () => {
    render(
      <SnoozeDialog
        isOpen={true}
        onSnooze={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText("Drag down to dismiss")).toBeInTheDocument();
  });

  it("expands custom date & time picker when Custom row is clicked", () => {
    render(
      <SnoozeDialog
        isOpen={true}
        onSnooze={() => {}}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();

    const customRow = screen.getByText("Custom date & time");
    fireEvent.click(customRow);

    const dateInput = document.querySelector('input[type="date"]');
    const timeInput = document.querySelector('input[type="time"]');
    expect(dateInput).toBeInTheDocument();
    expect(timeInput).toBeInTheDocument();
  });

  it("submits custom date and time on Snooze button click", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 15, 10, 0, 0));

    const onSnooze = vi.fn();
    render(
      <SnoozeDialog
        isOpen={true}
        onSnooze={onSnooze}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Custom date & time"));

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;

    fireEvent.change(dateInput, { target: { value: "2025-02-01" } });
    fireEvent.change(timeInput, { target: { value: "14:30" } });

    const snoozeSubmit = screen.getByRole("button", { name: /^snooze$/i });
    fireEvent.click(snoozeSubmit);

    expect(onSnooze).toHaveBeenCalledTimes(1);
    const timestamp = onSnooze.mock.calls[0][0] as number;
    const date = new Date(timestamp * 1000);
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(1); // February
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(30);

    vi.useRealTimers();
  });

  it("closes when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(
      <SnoozeDialog
        isOpen={true}
        onSnooze={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
