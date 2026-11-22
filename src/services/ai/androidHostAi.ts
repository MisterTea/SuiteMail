import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { platformInvoke } from "@/platform";

export function isAndroidAiRuntime(): boolean {
  return Capacitor.getPlatform() === "android" || (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent));
}

export async function isAndroidEmulator(): Promise<boolean> {
  if (!isAndroidAiRuntime()) return false;
  try {
    return (await platformInvoke<{ isEmulator: boolean }>("android_device_info")).isEmulator === true;
  } catch { return false; }
}

export async function resolveOllamaServerUrl(savedUrl: string | null): Promise<string> {
  const emulator = await isAndroidEmulator();
  const value = savedUrl?.trim() || (emulator ? "http://10.0.2.2:11434" : "http://localhost:11434");
  if (!emulator) return value;
  try {
    const url = new URL(value);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.hostname = "10.0.2.2";
    return url.toString().replace(/\/$/, "");
  } catch { return value; }
}

/** Native HTTP avoids WebView CORS restrictions when talking to the emulator host. */
export async function hostAiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const response = await CapacitorHttp.request({
    url: request.url, method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    ...(request.method !== "GET" && request.method !== "HEAD" ? { data: await request.text() } : {}),
    responseType: "text", connectTimeout: 5000, readTimeout: 180000,
  });
  return new Response(typeof response.data === "string" ? response.data : JSON.stringify(response.data), {
    status: response.status, headers: response.headers,
  });
}
