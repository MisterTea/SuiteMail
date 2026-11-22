import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { AddressInput } from "./AddressInput";

// Mock the contacts search
const mockSearchContacts = vi.fn().mockResolvedValue([]);
vi.mock("@/services/db/contacts", () => ({
  searchContacts: (...args: unknown[]) => mockSearchContacts(...args),
}));

describe("AddressInput debounce behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchContacts.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not search immediately on input change", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });
    fireEvent.change(input, { target: { value: "jo" } });

    // Should NOT have searched yet (debounce not elapsed)
    expect(mockSearchContacts).not.toHaveBeenCalled();
  });

  it("should search after debounce period", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });
    fireEvent.change(input, { target: { value: "jo" } });

    // Advance past 200ms debounce
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(mockSearchContacts).toHaveBeenCalledWith("jo", 5);
  });

  it("should not search when input is too short", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });
    fireEvent.change(input, { target: { value: "j" } });

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(mockSearchContacts).not.toHaveBeenCalled();
  });

  it("should debounce rapid keystrokes", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });

    // Simulate rapid typing — each keystroke resets the debounce
    fireEvent.change(input, { target: { value: "jo" } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(input, { target: { value: "joh" } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(input, { target: { value: "john" } });

    // At this point 200ms haven't passed since the last change
    expect(mockSearchContacts).not.toHaveBeenCalled();

    // Now advance past debounce from last keystroke
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(mockSearchContacts).toHaveBeenCalledTimes(1);
    expect(mockSearchContacts).toHaveBeenCalledWith("john", 5);
  });
  it("commits on blur without stealing focus from Subject", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<><AddressInput label="To" addresses={[]} onChange={onChange} /><input aria-label="Subject" /></>);
    const recipient = getByRole("textbox", { name: "To" });
    const subject = getByRole("textbox", { name: "Subject" });
    act(() => { recipient.focus(); });
    fireEvent.change(recipient, { target: { value: "person@example.com" } });
    act(() => { subject.focus(); });
    expect(onChange).toHaveBeenCalledWith(["person@example.com"]);
    expect(document.activeElement).toBe(subject);
  });

  it("leaves an invalid recipient editable and announces the error", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<AddressInput label="To" addresses={[]} onChange={onChange} />);
    const recipient = getByRole("textbox", { name: "To" });
    fireEvent.change(recipient, { target: { value: "invalid" } });
    fireEvent.keyDown(recipient, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(getByRole("alert").textContent).toBe("Enter a valid email address");
    expect(recipient).toHaveValue("invalid");
  });

  it("allows Tab traversal when the recipient field is empty", () => {
    const { getByRole } = render(<AddressInput label="To" addresses={[]} onChange={vi.fn()} />);
    expect(fireEvent.keyDown(getByRole("textbox", { name: "To" }), { key: "Tab" })).toBe(true);
  });

});
