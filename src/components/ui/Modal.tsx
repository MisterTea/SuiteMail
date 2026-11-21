import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { type ReactNode, useEffect, useRef, useId } from "react";
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
  const androidMobile = useAndroidMobile();
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusTimer = androidMobile ? setTimeout(() => nodeRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0) : null;
    const handleKeyDown = (e: KeyboardEvent) => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      if (androidMobile && dialogs[dialogs.length-1] !== nodeRef.current) return;
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); }
      if (androidMobile && e.key === "Tab") {
        const targets = [...(nodeRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? [])].filter(el=>el.offsetParent !== null);
        const first = targets[0], last = targets[targets.length-1];
        if (e.shiftKey && document.activeElement === first) {e.preventDefault();last?.focus();}
        else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first?.focus();}
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (focusTimer !== null) clearTimeout(focusTimer);
      if (androidMobile && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, androidMobile]);

  return createPortal(
    <CSSTransition in={isOpen} timeout={150} classNames="modal" unmountOnExit nodeRef={nodeRef}>
      <div
        ref={nodeRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={renderHeader === undefined ? titleId : undefined}
        style={androidMobile ? {top:"var(--safe-area-inset-top, 0px)",bottom:"auto",height:"calc(var(--android-viewport-height, 100dvh) - var(--safe-area-inset-top, 0px))"} : undefined}
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
            <div className="sticky top-0 z-10 bg-bg-primary px-4 py-3 border-b border-border-primary flex items-center justify-between">
              <h3 id={titleId} className="text-sm font-semibold text-text-primary">{title}</h3>
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
