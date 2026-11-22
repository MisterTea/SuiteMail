import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { platformInvoke } from "@/platform";
import { hostAiFetch, isAndroidEmulator, resolveOllamaServerUrl } from "./androidHostAi";
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: vi.fn() }, CapacitorHttp: { request: vi.fn() } }));
vi.mock("@/platform", () => ({ platformInvoke: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Capacitor.getPlatform).mockReturnValue("android");
  vi.mocked(platformInvoke).mockResolvedValue({ isEmulator: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("Android emulator host AI", () => {
  it.each([null, "http://localhost:11434", "http://127.0.0.1:11434"])("resolves %s to host Ollama", async (saved) => {
    expect(await resolveOllamaServerUrl(saved)).toBe("http://10.0.2.2:11434");
  });
  it("preserves the LM Studio port and API path", async () => {
    expect(await resolveOllamaServerUrl("http://localhost:1234/proxy")).toBe("http://10.0.2.2:1234/proxy");
  });
  it("preserves explicitly configured server addresses", async () => {
    expect(await resolveOllamaServerUrl("http://192.168.1.2:1234")).toBe("http://192.168.1.2:1234");
  });
  it("does not identify physical Android phones as emulators", async () => {
    vi.mocked(platformInvoke).mockResolvedValue({ isEmulator: false });
    expect(await isAndroidEmulator()).toBe(false);
    expect(await resolveOllamaServerUrl("http://localhost:1234")).toBe("http://localhost:1234");
  });
  it("leaves desktop defaults alone without calling Android", async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue("web");
    vi.stubGlobal("navigator", { userAgent: "Desktop" });
    expect(await resolveOllamaServerUrl(null)).toBe("http://localhost:11434");
    expect(platformInvoke).not.toHaveBeenCalled();
  });
  it("fails closed if emulator detection is unavailable", async () => {
    vi.mocked(platformInvoke).mockRejectedValue(new Error("unknown command"));
    expect(await isAndroidEmulator()).toBe(false);
  });
  it("sends completions through native HTTP with intact JSON and status", async () => {
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 200, data: '{"choices":[]}', headers: { "content-type": "application/json" }, url: "" });
    const body = JSON.stringify({ model: "host-model", messages: [{ role: "user", content: "Hello" }] });
    const response = await hostAiFetch("http://10.0.2.2:1234/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(CapacitorHttp.request).toHaveBeenCalledWith(expect.objectContaining({ url: "http://10.0.2.2:1234/v1/chat/completions", method: "POST", data: body }));
    expect(await response.json()).toEqual({ choices: [] });
  });
  it("preserves HTTP errors for the AI client", async () => {
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 404, data: '{"error":"model not found"}', headers: {}, url: "" });
    expect((await hostAiFetch("http://10.0.2.2:11434/v1/models")).status).toBe(404);
  });
});
