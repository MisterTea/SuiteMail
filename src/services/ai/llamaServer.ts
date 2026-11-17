import { platformFetch as fetch } from "@/platform";
import { getSetting, setSetting } from "@/services/db/settings";

export interface LlamaServerStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  loadedModel: string | null;
  error?: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

/**
 * Check if the llama server is responsive on the given port or URL.
 */
export async function checkLlamaServerStatus(
  serverUrl?: string,
): Promise<LlamaServerStatus> {
  const url =
    serverUrl ??
    (await getSetting("pi_server_url")) ??
    `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

  const cleanUrl = url.replace(/\/+$/, "");

  try {
    const res = await fetch(`${cleanUrl}/v1/models`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (res.ok) {
      const data = (await res.json()) as { data?: { id: string }[] };
      const modelId = data.data?.[0]?.id ?? null;
      const portMatch = cleanUrl.match(/:(\d+)/);
      const port = portMatch ? parseInt(portMatch[1]!, 10) : DEFAULT_PORT;

      return {
        running: true,
        port,
        baseUrl: cleanUrl,
        loadedModel: modelId,
      };
    }
  } catch (err) {
    // Server is unreachable
  }

  const portMatch = cleanUrl.match(/:(\d+)/);
  const port = portMatch ? parseInt(portMatch[1]!, 10) : DEFAULT_PORT;
  return {
    running: false,
    port,
    baseUrl: cleanUrl,
    loadedModel: null,
  };
}

/**
 * Configure and register the local Llama server URL and model in SuperMail settings.
 */
export async function registerLlamaServer(
  port: number = DEFAULT_PORT,
  model: string = "gemma-4-e4b",
): Promise<void> {
  const url = `http://${DEFAULT_HOST}:${port}`;
  await setSetting("pi_server_url", url);
  await setSetting("pi_model", model);
}
