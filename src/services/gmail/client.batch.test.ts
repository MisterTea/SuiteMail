import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GmailClient, buildBatchBody, parseBatchResponse } from "./client";
import { FakeGmail } from "../../../e2e/fakeGmail";

vi.mock("./quota", async (importOriginal) => ({
  ...await importOriginal<typeof import("./quota")>(),
  waitForGmailQuota: vi.fn().mockResolvedValue(undefined),
  pauseGmailQuota: vi.fn(),
}));
vi.mock("./auth", () => ({ refreshAccessToken: vi.fn() }));
vi.mock("../db/connection", () => ({ getDb: vi.fn().mockResolvedValue({ execute: vi.fn(), select: vi.fn() }) }));

import { waitForGmailQuota } from "./quota";

function useFakeGmail(gmail: FakeGmail) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const response = gmail.handle(init.method ?? "GET", String(input), headers, typeof init.body === "string" ? init.body : "");
    return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: response.headers });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const newClient = () => new GmailClient("batch", "client", { accessToken: "token", refreshToken: "refresh", expiresAt: 9_999_999_999 });

describe("Gmail batch requests", () => {
  let gmail: FakeGmail;
  beforeEach(() => {
    gmail = new FakeGmail();
    gmail.seed({ threadCount: 120, recentThreads: 10, now: Date.parse("2026-11-20T00:00:00Z") });
    vi.mocked(waitForGmailQuota).mockClear();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("builds a multipart body Gmail accepts and parses the multipart reply", () => {
    const body = buildBatchBody("b1", [
      { id: "item-0", path: "/threads/t1?format=metadata" },
      { id: "item-1", method: "POST", path: "/threads/t2/modify", body: { removeLabelIds: ["INBOX"] } },
    ]);
    expect(body).toBe(
      "--b1\r\nContent-Type: application/http\r\nContent-ID: <item-0>\r\n\r\nGET /gmail/v1/users/me/threads/t1?format=metadata\r\n\r\n" +
      "--b1\r\nContent-Type: application/http\r\nContent-ID: <item-1>\r\n\r\nPOST /gmail/v1/users/me/threads/t2/modify\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{\"removeLabelIds\":[\"INBOX\"]}\r\n\r\n" +
      "--b1--\r\n",
    );
    const reply = "--batch_x\r\nContent-Type: application/http\r\nContent-ID: <response-item-1>\r\n\r\nHTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\r\n{\"error\":{\"code\":404}}\r\n" +
      "--batch_x\r\nContent-Type: application/http\r\nContent-ID: <response-item-0>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"id\":\"t1\"}\r\n--batch_x--\r\n";
    const parsed = parseBatchResponse('multipart/mixed; boundary="batch_x"', reply);
    expect(parsed.get("item-0")).toEqual({ status: 200, body: '{"id":"t1"}' });
    expect(parsed.get("item-1")).toEqual({ status: 404, body: '{"error":{"code":404}}' });
    expect(parseBatchResponse("", reply).get("item-0")?.status).toBe(200);
  });

  it("caps a batch at 50 calls and returns results in order", async () => {
    const fetcher = useFakeGmail(gmail);
    const ids = [...gmail.messages.keys()].slice(0, 60);
    const messages = await newClient().getMessages(ids, "minimal"); // 20 units each
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(gmail.calls).toHaveLength(60);
    expect([...messages.keys()]).toEqual(ids);
    expect(messages.get(ids[0]!)?.id).toBe(ids[0]);
    // Quota is reserved for the calls inside the batch, not the batch POST itself.
    expect(vi.mocked(waitForGmailQuota).mock.calls.map(([, cost]) => cost)).toEqual([50 * 20, 10 * 20]);
  });

  it("splits a batch so no single request costs more than the quota burst", async () => {
    const fetcher = useFakeGmail(gmail);
    const metadata = await newClient().getThreads(gmail.threadIds().slice(0, 30), "metadata");
    expect(metadata.size).toBe(30);
    expect(fetcher).toHaveBeenCalledTimes(2); // 40 units each → 25 + 5
    fetcher.mockClear();
    vi.mocked(waitForGmailQuota).mockClear();
    await newClient().getThreads(gmail.threadIds().slice(0, 20), "full");
    // 120 units each: 8 per request fit in the 1,000-unit burst.
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.mocked(waitForGmailQuota).mock.calls.map(([, cost]) => cost)).toEqual([960, 960, 480]);
  });

  it("returns per-call failures without failing the rest, mapping 404 to null", async () => {
    useFakeGmail(gmail);
    const [first, second] = gmail.threadIds();
    const client = newClient();
    const results = await client.batch([{ path: `/threads/${first}?format=minimal` }, { path: "/threads/missing?format=minimal" }, { path: `/messages/${second}?format=minimal` }]);
    expect(results.map((r) => r.status)).toEqual([200, 404, 200]);
    expect(results[1]!.error?.status).toBe(404);
    const threads = await client.getThreads([first!, "missing"], "minimal");
    expect(threads.get("missing")).toBeNull();
    expect(threads.get(first!)?.id).toBe(first);
  });

  it("retries only the calls rate-limited inside a batch", async () => {
    vi.useFakeTimers();
    const fetcher = useFakeGmail(gmail);
    gmail.batchRateLimitEvery = 4; // every 4th call in a batch gets 429
    const ids = gmail.threadIds().slice(0, 10);
    const pending = newClient().getThreads(ids, "minimal");
    await vi.runAllTimersAsync();
    const threads = await pending;
    expect([...threads.values()].every((t) => t && t.messages.length > 0)).toBe(true);
    // First request: 10 calls, 2 limited. Retry: those 2 calls only (one of which is the 12th sub-request → limited again).
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(gmail.calls.filter((c) => c.path.includes("/threads/")).length).toBeLessThanOrEqual(10 + 2 + 1);
  });

  it("reports calls that stay rate-limited after the retries", async () => {
    vi.useFakeTimers();
    useFakeGmail(gmail);
    gmail.batchRateLimitEvery = 1; // everything is limited
    const pending = newClient().batch([{ path: "/profile" }, { path: "/labels" }]);
    await vi.runAllTimersAsync();
    const results = await pending;
    expect(results.map((r) => r.status)).toEqual([429, 429]);
    await expect(Promise.reject(results[0]!.error)).rejects.toThrow("429");
  });

  it("refreshes an expired token once and resends the batch", async () => {
    const native = vi.fn().mockResolvedValue({ accessToken: "fresh", expiresAt: 9_999_999_999 });
    const client = new GmailClient("batch401", "", { accessToken: "stale", refreshToken: "", expiresAt: 9_999_999_999 }, undefined, native);
    const ok = useFakeGmail(gmail);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) =>
      new Headers(init.headers).get("Authorization") === "Bearer stale" ? new Response("", { status: 401 }) : ok(input, init));
    vi.stubGlobal("fetch", fetcher);
    const results = await client.batch([{ path: "/profile" }, { path: "/labels" }]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(native).toHaveBeenCalledWith("stale");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesces thread label changes made together into one batch request", async () => {
    const fetcher = useFakeGmail(gmail);
    const client = newClient();
    const ids = gmail.threadIds().slice(0, 5);
    const results = await Promise.all([
      ...ids.map((id) => client.modifyThread(id, undefined, ["INBOX"])),
      client.modifyThread("missing", ["STARRED"]).catch((error) => error),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.slice(0, 5).map((r) => (r as { id: string }).id)).toEqual(ids);
    expect(String(results[5])).toContain("404");
    for (const id of ids) expect(gmail.threadMessages(id).some((m) => m.labelIds.includes("INBOX"))).toBe(false);
  });

  it("sends a lone label change as a plain threads.modify", async () => {
    const fetcher = useFakeGmail(gmail);
    const id = gmail.threadIds()[0]!;
    await newClient().modifyThread(id, ["STARRED"]);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`/threads/${id}/modify`), expect.anything());
  });

  it("splits batchModify at 1,000 message IDs", async () => {
    const fetcher = useFakeGmail(gmail);
    const ids = [...gmail.messages.keys()];
    const many = Array.from({ length: 1500 }, (_, i) => ids[i % ids.length]! + (i >= ids.length ? `-${i}` : ""));
    await newClient().batchModifyMessages(many, undefined, ["INBOX"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init!.body)) as { ids: string[] });
    expect(bodies.map((b) => b.ids.length)).toEqual([1000, 500]);
    expect(gmail.messages.get(ids[0]!)!.labelIds).not.toContain("INBOX");
  });
});
