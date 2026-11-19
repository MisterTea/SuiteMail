import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkOutgoingSyncAllowed,
  buildOutgoingSyncRequest,
  isServerToAppSyncAllowed,
  LARGE_DIFF_THRESHOLD,
} from "./outgoingSyncGuard";
import { useOutgoingSyncStore } from "@/stores/outgoingSyncStore";

describe("outgoingSyncGuard", () => {
  beforeEach(() => {
    useOutgoingSyncStore.getState().reset();
  });

  it("server-to-app sync is always permitted", () => {
    expect(isServerToAppSyncAllowed()).toBe(true);
  });

  it("buildOutgoingSyncRequest computes accurate summaries by type", () => {
    const request = buildOutgoingSyncRequest({
      accountId: "acc-1",
      items: [
        { id: "1", type: "label", summary: "Label 1" },
        { id: "2", type: "label", summary: "Label 2" },
        { id: "3", type: "archive", summary: "Archive 1" },
        { id: "4", type: "trash", summary: "Trash 1" },
        { id: "5", type: "spam", summary: "Spam 1" },
        { id: "6", type: "metadata", summary: "Metadata 1" },
      ],
    });

    expect(request.summary.total).toBe(6);
    expect(request.summary.labelsCount).toBe(2);
    expect(request.summary.archiveCount).toBe(1);
    expect(request.summary.trashCount).toBe(1);
    expect(request.summary.spamCount).toBe(1);
    expect(request.summary.metadataCount).toBe(1);
  });

  it("allows outgoing sync without prompt when items count is below threshold and not first sync", async () => {
    const request = buildOutgoingSyncRequest({
      accountId: "acc-1",
      isFirstSync: false,
      items: [
        { id: "1", type: "archive", summary: "Archive 1" },
      ],
    });

    const allowed = await checkOutgoingSyncAllowed(request);
    expect(allowed).toBe(true);
    expect(useOutgoingSyncStore.getState().isOpen).toBe(false);
  });

  it("requires confirmation when items count reaches LARGE_DIFF_THRESHOLD", async () => {
    const items = Array.from({ length: LARGE_DIFF_THRESHOLD }, (_, i) => ({
      id: `item-${i}`,
      type: "label" as const,
      summary: `Label ${i}`,
    }));

    const request = buildOutgoingSyncRequest({
      accountId: "acc-1",
      items,
    });

    const checkPromise = checkOutgoingSyncAllowed(request);
    expect(useOutgoingSyncStore.getState().isOpen).toBe(true);
    expect(useOutgoingSyncStore.getState().activeRequest?.items.length).toBe(LARGE_DIFF_THRESHOLD);

    useOutgoingSyncStore.getState().confirm();

    const allowed = await checkCheckPromise(checkPromise);
    expect(allowed).toBe(true);
  });

  it("requires confirmation on first sync even with fewer items than threshold", async () => {
    const request = buildOutgoingSyncRequest({
      accountId: "acc-1",
      isFirstSync: true,
      items: [
        { id: "1", type: "label", summary: "Label on first sync" },
      ],
    });

    const checkPromise = checkOutgoingSyncAllowed(request);
    expect(useOutgoingSyncStore.getState().isOpen).toBe(true);

    useOutgoingSyncStore.getState().cancel();

    const allowed = await checkCheckPromise(checkPromise);
    expect(allowed).toBe(false);
  });
});

async function checkCheckPromise(promise: Promise<boolean>): Promise<boolean> {
  return await promise;
}
