import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleSendDialog } from "./ScheduleSendDialog";

describe("ScheduleSendDialog", () => {
  it("renders presets and recurrence options", () => {
    const onSchedule = vi.fn();
    const onClose = vi.fn();

    render(<ScheduleSendDialog onSchedule={onSchedule} onClose={onClose} />);

    expect(screen.getByText("Schedule send")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow morning")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow afternoon")).toBeInTheDocument();
    expect(screen.getByText("Monday morning")).toBeInTheDocument();
    expect(screen.getByText("Repeat")).toBeInTheDocument();
  });

  it("calls onSchedule with timestamp and null recurrence by default", () => {
    const onSchedule = vi.fn();
    const onClose = vi.fn();

    render(<ScheduleSendDialog onSchedule={onSchedule} onClose={onClose} />);

    fireEvent.click(screen.getByText("Tomorrow morning"));
    expect(onSchedule).toHaveBeenCalledWith(expect.any(Number), null);
  });

  it("calls onSchedule with recurrence when selected", () => {
    const onSchedule = vi.fn();
    const onClose = vi.fn();

    render(<ScheduleSendDialog onSchedule={onSchedule} onClose={onClose} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "weekly" } });

    fireEvent.click(screen.getByText("Monday morning"));
    expect(onSchedule).toHaveBeenCalledWith(expect.any(Number), "weekly");
  });
});
