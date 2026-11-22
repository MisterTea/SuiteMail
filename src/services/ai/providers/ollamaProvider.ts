import OpenAI from "openai";
import { Capacitor } from "@capacitor/core";
import { hostAiFetch } from "../androidHostAi";
import { platformFetch as fetch } from "@/platform";
import type { AiProviderClient, AiCompletionRequest } from "../types";

let instance: OpenAI | null = null;
let cachedKey: string | null = null;

function getClient(serverUrl: string, model: string): OpenAI {
  const cacheKey = `${serverUrl}|${model}`;
  if (!instance || cachedKey !== cacheKey) {
    instance = new OpenAI({
      baseURL: `${serverUrl.replace(/\/+$/, "")}/v1`,
      apiKey: "ollama",
      dangerouslyAllowBrowser: true,
      fetch: Capacitor.getPlatform() === "android" && new URL(serverUrl).hostname === "10.0.2.2" ? hostAiFetch : fetch,
    });
    cachedKey = cacheKey;
  }
  return instance;
}

export function createOllamaProvider(serverUrl: string, model: string): AiProviderClient {
  const client = getClient(serverUrl, model);

  return {
    async complete(req: AiCompletionRequest): Promise<string> {
      const response = await client.chat.completions.create({
        model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userContent },
        ],
      });

      return response.choices[0]?.message?.content ?? "";
    },

    async testConnection(): Promise<boolean> {
      try {
        await client.chat.completions.create({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Say hi" }],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function clearOllamaProvider(): void {
  instance = null;
  cachedKey = null;
}
