import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all dependencies before importing the module under test
vi.mock("./tokenManager", () => ({
  getGmailClient: vi.fn(),
}));
vi.mock("./sync", () => ({
  syncInitialChanges: vi.fn().mockResolvedValue(undefined),
  initialSync: vi.fn(),
  deltaSync: vi.fn(),
  backfillBodies: vi.fn().mockResolvedValue(0),
  BODY_PREFETCH_DAYS: 30,
}));
vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(),
  clearAccountHistoryId: vi.fn(),
}));
vi.mock("../db/settings", () => ({
  getSetting: vi.fn().mockResolvedValue("365"),
}));
vi.mock("../db/threads", () => ({
  getThreadCountForAccount: vi.fn(),
  deleteAllThreadsForAccount: vi.fn(),
}));
vi.mock("../db/messages", () => ({
  deleteAllMessagesForAccount: vi.fn(),
}));
vi.mock("../imap/imapSync", () => ({
  imapInitialSync: vi.fn(),
  imapDeltaSync: vi.fn(),
}));
vi.mock("../db/folderSyncState", () => ({
  clearAllFolderSyncStates: vi.fn(),
}));
vi.mock("../oauth/oauthTokenManager", () => ({
  ensureFreshToken: vi.fn(),
}));
vi.mock("../calendar/providerFactory", () => ({
  hasCalendarSupport: vi.fn().mockResolvedValue(false),
  getCalendarProvider: vi.fn(),
}));
vi.mock("../db/calendars", () => ({
  getVisibleCalendars: vi.fn().mockResolvedValue([]),
  upsertCalendar: vi.fn(),
  updateCalendarSyncToken: vi.fn(),
}));
vi.mock("../db/calendarEvents", () => ({
  upsertCalendarEvent: vi.fn(),
  deleteEventByRemoteId: vi.fn(),
}));

// Import after mocks
import {
  syncAccount,
  startBackgroundSync,
  stopBackgroundSync,
  setAndroidSyncForeground,
  triggerSync,
  onSyncStatus,
} from "./syncManager";
import { getAccount } from "../db/accounts";
import { getGmailClient } from "./tokenManager";
import { backfillBodies } from "./sync";
import { GMAIL_BACKFILL_BUDGET_MS } from "./syncManager";
import { initialSync, deltaSync, syncInitialChanges } from "./sync";

const mockGetAccount = vi.mocked(getAccount);
const mockGetGmailClient = vi.mocked(getGmailClient);
const mockInitialSync = vi.mocked(initialSync);
const mockDeltaSync = vi.mocked(deltaSync);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeGmailAccount(id: string, historyId: string | null = null) {
  return {
    id,
    email: `${id}@gmail.com`,
    display_name: id,
    avatar_url: null,
    is_active: 1,
    provider: "gmail_api" as const,
    history_id: historyId,
    refresh_token: "tok",
    access_token: "tok",
    token_expiry: Date.now() + 60_000,
    client_id: "cid",
    client_secret: null,
    created_at: new Date().toISOString(),
    imap_host: null,
    imap_port: null,
    imap_security: null,
    smtp_host: null,
    smtp_port: null,
    smtp_security: null,
    auth_method: null,
    imap_password: null,
    imap_username: null,
  };
}

