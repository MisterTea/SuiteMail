import { useRef } from "react";
import { CSSTransition } from "react-transition-group";
import { useToastStore } from "@/stores/toastStore";
import { Archive, Trash2, X } from "lucide-react";

export function ActionFeedbackToast() {
  const currentToast = useToastStore((s) => s.currentToast);
  const dismissToast = useToastStore((s) => s.dismissToast);
  const toastRef = useRef<HTMLDivElement>(null);

  const handleAction = async () => {
    if (currentToast?.action?.onClick) {
      await currentToast.action.onClick();
      dismissToast();
    }
  };

  const isTrashOrDelete = currentToast?.message ? /trash|delete/i.test(currentToast.message) : false;

  return (
    <CSSTransition
      nodeRef={toastRef}
      in={Boolean(currentToast)}
      timeout={200}
      classNames="toast-pill"
      unmountOnExit
    >
      <div
        ref={toastRef}
        role="status"
        aria-live="polite"
        data-action-feedback className="fixed bottom-[calc(max(5.25rem,4.25rem+env(safe-area-inset-bottom,0px)))] md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 sm:gap-3 px-3.5 sm:px-4 py-2 sm:py-2.5 max-w-[calc(100vw-1.5rem)] rounded-full shadow-2xl bg-zinc-900/95 dark:bg-zinc-100/95 text-zinc-100 dark:text-zinc-900 border border-zinc-700/60 dark:border-zinc-300/60 backdrop-blur-md text-xs sm:text-sm select-none"
      >
        <div className="flex items-center gap-2 font-medium min-w-0">
          {currentToast?.icon ?? (
            isTrashOrDelete ? (
              <Trash2 size={15} className="text-red-500 shrink-0" aria-hidden="true" />
            ) : (
              <Archive size={15} className="text-accent shrink-0" aria-hidden="true" />
            )
          )}
          <span className="tracking-tight truncate">{currentToast?.message}</span>
        </div>

        {currentToast?.action && (
          <>
            <div className="h-4 w-px bg-zinc-700/80 dark:bg-zinc-300/80 shrink-0" />
            <button
              onClick={handleAction}
              className="min-h-[44px] md:min-h-0 px-4 md:px-2.5 py-2 md:py-0.5 inline-flex items-center justify-center text-xs sm:text-sm font-semibold rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-accent/50 shrink-0 touch-manipulation shadow-xs"
            >
              {currentToast.action.label}
            </button>
          </>
        )}

        <button
          onClick={dismissToast}
          aria-label="Dismiss notification"
          className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 p-2 md:p-0.5 -mr-1.5 md:-mr-1 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-200 dark:text-zinc-500 dark:hover:text-zinc-800 transition-colors rounded-full focus:outline-none shrink-0 touch-manipulation"
        >
          <X size={15} />
        </button>
      </div>
    </CSSTransition>
  );
}
