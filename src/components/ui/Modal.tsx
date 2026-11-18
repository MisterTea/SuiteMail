import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CSSTransition } from "react-transition-group";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
  /** Custom z-index class (default: "z-50") */
  zIndex?: string;
  /** Additional classes on the panel container */
  panelClassName?: string;
  /** Replace the default header entirely */
  renderHeader?: ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  width = "w-72",
  zIndex = "z-50",
  panelClassName,
  renderHeader,
}: ModalProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return createPortal(
    <CSSTransition in={isOpen} timeout={150} classNames="modal" unmountOnExit nodeRef={nodeRef}>
      <div
        ref={nodeRef}
        role="dialog"
        aria-modal="true"
        className={`fixed inset-0 ${zIndex} flex items-end sm:items-center justify-center p-0 sm:p-4`}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-0 bg-black/40 glass-backdrop transition-opacity" onClick={onClose} />
        <div
          className={`modal-panel relative bg-bg-primary border border-border-primary rounded-t-2xl sm:rounded-xl glass-modal shadow-2xl w-full sm:w-auto max-w-full sm:max-w-md max-h-[90dvh] overflow-y-auto ${width}${panelClassName ? ` ${panelClassName}` : ""}`}
        >
          {renderHeader !== undefined ? (
            renderHeader
          ) : (
            <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </CSSTransition>,
    document.body,
  );
}
