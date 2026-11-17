import { isTauri, platformInvoke } from "@/platform";
import { getUnreadInboxCount } from "./db/threads";

let lastCount = -1;

export async function updateBadgeCount(): Promise<void> {
  try {
    const count = await getUnreadInboxCount();
    if (count === lastCount) return;
    lastCount = count;

    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
      } catch {}

      const tooltip = count > 0 ? `SuiteMail - ${count} unread` : "SuiteMail";
      try {
        await platformInvoke("set_tray_tooltip", { tooltip });
      } catch {}
    }
  } catch (err) {
    console.error("Failed to update badge count:", err);
  }
}
