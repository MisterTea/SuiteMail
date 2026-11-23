import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../router/navigate", () => ({ navigateToLabel: vi.fn() }));
import { showAndFocusMainWindow } from "./notificationManager";

const originalBridge = window.supermail;
afterEach(() => { window.supermail = originalBridge; vi.restoreAllMocks(); });

describe("notification window activation", () => {
  it("asks the desktop shell to restore a background window", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    window.supermail = { isElectron: true, invoke };
    await showAndFocusMainWindow();
    expect(invoke).toHaveBeenCalledWith("show_main_window");
    expect(focus).not.toHaveBeenCalled();
  });
  it("focuses the browser window in web environments", async () => {
    window.supermail = undefined;
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    await showAndFocusMainWindow();
    expect(focus).toHaveBeenCalledOnce();
  });
});
