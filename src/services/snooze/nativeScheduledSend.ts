import { Capacitor, registerPlugin } from "@capacitor/core";
import { iosNative } from "@/platform/ios";

export interface NativeScheduledSendResult {
  sent: number;
  failed: number;
}

interface AndroidBackgroundMail {
  runDueScheduledSends(): Promise<NativeScheduledSendResult>;
}

const androidBackgroundMail = registerPlugin<AndroidBackgroundMail>("BackgroundMail");

/** Android and iOS send scheduled mail from native code so it goes out even when the app isn't running. */
export const hasNativeScheduledSend = () => ["android", "ios"].includes(Capacitor.getPlatform());

export async function runNativeScheduledSends(): Promise<NativeScheduledSendResult> {
  if (Capacitor.getPlatform() === "android") return androidBackgroundMail.runDueScheduledSends();
  if (Capacitor.getPlatform() === "ios") return iosNative.backgroundMail({ action: "sendScheduled" });
  return { sent: 0, failed: 0 };
}
