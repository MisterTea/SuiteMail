import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: vi.fn(() => ({ isOnline: true, setPendingOpsCount: vi.fn() })),
  },
}));

vi.mock("../db/pendingOperations", () => ({
  getPendingOperations: vi.fn(() => Promise.resolve([])),
  updateOperationStatus: vi.fn(() => Promise.resolve()),
  deleteOperation: vi.fn(() => Promise.resolve()),
  incrementRetry: vi.fn(() => Promise.resolve()),
  getPendingOpsCount: vi.fn(() => Promise.resolve(0)),
  compactQueue: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("../emailActions", () => ({
  executeQueuedAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/utils/networkErrors", () => ({
  classifyError: vi.fn(() => ({
    type: "permanent",
    isRetryable: false,
    message: "error",
  })),
}));

vi.mock("../backgroundCheckers", () => ({
  createBackgroundChecker: vi.fn((_name: string, fn: () => Promise<void>) => ({
    start: () => fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("../sync/outgoingSyncGuard", () => ({
  checkOutgoingSyncAllowed: vi.fn().mockResolvedValue(true),
  buildOutgoingSyncRequest: vi.fn((params) => ({
    accountId: params.accountId,
    items: params.items,
    title: params.title,
    description: params.description,
    summary: { total: params.items.length },
  })),
  LARGE_DIFF_THRESHOLD: 5,
}));

const mockBatchModify = vi.fn(() => Promise.resolve());
vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(() => Promise.resolve({ id: "acct-1", provider: "imap" })),
}));
vi.mock("../db/messages", () => ({
  getMessageIdsForThreads: vi.fn((_account: string, threadIds: string[]) =>
    Promise.resolve(new Map(threadIds.map((id) => [id, [`${id}-m1`, `${id}-m2`]])))),
}));
vi.mock("../gmail/tokenManager", () => ({
  getGmailClient: vi.fn(() => Promise.resolve({ batchModifyMessages: mockBatchModify })),
}));

import { useUIStore } from "@/stores/uiStore";
import { getAccount } from "../db/accounts";
import {
  getPendingOperations,
  updateOperationStatus,
  deleteOperation,
  incrementRetry,
  compactQueue,
} from "../db/pendingOperations";
import { executeQueuedAction } from "../emailActions";
import { classifyError } from "@/utils/networkErrors";
import { checkOutgoingSyncAllowed } from "../sync/outgoingSyncGuard";
import { startQueueProcessor, stopQueueProcessor, triggerQueueFlush } from "./queueProcessor";
import { createMockUIStoreState } from "@/test/mocks";

const mockSetPendingOpsCount = vi.fn();

describe("queueProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({
      setPendingOpsCount: mockSetPendingOpsCount,
    }) as never);
    vi.mocked(getPendingOperations).mockResolvedValue([]);
  });

  it("skips processing when offline", async () => {
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({
      isOnline: false,
      setPendingOpsCount: mockSetPendingOpsCount,
    }) as never);
    await triggerQueueFlush();
    expect(getPendingOperations).not.toHaveBeenCalled();
  });

  it("compacts queue before processing", async () => {
    await triggerQueueFlush();
    expect(compactQueue).toHaveBeenCalled();
  });

  it("processes pending operations successfully", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "executing");
    expect(executeQueuedAction).toHaveBeenCalledWith("acct-1", "archive", {
      threadId: "t1",
      messageIds: [],
    });
    expect(deleteOperation).toHaveBeenCalledWith("op-1");
  });

  it("retries on retryable errors", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "star",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[],"starred":true}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.mocked(classifyError).mockReturnValueOnce({
      type: "network",
      isRetryable: true,
      message: "Failed to fetch",
    });

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "pending", "Failed to fetch");
    expect(incrementRetry).toHaveBeenCalledWith("op-1");
    expect(deleteOperation).not.toHaveBeenCalled();
  });

  it("marks as failed on permanent errors", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Bad request"));
    vi.mocked(classifyError).mockReturnValueOnce({
      type: "permanent",
      isRetryable: false,
      message: "Bad request",
    });

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "failed", "Bad request");
  });

  it("updates pending count after processing", async () => {
    await triggerQueueFlush();
    expect(mockSetPendingOpsCount).toHaveBeenCalledWith(0);
  });

  it("prompts for confirmation and pauses queue execution if user cancels when ops >= LARGE_DIFF_THRESHOLD", async () => {
    const ops = Array.from({ length: 5 }, (_, i) => ({
      id: `op-${i}`,
      account_id: "acct-1",
      operation_type: "archive" as const,
      resource_id: `t-${i}`,
      params: `{"threadId":"t-${i}","messageIds":[]}`,
      status: "pending" as const,
      retry_count: 0,
      max_retries: 10,
      next_retry_at: null,
      created_at: 1000,
      error_message: null,
    }));
    vi.mocked(getPendingOperations).mockResolvedValueOnce(ops);
    vi.mocked(checkOutgoingSyncAllowed).mockResolvedValueOnce(false);

    await triggerQueueFlush();

    expect(checkOutgoingSyncAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct-1",
        items: expect.arrayContaining([
          expect.objectContaining({ id: "op-0" }),
        ]),
      }),
    );
    // Should NOT execute queued actions because user cancelled
    expect(executeQueuedAction).not.toHaveBeenCalled();
    expect(deleteOperation).not.toHaveBeenCalled();
  });

  it("proceeds with queue execution when user confirms large outgoing diff", async () => {
    const ops = Array.from({ length: 5 }, (_, i) => ({
      id: `op-${i}`,
      account_id: "acct-1",
      operation_type: "archive" as const,
      resource_id: `t-${i}`,
      params: `{"threadId":"t-${i}","messageIds":[]}`,
      status: "pending" as const,
      retry_count: 0,
      max_retries: 10,
      next_retry_at: null,
      created_at: 1000,
      error_message: null,
    }));
    vi.mocked(getPendingOperations).mockResolvedValueOnce(ops);
    vi.mocked(checkOutgoingSyncAllowed).mockResolvedValueOnce(true);

    await triggerQueueFlush();

    expect(checkOutgoingSyncAllowed).toHaveBeenCalled();
    expect(executeQueuedAction).toHaveBeenCalledTimes(5);
    expect(deleteOperation).toHaveBeenCalledTimes(5);
  });

  it("start and stop work without errors", () => {
    startQueueProcessor();
    stopQueueProcessor();
  });
});

