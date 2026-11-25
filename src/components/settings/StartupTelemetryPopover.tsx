import { useEffect, useRef, useState } from "react";
import { platformInvoke } from "@/platform";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function StartupTelemetryPopover({ onClose }: { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const description = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    description.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  async function choose(enabled: boolean) {
    setSaving(true);
    setSaveError(false);
    try {
      await platformInvoke<boolean>("set_startup_telemetry", { enabled });
      onClose();
    } catch {
      setSaveError(true);
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => { if (!saving) onClose(); }}
      title="Share startup diagnostics?"
      width="sm:w-[26rem]"
      zIndex="z-[70]"
    >
      <div className="space-y-3 p-4 text-sm text-text-secondary">
        <p ref={description} tabIndex={-1}>
          Would you share basic startup diagnostics to help us improve SuiteMail? From your
          next launch, reports include only your app version, operating system, and whether
          startup succeeded.
        </p>
        <p>
          <strong className="text-text-primary">We never include any content from your emails.</strong>{" "}
          You can change your choice in Settings → Privacy &amp; Security.
        </p>
        {saveError && <p role="alert" className="text-danger">Could not save your choice. Please try again.</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" size="md" disabled={saving} onClick={() => void choose(false)}>
            No thanks
          </Button>
          <Button type="button" size="md" variant="primary" disabled={saving} onClick={() => void choose(true)}>
            Yes, share diagnostics
          </Button>
        </div>
      </div>
    </Modal>
  );
}
