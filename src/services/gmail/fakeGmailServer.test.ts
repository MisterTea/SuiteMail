// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeServer } from "../../../e2e/fakeServer";
import { buildBatchBody, parseBatchResponse } from "./client";

describe("FakeServer Gmail routes", () => {
  const server = new FakeServer(0);
  let base = "";
  beforeAll(async () => {
    server.gmail.seed({ threadCount: 30, recentThreads: 5, now: Date.parse("2026-11-20T00:00:00Z") });
    await server.start();
    base = `http://localhost:${(server as unknown as { server: { address(): { port: number } } }).server.address().port}`;
  });
  afterAll(() => server.stop());

  it("serves metadata thread lists, multipart batches and batchModify over HTTP", async () => {
    const list = await (await fetch(`${base}/gmail/v1/users/me/threads?maxResults=500`)).json() as { threads: Array<{ id: string }> };
    expect(list.threads).toHaveLength(30);
    const [a, b] = list.threads;
    const batch = await fetch(`${base}/batch/gmail/v1`, {
      method: "POST", headers: { "Content-Type": "multipart/mixed; boundary=x1" },
      body: buildBatchBody("x1", [{ id: "item-0", path: `/threads/${a!.id}?format=metadata` }, { id: "item-1", path: "/threads/nope?format=metadata" }]),
    });
    const parts = parseBatchResponse(batch.headers.get("content-type") ?? "", await batch.text());
    expect(parts.get("item-0")?.status).toBe(200);
    expect(JSON.parse(parts.get("item-0")!.body).messages[0].payload.body).toBeUndefined();
    expect(parts.get("item-1")?.status).toBe(404);
    const ids = server.gmail.threadMessages(b!.id).map((m) => m.id);
    const modified = await fetch(`${base}/gmail/v1/users/me/messages/batchModify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, removeLabelIds: ["INBOX"] }),
    });
    expect(modified.status).toBe(204);
    expect(server.gmail.threadMessages(b!.id).every((m) => !m.labelIds.includes("INBOX"))).toBe(true);
  });
});
