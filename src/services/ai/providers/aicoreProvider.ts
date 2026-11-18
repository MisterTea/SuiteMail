import { platformInvoke as invoke } from "@/platform";
import type { AiProviderClient, AiCompletionRequest } from "../types";

export interface AiCoreStatus {
  available: boolean;
  supported_models: string[];
}

let instance: AiProviderClient | null = null;
let currentModel: string = "gemma-4-26b";

export function createAiCoreProvider(model: string = "gemma-4-26b"): AiProviderClient {
  if (instance && currentModel === model) {
    return instance;
  }

  currentModel = model;
  instance = {
    async complete(req: AiCompletionRequest): Promise<string> {
      try {
        const response = await invoke<string>("aicore_generate", {
          systemPrompt: req.systemPrompt,
          prompt: req.userContent,
          model,
        });
        return response;
      } catch (err) {
        throw new Error(`AICore on-device generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async testConnection(): Promise<boolean> {
      try {
        const status = await invoke<AiCoreStatus>("aicore_is_available");
        return status.available;
      } catch {
        return false;
      }
    },
  };

  return instance;
}

export function clearAiCoreProvider(): void {
  instance = null;
}
