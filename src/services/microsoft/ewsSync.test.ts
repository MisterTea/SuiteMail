import { describe, expect, it, vi } from "vitest";
import { syncEwsAccount } from "./ewsSync";
import { ewsSyncPage } from "./ewsCommands";
import { updateAccountSyncState } from "../db/accounts";

vi.mock("../db/accounts", () => ({
  getAccount: vi.fn().mockResolvedValue({ email: "mail@example.com", history_id: null }),
  updateAccountSyncState: vi.fn(), clearAccountHistoryId: vi.fn(),
}));
vi.mock("../db/labels", () => ({ getLabelsForAccount: vi.fn(), upsertLabel: vi.fn() }));
vi.mock("../oauth/oauthTokenManager", () => ({ ensureFreshToken: vi.fn().mockResolvedValue("token") }));
vi.mock("./ewsCommands", () => ({ ewsListFolders: vi.fn().mockResolvedValue([]), ewsSyncPage: vi.fn(), isEwsSyncReset: vi.fn().mockReturnValue(false) }));
vi.mock("./graphSync", () => ({ storeGraphPage: vi.fn().mockResolvedValue(40) }));
vi.mock("../db/settings", () => ({ getSetting: vi.fn().mockResolvedValue("365") }));

describe("EWS progressive sync", () => {
  it("refreshes saved mail before fetching the next page", async () => {
    let pages = 0;
    vi.mocked(ewsSyncPage).mockImplementation(async () => {
      pages += 1;
      if (pages === 2) {
        expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "suitemail-sync-progress" }));
        expect(updateAccountSyncState).toHaveBeenCalledWith("account", "checkpoint-1");
      }
      return { messages: [], removedIds: [], checkpoint: `checkpoint-${pages}`, caughtUp: pages === 2 };
    });
    const events = vi.spyOn(window, "dispatchEvent");
    try {
      await syncEwsAccount("account");
      expect(pages).toBe(2);
      expect(events).toHaveBeenCalledTimes(2);
    } finally { events.mockRestore(); }
  });
});
