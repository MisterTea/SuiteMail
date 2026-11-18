import { useRef } from "react";
import { CSSTransition } from "react-transition-group";
import { useComposerStore } from "@/stores/composerStore";
import { Send } from "lucide-react";

export function UndoSendToast() {
  const { undoSendVisible, undoSendTimer, setUndoSendTimer, setUndoSendVisible } =
    useComposerStore();
  const toastRef = useRef<HTMLDivElement>(null);

  const handleUndo = () => {
    if (undoSendTimer) {
      clearTimeout(undoSendTimer);
      setUndoSendTimer(null);
    }
    setUndoSendVisible(false);
  };

  return (
    <CSSTransition
      nodeRef={toastRef}
      in={undoSendVisible}
      timeout={200}
      classNames="toast-pill"
      unmountOnExit
    >
      <div
        ref={toastRef}
        role="status"
        aria-live="polite"
        className="fixed bottom-[calc(max(5.25rem,4.25rem+env(safe-area-inset-bottom,0px)))] md:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-1.5rem)] flex items-center gap-3 px-4 py-2.5 rounded-full shadow-2xl bg-zinc-900/95 dark:bg-zinc-100/95 text-zinc-100 dark:text-zinc-900 border border-zinc-700/60 dark:border-zinc-300/60 backdrop-blur-md text-xs sm:text-sm select-none"
      >
        <div className="flex items-center gap-2 font-medium min-w-0">
          <Send size={15} className="text-accent shrink-0 animate-pulse" />
          <span className="tracking-tight truncate">Sending email...</span>
        </div>
        <div className="h-4 w-px shrink-0 bg-zinc-700/80 dark:bg-zinc-300/80" />
        <button
          onClick={handleUndo}
          className="min-h-[44px] md:min-h-0 px-4 md:px-3.5 py-2 md:py-0.5 text-xs sm:text-sm font-semibold rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-accent/50 shrink-0 touch-manipulation shadow-xs"
          aria-label="Undo sending email"
        >
          Undo
        </button>
      </div>
    </CSSTransition>
  );
}