describe("syncManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopBackgroundSync();
    mockGetGmailClient.mockResolvedValue(
      {} as ReturnType<typeof getGmailClient> extends Promise<infer T>
        ? T
        : never,
    );
    mockInitialSync.mockResolvedValue();
    mockDeltaSync.mockResolvedValue();
  });

  afterEach(() => {
    stopBackgroundSync();
    setAndroidSyncForeground(undefined);
  });

  describe("syncAccount", () => {
    it("runs initial sync for an account without history_id", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1"));

      await syncAccount("a1");

      expect(mockInitialSync).toHaveBeenCalledTimes(1);
      expect(syncInitialChanges).toHaveBeenCalledWith(expect.anything(), "a1", expect.any(Function));
      expect(vi.mocked(syncInitialChanges).mock.invocationCallOrder[0]).toBeLessThan(mockInitialSync.mock.invocationCallOrder[0]!);
      expect(mockInitialSync).toHaveBeenCalledWith(expect.anything(), "a1", 365, undefined, {
        deadline: expect.any(Number),
        shouldStop: expect.any(Function),
        onMessagesStored: expect.any(Function),
      });
      expect(mockDeltaSync).not.toHaveBeenCalled();
    });

    it("bounds backfill by a time budget instead of a thread count", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1"));
      const before = Date.now();

      await syncAccount("a1");

      const { deadline } = mockInitialSync.mock.calls[0]![4] as { deadline: number };
      expect(deadline - before).toBeGreaterThanOrEqual(GMAIL_BACKFILL_BUDGET_MS - 50);
      expect(deadline - Date.now()).toBeLessThanOrEqual(GMAIL_BACKFILL_BUDGET_MS);
    });

    it("downloads bodies (recent mail first) only after the listing is complete", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1", "12345"));

      await syncAccount("a1");

      expect(mockDeltaSync).toHaveBeenCalledTimes(1);
      expect(backfillBodies).toHaveBeenCalledTimes(2);
      const [recent, all] = vi.mocked(backfillBodies).mock.calls.map((call) => call[2]!);
      expect(recent!.sinceMs).toBeGreaterThan(Date.now() - 31 * 86_400_000);
      expect(all!.sinceMs).toBeUndefined();
      expect(vi.mocked(backfillBodies).mock.invocationCallOrder[0]).toBeGreaterThan(mockDeltaSync.mock.invocationCallOrder[0]!);

      vi.mocked(backfillBodies).mockClear();
      mockGetAccount.mockResolvedValue(makeGmailAccount("a2"));
      await syncAccount("a2");
      expect(backfillBodies).not.toHaveBeenCalled(); // Listing still in progress (no history cursor yet).
    });

    it("runs delta sync for an account with history_id", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1", "12345"));

      await syncAccount("a1");

      expect(mockDeltaSync).toHaveBeenCalledTimes(1);
      expect(mockInitialSync).not.toHaveBeenCalled();
    });

    it("queues a second account while sync is in progress", async () => {
      const a1 = makeGmailAccount("a1", "100");
      const a2 = makeGmailAccount("a2", "200");

      mockGetAccount.mockImplementation(async (id: string) => {
        if (id === "a1") return a1;
        if (id === "a2") return a2;
        return null;
      });

      // Make first sync slow
      const barrier = new Promise<void>((r) => {
        // Resolve after 50ms
        setTimeout(r, 50);
      });
      let firstCall = true;
      mockDeltaSync.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return barrier;
        }
        return Promise.resolve();
      });

      const first = syncAccount("a1");
      // a2 will be queued since a1 is in progress
      const second = syncAccount("a2");

      await first;
      await second;

      // Both accounts synced (a1 directly, a2 via queue drain)
      expect(mockDeltaSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("startBackgroundSync", () => {
    it("polls fresh mail every minute while historical backfill is incomplete", async()=>{
      vi.useFakeTimers();
      try {
        mockGetAccount.mockResolvedValue(makeGmailAccount("a1"));
        startBackgroundSync(["a1"]);
        await vi.advanceTimersByTimeAsync(0);
        expect(syncInitialChanges).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(syncInitialChanges).toHaveBeenCalledTimes(2);
        expect(mockInitialSync).toHaveBeenCalledTimes(2);
      } finally { stopBackgroundSync();vi.useRealTimers(); }
    });
    it("triggers an immediate sync by default", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1", "100"));

      startBackgroundSync(["a1"]);

      // Wait for async sync chain to complete
      await wait(50);

      expect(mockDeltaSync).toHaveBeenCalledTimes(1);
    });

    it("skips immediate sync when skipImmediateSync is true", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1", "100"));

      startBackgroundSync(["a1"], true);

      // Wait — no sync should have fired (next interval is 60s away)
      await wait(50);

      expect(mockDeltaSync).not.toHaveBeenCalled();
      expect(mockGetAccount).not.toHaveBeenCalled();
    });
  });

  describe("new account sync priority", () => {
    it("new account syncs immediately when background sync skips immediate run", async () => {
      const existingAccount = makeGmailAccount("existing", "100");
      const newAccount = makeGmailAccount("new-acc");

      mockGetAccount.mockImplementation(async (id: string) => {
        if (id === "existing") return existingAccount;
        if (id === "new-acc") return newAccount;
        return null;
      });

      // Simulate the fix: sync new account first, then start background with skipImmediate
      const syncPromise = syncAccount("new-acc");
      startBackgroundSync(["existing", "new-acc"], true);

      await syncPromise;

      // The new account got an initial sync immediately
      expect(mockInitialSync).toHaveBeenCalledTimes(1);
      // No delta sync ran (background timer hasn't fired)
      expect(mockDeltaSync).not.toHaveBeenCalled();
    });

    it("without the fix, new account sync would be blocked by existing account sync", async () => {
      const existingAccount = makeGmailAccount("existing", "100");
      const newAccount = makeGmailAccount("new-acc");

      // Track the order of sync calls
      const syncOrder: string[] = [];

      mockGetAccount.mockImplementation(async (id: string) => {
        if (id === "existing") return existingAccount;
        if (id === "new-acc") return newAccount;
        return null;
      });

      mockDeltaSync.mockImplementation(async () => {
        syncOrder.push("delta-existing");
      });
      mockInitialSync.mockImplementation(async () => {
        syncOrder.push("initial-new");
      });

      // Old behavior: startBackgroundSync first (with immediate sync), then syncAccount
      // This would queue new-acc behind existing account's delta sync
      startBackgroundSync(["existing", "new-acc"]);

      // Wait for both to complete
      await wait(50);

      // existing account's delta sync ran BEFORE new account's initial sync
      expect(syncOrder).toEqual(["delta-existing", "initial-new"]);
    });
  });

  describe("triggerSync", () => {
    it("syncs all provided accounts", async () => {
      const a1 = makeGmailAccount("a1", "100");
      const a2 = makeGmailAccount("a2", "200");

      mockGetAccount.mockImplementation(async (id: string) => {
        if (id === "a1") return a1;
        if (id === "a2") return a2;
        return null;
      });

      await triggerSync(["a1", "a2"]);

      expect(mockDeltaSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("error coercion", () => {
    it("propagates plain string errors from Electron IPC (not 'Unknown error')", async () => {
      const account = makeGmailAccount("a1", "100");
      mockGetAccount.mockResolvedValue(account);
      // Electron IPC rejects with a plain string, not an Error instance
      mockDeltaSync.mockRejectedValue("authentication failed for user@test.com");

      const errors: string[] = [];
      const unsub = onSyncStatus((_id, status, _progress, error) => {
        if (status === "error" && error) errors.push(error);
      });

      await syncAccount("a1");
      unsub();

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe("authentication failed for user@test.com");
      expect(errors[0]).not.toBe("Unknown error");
    });

    it("handles null/undefined errors gracefully", async () => {
      const account = makeGmailAccount("a1", "100");
      mockGetAccount.mockResolvedValue(account);
      mockDeltaSync.mockRejectedValue(null);

      const errors: string[] = [];
      const unsub = onSyncStatus((_id, status, _progress, error) => {
        if (status === "error" && error) errors.push(error);
      });

      await syncAccount("a1");
      unsub();

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe("Unknown error");
    });
  });

  describe("Android foreground sync", () => {
    it.each([true, false])("retries one transport failure on resume (recovers: %s)", async (recovers) => {
      vi.useFakeTimers();
      const status = vi.fn();
      const unsubscribe = onSyncStatus(status);
      try {
        mockGetAccount.mockResolvedValue(makeGmailAccount("a1", "100"));
        mockDeltaSync.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        if (!recovers) mockDeltaSync.mockRejectedValueOnce(new Error("Connection timed out"));
        setAndroidSyncForeground(false);
        setAndroidSyncForeground(true);

        const finished = syncAccount("a1");
        await vi.advanceTimersByTimeAsync(0);
        expect(mockDeltaSync).toHaveBeenCalledTimes(1);
        expect(status.mock.calls.map(([, state]) => state)).toEqual(["syncing"]);

        await vi.advanceTimersByTimeAsync(1000);
        await finished;
        expect(mockDeltaSync).toHaveBeenCalledTimes(2);
        expect(status.mock.calls.map(([, state]) => state)).toEqual(["syncing", "syncing", recovers ? "done" : "error"]);
      } finally {
        unsubscribe();
        vi.useRealTimers();
      }
    });

    it("waits for the next foreground sync if a request is interrupted in the background", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1", "100"));
      const status = vi.fn();
      const unsubscribe = onSyncStatus(status);
      try {
        mockDeltaSync.mockImplementationOnce(async () => {
          setAndroidSyncForeground(false);
          throw new TypeError("Failed to fetch");
        });
        await syncAccount("a1");
        await syncAccount("a1");
        expect(mockDeltaSync).toHaveBeenCalledTimes(1);
        expect(status.mock.calls.map(([, state]) => state)).toEqual(["syncing", "interrupted"]);

        setAndroidSyncForeground(true);
        await syncAccount("a1");
        expect(mockDeltaSync).toHaveBeenCalledTimes(2);
        expect(status).toHaveBeenLastCalledWith("a1", "done");
      } finally {
        unsubscribe();
      }
    });

    it("reports an authentication error immediately after resume", async () => {
      mockGetAccount.mockResolvedValue(makeGmailAccount("a1", "100"));
      mockDeltaSync.mockRejectedValueOnce(new Error("Authentication failed"));
      const status = vi.fn();
      const unsubscribe = onSyncStatus(status);
      try {
        setAndroidSyncForeground(true);
        await syncAccount("a1");
        expect(mockDeltaSync).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenLastCalledWith("a1", "error", undefined, "Authentication failed");
      } finally {
        unsubscribe();
      }
    });
  });
});
