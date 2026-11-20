import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/services/imap/settingsSidecarSync", () => ({
  uploadFilterChangeForAccount: vi.fn(),
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
});