describe("queueProcessor Gmail batchModify grouping", () => {
  const op = (id: string, type: string, threadId: string, params: Record<string, unknown> = {}) => ({
    id,
    account_id: "acct-1",
    operation_type: type,
    resource_id: threadId,
    params: JSON.stringify({ threadId, messageIds: [], ...params }),
    status: "pending" as const,
    retry_count: 0,
    max_retries: 10,
    next_retry_at: null,
    created_at: 1000,
    error_message: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({ setPendingOpsCount: vi.fn() }) as never);
    vi.mocked(getAccount).mockResolvedValue({ id: "acct-1", provider: "gmail_api" } as never);
  });

  it("sends same-effect label edits as one batchModify per group and runs the rest one by one", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      op("a1", "archive", "t1"), op("a2", "archive", "t2"), op("a3", "archive", "t3"),
      op("r1", "markRead", "t4", { read: true }), op("r2", "markRead", "t5", { read: true }),
      op("s1", "star", "t6", { starred: true }), // alone: stays threads.modify
      op("d1", "trash", "t7"), op("d2", "trash", "t8"), // not a plain label edit
    ] as never);

    await triggerQueueFlush();

    expect(mockBatchModify).toHaveBeenCalledTimes(2);
    expect(mockBatchModify).toHaveBeenCalledWith(["t1-m1", "t1-m2", "t2-m1", "t2-m2", "t3-m1", "t3-m2"], undefined, ["INBOX"]);
    expect(mockBatchModify).toHaveBeenCalledWith(["t4-m1", "t4-m2", "t5-m1", "t5-m2"], undefined, ["UNREAD"]);
    expect(vi.mocked(executeQueuedAction).mock.calls.map(([, type, params]) => [type, (params as { threadId: string }).threadId]))
      .toEqual([["star", "t6"], ["trash", "t7"], ["trash", "t8"]]);
    for (const id of ["a1", "a2", "a3", "r1", "r2", "s1", "d1", "d2"]) expect(deleteOperation).toHaveBeenCalledWith(id);
  });

  it("keeps per-thread order by not grouping a thread with several queued ops", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      op("a1", "archive", "t1"), op("a2", "archive", "t2"), op("u1", "addLabel", "t1", { labelId: "INBOX" }),
    ] as never);

    await triggerQueueFlush();

    expect(mockBatchModify).not.toHaveBeenCalled();
    expect(vi.mocked(executeQueuedAction).mock.calls.map(([, type, params]) => [type, (params as { threadId: string }).threadId]))
      .toEqual([["archive", "t1"], ["archive", "t2"], ["addLabel", "t1"]]);
  });

  it("records a failed group for retry on every operation in it", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([op("a1", "archive", "t1"), op("a2", "archive", "t2")] as never);
    mockBatchModify.mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.mocked(classifyError).mockReturnValue({ type: "network", isRetryable: true, message: "Failed to fetch" });

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("a1", "pending", "Failed to fetch");
    expect(updateOperationStatus).toHaveBeenCalledWith("a2", "pending", "Failed to fetch");
    expect(incrementRetry).toHaveBeenCalledTimes(2);
    expect(deleteOperation).not.toHaveBeenCalled();
    expect(executeQueuedAction).not.toHaveBeenCalled();
  });

  it("leaves non-Gmail accounts on the per-thread path", async () => {
    vi.mocked(getAccount).mockResolvedValue({ id: "acct-1", provider: "imap" } as never);
    vi.mocked(getPendingOperations).mockResolvedValueOnce([op("a1", "archive", "t1"), op("a2", "archive", "t2")] as never);

    await triggerQueueFlush();

    expect(mockBatchModify).not.toHaveBeenCalled();
    expect(executeQueuedAction).toHaveBeenCalledTimes(2);
  });
});
