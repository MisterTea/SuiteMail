import { platformInvoke } from "@/platform";
import { getUnreadInboxCount } from "./db/threads";

let lastCount = -1;

export async function updateBadgeCount(): Promise<void> {
  try {
    const count = await getUnreadInboxCount();
    if (count === lastCount) return;
    lastCount = count;

    if (typeof navigator !== "undefined" && "setAppBadge" in navigator) {
      try {
        if (count > 0) {
          await (navigator as unknown as { setAppBadge: (c: number) => Promise<void> }).setAppBadge(count);
        } else {
          await (navigator as unknown as { clearAppBadge: () => Promise<void> }).clearAppBadge();
        }
      } catch {}
    }

    const tooltip = count > 0 ? `SuiteMail - ${count} unread` : "SuiteMail";
    try {
      await platformInvoke("set_tray_tooltip", { tooltip });
    } catch {}
  } catch (err) {
    console.error("Failed to update badge count:", err);
  }
}
