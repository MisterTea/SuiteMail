import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useAndroidMobile } from "@/hooks/useAndroidMobile";
vi.mock("@/hooks/useAndroidMobile", () => ({ useAndroidMobile: vi.fn(() => false) }));
import { FilterEditor } from "./FilterEditor";
import { useAccountStore } from "@/stores/accountStore";

vi.mock("@/services/db/filters", () => ({
  getFiltersForAccount: vi.fn().mockResolvedValue([]),
  addFilterChangeListener: vi.fn().mockReturnValue(() => {}),
  insertFilter: vi.fn(),
  updateFilter: vi.fn(),
  deleteFilter: vi.fn(),
}));
vi.mock("@/services/db/labels", () => ({
  getLabelsForAccount: vi.fn().mockResolvedValue([]),
  ensureLabelOrFolder: vi.fn(),
}));
vi.mock("@/services/ai/piEmailAgent", () => ({
  suggestFilterWithPiAgent: vi.fn(),
}));
vi.mock("@/services/filters/filterEngine", () => ({
  getAffectedEmailsForFilter: vi.fn(),
  applyFilterActionsToThreads: vi.fn(),
}));

describe("FilterEditor creation buttons", () => {
  beforeEach(() => {
    vi.mocked(useAndroidMobile).mockReturnValue(false);
    useAccountStore.setState({ activeAccountId: "account-1" });
  });

  it.each([
    ["Suggest filter with Pi Agent", "AI Filter Assistant"],
    ["+ Add filter", "Create Filter Manually"],
  ])("opens %s without an app-shell event listener", async (button, title) => {
    render(<FilterEditor />);
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(await screen.findByRole("dialog", { name: title })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it.each([
    ["Create filter manually", "Create Filter Manually"],
    ["Create filter with AI", "AI Filter Assistant"],
  ])("opens the explicit Android choice %s", async (button, title) => {
    vi.mocked(useAndroidMobile).mockReturnValue(true);
    render(<FilterEditor />);
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(await screen.findByRole("dialog", { name: title })).toBeVisible();
  });

});
