import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function AiCoreDownloadConsent({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal isOpen onClose={onCancel} title="Download AiCore using this connection?">
      <div className="space-y-4 p-4">
        <p className="text-sm text-text-secondary">
          AiCore needs to download an on-device model. Your current connection may use metered data.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" className="min-h-11" onClick={onCancel}>Not now</Button>
          <Button variant="primary" className="min-h-11" onClick={onConfirm}>Download model</Button>
        </div>
      </div>
    </Modal>
  );
}
