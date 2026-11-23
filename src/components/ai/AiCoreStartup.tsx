import { useEffect, useState } from "react";
import { AiCoreDownloadConsent } from "./AiCoreDownloadConsent";
import { platformInvoke } from "@/platform";
import { getActiveProviderName } from "@/services/ai/providerManager";
import { AICORE_READY_EVENT, prepareAiCore, type AiCoreStatus } from "@/services/ai/providers/aicoreProvider";
import { getSetting } from "@/services/db/settings";

export function AiCoreStartup({ canPrompt }: { canPrompt: boolean }) {
  const [requiresConsent, setRequiresConsent] = useState(false);
  const [allowMeteredDownload, setAllowMeteredDownload] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function checkDownload() {
      try {
        const status = await platformInvoke<AiCoreStatus>("aicore_is_available");
        if (!active) return;
        if (status.available) window.dispatchEvent(new Event(AICORE_READY_EVENT));
        else if (status.status === "downloading") timer = setTimeout(checkDownload, 5_000);
      } catch (error) {
        console.warn("Could not check AiCore download:", error);
      }
    }

    async function start() {
      if ((await getSetting("ai_enabled")) === "false" || await getActiveProviderName() !== "aicore" || !active) return;
      const status = await prepareAiCore(allowMeteredDownload);
      if (!active) return;
      setRequiresConsent(status.downloadRequiresConsent === true);
      if (status.status === "downloading") timer = setTimeout(checkDownload, 5_000);
    }

    const dismissConsent = () => setRequiresConsent(false);
    window.addEventListener(AICORE_READY_EVENT, dismissConsent);
    void start().catch((error) => console.warn("Could not set up AiCore at startup:", error));
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener(AICORE_READY_EVENT, dismissConsent);
    };
  }, [allowMeteredDownload]);

  if (!requiresConsent || !canPrompt) return null;
  return <AiCoreDownloadConsent
    onCancel={() => setRequiresConsent(false)}
    onConfirm={() => {
      setRequiresConsent(false);
      setAllowMeteredDownload(true);
    }}
  />;
}
