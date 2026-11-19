import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useOutgoingSyncStore,
  requestOutgoingSyncConfirmation,
  type OutgoingSyncRequest,
} from "./outgoingSyncStore";

describe("outgoingSyncStore", () => {
  const sampleRequest: OutgoingSyncRequest = {
    accountId: "acc-1",
    accountEmail: "user@example.com",
    title: "Confirm Outgoing Sync",
    description: "Large outgoing diff detected.",
    items: [
      { id: "t1", type: "label", summary: "Set labels to [INBOX, Work]" },
      { id: "t2", type: "archive", summary: "Archive conversation" },
    ],
    summary: {
      total: 2,
      labelsCount: 1,
      archiveCount: 1,
    },
  };

  beforeEach(() => {
    useOutgoingSyncStore.getState().reset();
  });

  it("starts in a closed state with no active request", () => {
    const state = useOutgoingSyncStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeRequest).toBeNull();
  });

  it("opens popover on requestConfirmation and resolves true when confirm() is called", async () => {
    const promise = requestOutgoingSyncConfirmation(sampleRequest);

    const state = useOutgoingSyncStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeRequest).toEqual(sampleRequest);

    useOutgoingSyncStore.getState().confirm();

    const result = await promise;
    expect(result).toBe(true);
    expect(useOutgoingSyncStore.getState().isOpen).toBe(false);
    expect(useOutgoingSyncStore.getState().activeRequest).toBeNull();
  });

  it("resolves false when cancel() is called", async () => {
    const promise = requestOutgoingSyncConfirmation(sampleRequest);

    expect(useOutgoingSyncStore.getState().isOpen).toBe(true);

    useOutgoingSyncStore.getState().cancel();

    const result = await promise;
    expect(result).toBe(false);
    expect(useOutgoingSyncStore.getState().isOpen).toBe(false);
  });

  it("auto-cancels a previous pending request when a new request arrives", async () => {
    const promise1 = requestOutgoingSyncConfirmation(sampleRequest);

    const nextRequest: OutgoingSyncRequest = {
      ...sampleRequest,
      title: "Second Request",
    };
    const promise2 = requestOutgoingSyncConfirmation(nextRequest);

    const result1 = await promise1;
    expect(result1).toBe(false);

    useOutgoingSyncStore.getState().confirm();
    const result2 = await promise2;
    expect(result2).toBe(true);
  });
});
