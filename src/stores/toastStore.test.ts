import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useToastStore } from "./toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().dismissToast();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets currentToast when showToast is called", () => {
    useToastStore.getState().showToast({
      message: "Conversation archived",
      duration: 3000,
    });

    const toast = useToastStore.getState().currentToast;
    expect(toast).not.toBeNull();
    expect(toast?.message).toBe("Conversation archived");
    expect(toast?.duration).toBe(3000);
  });

  it("auto-dismisses toast after duration", () => {
    useToastStore.getState().showToast({
      message: "Item archived",
      duration: 2000,
    });

    expect(useToastStore.getState().currentToast?.message).toBe("Item archived");

    vi.advanceTimersByTime(2000);

    expect(useToastStore.getState().currentToast).toBeNull();
  });

  it("dismissToast immediately clears toast", () => {
    useToastStore.getState().showToast({
      message: "Test message",
      duration: 5000,
    });

    useToastStore.getState().dismissToast();
    expect(useToastStore.getState().currentToast).toBeNull();
  });

  it("overrides previous toast and resets timer", () => {
    useToastStore.getState().showToast({
      message: "First toast",
      duration: 4000,
    });

    vi.advanceTimersByTime(2000);

    useToastStore.getState().showToast({
      message: "Second toast",
      duration: 4000,
    });

    expect(useToastStore.getState().currentToast?.message).toBe("Second toast");

    vi.advanceTimersByTime(2000);
    // 4000ms total from start, but second toast still has 2000ms left
    expect(useToastStore.getState().currentToast?.message).toBe("Second toast");

    vi.advanceTimersByTime(2000);
    expect(useToastStore.getState().currentToast).toBeNull();
  });
});
