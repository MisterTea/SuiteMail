import { describe, it, expect, beforeEach, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  const MockOpenAI = vi.fn(function () {
    return { chat: { completions: { create: mockCreate } } };
  });
  return { default: MockOpenAI };
});

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

import OpenAI from "openai";
import { createPiProvider, clearPiProvider } from "./piProvider";

describe("piProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPiProvider();
  });

  describe("createPiProvider", () => {
    it("creates OpenAI client with custom baseURL and pi-harness apiKey for Gemma 4 e4b", () => {
      createPiProvider("http://localhost:3000", "gemma-4-e4b");

      expect(OpenAI).toHaveBeenCalledWith({
        baseURL: "http://127.0.0.1:3000/v1",
        apiKey: "pi-harness",
        dangerouslyAllowBrowser: true,
        fetch: expect.any(Function),
      });
    });

    it("strips trailing slashes from server URL", () => {
      createPiProvider("http://localhost:3000///", "gemma-4-e4b");

      expect(OpenAI).toHaveBeenCalledWith({
        baseURL: "http://127.0.0.1:3000/v1",
        apiKey: "pi-harness",
        dangerouslyAllowBrowser: true,
        fetch: expect.any(Function),
      });
    });
  });

  describe("complete", () => {
    it("calls chat.completions.create with gemma-4-e4b model and messages", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Here is the summary from Gemma 4 e4b." } }],
      });

      const provider = createPiProvider("http://localhost:3000", "gemma-4-e4b");
      const result = await provider.complete({
        systemPrompt: "Summarize this email",
        userContent: "Email content here",
      });

      expect(result).toBe("Here is the summary from Gemma 4 e4b.");
      expect(mockCreate).toHaveBeenCalledWith({
        model: "gemma-4-e4b",
        max_tokens: 1024,
        messages: [
          { role: "system", content: "Summarize this email" },
          { role: "user", content: "Email content here" },
        ],
      });
    });

    it("returns empty string when no content in response", async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: null } }] });

      const provider = createPiProvider("http://localhost:3000", "gemma-4-e4b");
      const result = await provider.complete({
        systemPrompt: "sys",
        userContent: "user",
      });

      expect(result).toBe("");
    });
  });

  describe("testConnection", () => {
    it("returns true on successful completion", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "hi" } }],
      });

      const provider = createPiProvider("http://localhost:3000", "gemma-4-e4b");
      expect(await provider.testConnection()).toBe(true);
    });

    it("returns false when completion throws", async () => {
      mockCreate.mockRejectedValue(new Error("Connection refused"));

      const provider = createPiProvider("http://localhost:3000", "gemma-4-e4b");
      expect(await provider.testConnection()).toBe(false);
    });
  });
});
