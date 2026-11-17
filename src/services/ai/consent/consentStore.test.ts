import { describe, it, expect, beforeEach } from "vitest";
import { useConsentStore, requestAgentConsent } from "./consentStore";
import type { ConsentRequest } from "./types";

describe("consentStore", () => {
  beforeEach(() => {
    useConsentStore.getState().reset();
  });

  it("initializes with closed state and no active request", () => {
    const state = useConsentStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeRequest).toBeNull();
    expect(state.resolveConsent).toBeNull();
  });

  it("opens modal and sets activeRequest when requestConsent is called", async () => {
    const mockRequest: ConsentRequest = {
      id: "req-1",
      type: "send_email",
      tool: "send_email",
      title: "Confirm Send",
      description: "Send email",
      args: { to: ["test@example.com"] },
    };

    const promise = requestAgentConsent(mockRequest);

    const state = useConsentStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeRequest).toEqual(mockRequest);
    expect(state.resolveConsent).not.toBeNull();

    // Approve
    useConsentStore.getState().approve();
    const result = await promise;
    expect(result).toBe(true);

    // After approval, closed and cleared
    const finalState = useConsentStore.getState();
    expect(finalState.isOpen).toBe(false);
    expect(finalState.activeRequest).toBeNull();
  });

  it("resolves to false when refuse is called", async () => {
    const mockRequest: ConsentRequest = {
      id: "req-2",
      type: "delete_emails",
      tool: "delete_emails",
      title: "Confirm Delete",
      description: "Delete email",
      args: { thread_ids: ["t-1"] },
    };

    const promise = requestAgentConsent(mockRequest);
    useConsentStore.getState().refuse();
    const result = await promise;

    expect(result).toBe(false);
    const finalState = useConsentStore.getState();
    expect(finalState.isOpen).toBe(false);
    expect(finalState.activeRequest).toBeNull();
  });

  it("handles new request while one is pending by rejecting previous", async () => {
    const req1: ConsentRequest = {
      id: "req-1",
      type: "send_email",
      tool: "send_email",
      title: "First",
      description: "First",
      args: {},
    };
    const req2: ConsentRequest = {
      id: "req-2",
      type: "move_emails",
      tool: "move_emails",
      title: "Second",
      description: "Second",
      args: {},
    };

    const promise1 = requestAgentConsent(req1);
    const promise2 = requestAgentConsent(req2);

    // promise1 should be rejected as false
    const res1 = await promise1;
    expect(res1).toBe(false);

    // Second request is active
    expect(useConsentStore.getState().activeRequest?.id).toBe("req-2");
    useConsentStore.getState().approve();

    const res2 = await promise2;
    expect(res2).toBe(true);
  });
});
