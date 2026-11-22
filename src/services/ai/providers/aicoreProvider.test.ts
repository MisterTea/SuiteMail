import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPlatformInvoke = vi.fn();

vi.mock("@/platform", () => ({
  platformInvoke: (...args: unknown[]) => mockPlatformInvoke(...args),
}));

import { createAiCoreProvider, clearAiCoreProvider } from "./aicoreProvider";

describe("aicoreProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAiCoreProvider();
  });

  describe("createAiCoreProvider", () => {
    it("uses FULL preference by default", async () => {
      mockPlatformInvoke.mockResolvedValue("Generated output");
      const provider = createAiCoreProvider();

      const result = await provider.complete({
        systemPrompt: "You are a helpful assistant",
        userContent: "Hello",
      });

      expect(mockPlatformInvoke).toHaveBeenCalledWith("aicore_generate", {
        systemPrompt: "You are a helpful assistant",
        prompt: "Hello",
        model: "full",
      });
      expect(result).toBe("Generated output");
    });

    it("uses FULL preference even with a legacy model name", async () => {
      mockPlatformInvoke.mockResolvedValue("Nano response");
      const provider = createAiCoreProvider("gemini-nano");

      const result = await provider.complete({
        systemPrompt: "System",
        userContent: "User prompt",
      });

      expect(mockPlatformInvoke).toHaveBeenCalledWith("aicore_generate", {
        systemPrompt: "System",
        prompt: "User prompt",
        model: "full",
      });
      expect(result).toBe("Nano response");
    });

    it("reuses client instance for the same model", () => {
      const p1 = createAiCoreProvider("gemma-4-26b");
      const p2 = createAiCoreProvider("gemma-4-26b");
      expect(p1).toBe(p2);
    });

    it("reuses FULL client for legacy model names", () => {
      const p1 = createAiCoreProvider("gemma-4-26b");
      const p2 = createAiCoreProvider("gemini-nano");
      expect(p1).toBe(p2);
    });
  });

  describe("testConnection", () => {
    it("returns true when aicore_is_available reports available", async () => {
      mockPlatformInvoke.mockResolvedValue({ available: true, supported_models: ["gemma-4-26b"] });
      const provider = createAiCoreProvider();

      const ok = await provider.testConnection();
      expect(mockPlatformInvoke).toHaveBeenCalledWith("aicore_is_available");
      expect(ok).toBe(true);
    });

    it("returns false when aicore_is_available reports unavailable", async () => {
      mockPlatformInvoke.mockResolvedValue({ available: false, supported_models: [] });
      const provider = createAiCoreProvider();

      const ok = await provider.testConnection();
      expect(ok).toBe(false);
    });

    it("returns false when invoke throws an error", async () => {
      mockPlatformInvoke.mockRejectedValue(new Error("Command not supported"));
      const provider = createAiCoreProvider();

      const ok = await provider.testConnection();
      expect(ok).toBe(false);
    });
  });

  describe("error handling", () => {
    it("wraps completion errors in an Error with descriptive message", async () => {
      mockPlatformInvoke.mockRejectedValue(new Error("Out of memory on NPU"));
      const provider = createAiCoreProvider();

      await expect(
        provider.complete({ systemPrompt: "S", userContent: "U" }),
      ).rejects.toThrow("AICore on-device generation failed: Out of memory on NPU");
    });
  });
});
