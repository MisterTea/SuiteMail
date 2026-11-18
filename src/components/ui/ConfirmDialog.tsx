import { type ReactNode, useEffect, useRef } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  danger?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  danger,
  loading = false,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const resolvedVariant = danger ? "danger" : variant;

  useEffect(() => {
    if (isOpen) {
      // Delay focus to allow modal transition
      const id = setTimeout(() => confirmRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="w-80">
      <div className="p-4" onKeyDown={handleKeyDown}>
        <div className="text-sm text-text-secondary mb-4">{message}</div>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
            className="min-h-[42px] sm:min-h-0 flex-1 sm:flex-initial justify-center"
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={resolvedVariant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={loading}
            className="min-h-[42px] sm:min-h-0 flex-1 sm:flex-initial justify-center"
          >
            {loading ? "..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
