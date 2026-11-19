import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_PI_SERVER_URL,
  ensureLlamaServer,
  ipv4LoopbackUrl,
  LLAMA_SERVER_PORT,
} from "./llamaServer";

const fetchMock = vi.fn();
const invokeMock = vi.fn();
const setSettingMock = vi.fn(async () => {});
const settings = new Map<string, string>();

vi.mock("@/platform", () => ({
  platformFetch: (...args: unknown[]) => fetchMock(...args),
  platformInvoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  setSetting: (...args: unknown[]) => setSettingMock(...args),
}));

describe("ipv4LoopbackUrl", () => {
  it("rewrites localhost to 127.0.0.1", () => {
    expect(ipv4LoopbackUrl("http://localhost:3000")).toBe("http://127.0.0.1:3000");
    expect(ipv4LoopbackUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });
});

describe("ensureLlamaServer", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    invokeMock.mockReset();
    setSettingMock.mockClear();
    settings.clear();
    settings.set("pi_model", "gemma-4-e4b");
    settings.set("pi_server_url", "http://localhost:3000");
  });

  it("moves a saved port-3000 default onto the dedicated port", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "gemma-4-e4b" }] }), { status: 200 }),
    );

    await expect(ensureLlamaServer()).resolves.toBe(DEFAULT_PI_SERVER_URL);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:${LLAMA_SERVER_PORT}/v1/models`);
    expect(setSettingMock).toHaveBeenCalledWith("pi_server_url", DEFAULT_PI_SERVER_URL);
  });

  it("keeps a port-3000 URL after that default has already been migrated", async () => {
    settings.set("pi_server_port_migrated_off_3000", "1");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "gemma-4-e4b" }] }), { status: 200 }),
    );

    await expect(ensureLlamaServer()).resolves.toBe("http://127.0.0.1:3000");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/v1/models");
  });

  it("starts llama-server when the port is closed", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    invokeMock.mockResolvedValueOnce({
      running: true,
      base_url: "http://127.0.0.1:3000",
      model: "gemma-4-e4b",
    });

    await expect(ensureLlamaServer("http://localhost:3000")).resolves.toBe(
      "http://127.0.0.1:3000",
    );
    expect(invokeMock).toHaveBeenCalledWith("start_llama_server", {
      modelId: "gemma-4-e4b",
      port: 3000,
    });
  });

  it("reports a startup failure instead of a bare connection error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    invokeMock.mockRejectedValueOnce(new Error("No local Gemma weights found for \"gemma-4-e4b\"."));

    await expect(ensureLlamaServer()).rejects.toThrow(
      new RegExp(`127\\.0\\.0\\.1:${LLAMA_SERVER_PORT}[\\s\\S]*Gemma weights`),
    );
  });
});
