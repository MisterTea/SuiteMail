import { platformFetch as fetch, platformInvoke } from "@/platform";
import { getSetting, setSetting } from "@/services/db/settings";

export interface LlamaServerStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  loadedModel: string | null;
  error?: string;
}

const DEFAULT_HOST = "127.0.0.1";
/**
 * Dedicated loopback port for the local model server.
 * Port 3000 is a common application dev port, so SuiteMail does not use it.
 */
export const LLAMA_SERVER_PORT = 18420;
const DEFAULT_PORT = LLAMA_SERVER_PORT;
export const DEFAULT_PI_SERVER_URL = `http://${DEFAULT_HOST}:${LLAMA_SERVER_PORT}`;

/** Saved copies of the previous product default (`http://localhost:3000`). */
const LEGACY_DEFAULT_PI_URLS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
const PI_PORT_MIGRATION_KEY = "pi_server_port_migrated_off_3000";

/**
 * `localhost` resolves to IPv6 (::1) first. llama-server listens on 127.0.0.1,
 * and Tauri's HTTP client does not fall back, so the call fails closed.
 */
export function ipv4LoopbackUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "localhost") parsed.hostname = DEFAULT_HOST;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/\/localhost\b/i, `//${DEFAULT_HOST}`).replace(/\/+$/, "");
  }
}

export function isLegacyDefaultPiServerUrl(url: string): boolean {
  return LEGACY_DEFAULT_PI_URLS.has(url.trim().replace(/\/+$/, ""));
}

/** Port from a server URL, or the dedicated default when the URL has none. */
export function piServerPort(url: string): number {
  try {
    const parsed = new URL(ipv4LoopbackUrl(url));
    const port = parsed.port ? Number(parsed.port) : NaN;
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  } catch {
    // Fall through to the dedicated port.
  }
  return LLAMA_SERVER_PORT;
}

/**
 * Resolve the Pi server URL. An explicit URL is kept (localhost becomes
 * 127.0.0.1). A saved copy of the old port-3000 default is moved once.
 */
export async function loadPiServerUrl(preferred?: string): Promise<string> {
  if (preferred !== undefined && preferred.trim() !== "") {
    return ipv4LoopbackUrl(preferred);
  }

  const stored = await getSetting("pi_server_url");
  if ((await getSetting(PI_PORT_MIGRATION_KEY)) !== "1") {
    await setSetting(PI_PORT_MIGRATION_KEY, "1").catch(() => {});
    if (!stored || isLegacyDefaultPiServerUrl(stored)) {
      if (stored) {
        await setSetting("pi_server_url", DEFAULT_PI_SERVER_URL).catch(() => {});
      }
      return DEFAULT_PI_SERVER_URL;
    }
  }

  if (!stored) return DEFAULT_PI_SERVER_URL;
  const resolved = ipv4LoopbackUrl(stored);
  if (resolved !== stored.trim().replace(/\/+$/, "")) {
    await setSetting("pi_server_url", resolved).catch(() => {});
  }
  return resolved;
}

interface StartedLlamaServer {
  running: boolean;
  base_url?: string;
  baseUrl?: string;
  model?: string | null;
  error?: string;
}

/**
 * Check if the llama server is responsive on the given port or URL.
 */
export async function checkLlamaServerStatus(
  serverUrl?: string,
): Promise<LlamaServerStatus> {
  const cleanUrl = serverUrl ? ipv4LoopbackUrl(serverUrl) : await loadPiServerUrl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${cleanUrl}/v1/models`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
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
  } catch {
    // Server is unreachable
  } finally {
    clearTimeout(timer);
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
 * Reach the configured llama.cpp server, starting it when the port is closed.
 * Returns an IPv4 loopback base URL the OpenAI client can call.
 */
export async function ensureLlamaServer(preferredUrl?: string): Promise<string> {
  const url = await loadPiServerUrl(preferredUrl);

  const status = await checkLlamaServerStatus(url);
  if (status.running) {
    return status.baseUrl.replace(/\/+$/, "");
  }

  const model = (await getSetting("pi_model")) ?? "gemma-4-e4b";
  try {
    const info = await platformInvoke<StartedLlamaServer>("start_llama_server", {
      modelId: model,
      port: status.port,
    });
    const started = ipv4LoopbackUrl(info.base_url || info.baseUrl || url);
    if (!info.running) {
      throw new Error(info.error || info.model || "the local model server did not start");
    }
    await setSetting("pi_server_url", started).catch(() => {});
    return started;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Can't reach the local model server")) throw err;
    throw new Error(`Can't reach the local model server at ${url}. ${message}`);
  }
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
