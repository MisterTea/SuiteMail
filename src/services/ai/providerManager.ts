import { getSetting, getSecureSetting } from "@/services/db/settings";
import { AiError } from "./errors";
import type { AiProvider, AiProviderClient } from "./types";
import { DEFAULT_MODELS, MODEL_SETTINGS } from "./types";
import { createClaudeProvider, clearClaudeProvider } from "./providers/claudeProvider";
import { createOpenAIProvider, clearOpenAIProvider } from "./providers/openaiProvider";
import { createGeminiProvider, clearGeminiProvider } from "./providers/geminiProvider";
import { createOllamaProvider, clearOllamaProvider } from "./providers/ollamaProvider";
import { createCopilotProvider, clearCopilotProvider } from "./providers/copilotProvider";
import { createPiProvider, clearPiProvider } from "./providers/piProvider";
import { loadPiServerUrl } from "./llamaServer";
import { isAndroidAiRuntime, isAndroidEmulator, resolveOllamaServerUrl } from "./androidHostAi";
import { createAiCoreProvider, clearAiCoreProvider } from "./providers/aicoreProvider";

const API_KEY_SETTINGS: Record<Exclude<AiProvider, "ollama" | "pi" | "aicore">, string> = {
  claude: "claude_api_key",
  openai: "openai_api_key",
  gemini: "gemini_api_key",
  copilot: "copilot_api_key",
};

let cachedProvider: { name: AiProvider; key: string; client: AiProviderClient } | null = null;

export async function getActiveProviderName(): Promise<AiProvider> {
  const setting = await getSetting("ai_provider");
  if (isAndroidAiRuntime() && (setting === "pi" || (setting === "ollama" && !(await isAndroidEmulator())))) return "aicore";
  if (
    setting === "openai" ||
    setting === "gemini" ||
    setting === "ollama" ||
    setting === "copilot" ||
    setting === "pi" ||
    setting === "aicore"
  ) {
    return setting;
  }

  return "claude";
}

export async function getActiveProvider(): Promise<AiProviderClient> {
  const providerName = await getActiveProviderName();

  if (providerName === "ollama") {
    const serverUrl = await resolveOllamaServerUrl(await getSetting("ollama_server_url"));
    const model = (await getSetting("ollama_model")) ?? "llama3.2";
    const cacheKey = `${serverUrl}|${model}`;

    if (cachedProvider && cachedProvider.name === "ollama" && cachedProvider.key === cacheKey) {
      return cachedProvider.client;
    }

    const client = createOllamaProvider(serverUrl, model);
    cachedProvider = { name: "ollama", key: cacheKey, client };
    return client;
  }

  if (providerName === "pi") {
    const serverUrl = await loadPiServerUrl();
    const model = (await getSetting("pi_model")) ?? DEFAULT_MODELS.pi;
    const cacheKey = `${serverUrl}|${model}`;

    if (cachedProvider && cachedProvider.name === "pi" && cachedProvider.key === cacheKey) {
      return cachedProvider.client;
    }

    const client = createPiProvider(serverUrl, model);
    cachedProvider = { name: "pi", key: cacheKey, client };
    return client;
  }

  if (providerName === "aicore") {
    const model = DEFAULT_MODELS.aicore;
    const cacheKey = `aicore|${model}`;

    if (cachedProvider && cachedProvider.name === "aicore" && cachedProvider.key === cacheKey) {
      return cachedProvider.client;
    }

    const client = createAiCoreProvider(model);
    cachedProvider = { name: "aicore", key: cacheKey, client };
    return client;
  }

  const keySetting = API_KEY_SETTINGS[providerName];
  const apiKey = await getSecureSetting(keySetting);

  if (!apiKey) {
    throw new AiError("NOT_CONFIGURED", `${providerName} API key not configured`);
  }

  const model = (await getSetting(MODEL_SETTINGS[providerName])) ?? DEFAULT_MODELS[providerName];
  const cacheKey = `${apiKey}|${model}`;

  if (cachedProvider && cachedProvider.name === providerName && cachedProvider.key === cacheKey) {
    return cachedProvider.client;
  }

  let client: AiProviderClient;
  switch (providerName) {
    case "claude":
      client = createClaudeProvider(apiKey, model);
      break;
    case "openai":
      client = createOpenAIProvider(apiKey, model);
      break;
    case "gemini":
      client = createGeminiProvider(apiKey, model);
      break;
    case "copilot":
      client = createCopilotProvider(apiKey, model);
      break;
  }

  cachedProvider = { name: providerName, key: cacheKey, client };
  return client;
}

export async function isAiAvailable(): Promise<boolean> {
  try {
    const enabled = await getSetting("ai_enabled");
    if (enabled === "false") return false;
    const providerName = await getActiveProviderName();

    if (providerName === "ollama") {
      const serverUrl = await getSetting("ollama_server_url");
      return !!serverUrl || await isAndroidEmulator();
    }

    if (providerName === "pi") {
      const serverUrl = await getSetting("pi_server_url");
      return !!serverUrl;
    }

    if (providerName === "aicore") {
      return (await getActiveProvider()).testConnection();
    }

    const keySetting = API_KEY_SETTINGS[providerName];
    const key = await getSecureSetting(keySetting);
    return !!key;
  } catch {
    return false;
  }
}

export function clearProviderClients(): void {
  cachedProvider = null;
  clearClaudeProvider();
  clearOpenAIProvider();
  clearGeminiProvider();
  clearOllamaProvider();
  clearCopilotProvider();
  clearPiProvider();
  clearAiCoreProvider();
}
