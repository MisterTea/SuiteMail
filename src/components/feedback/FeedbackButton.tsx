import { useState } from "react";
import { Bug } from "lucide-react";
import { captureCurrentScreenshot } from "./feedback-service";
import { FeedbackDialog } from "./FeedbackDialog";

export function FeedbackButton({ floating = false }: { floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const [screenshot, setScreenshot] = useState("");
  const [capturing, setCapturing] = useState(false);

  async function handleClick() {
    if (capturing || open) return;
    setCapturing(true);
    try {
      const dataUrl = await captureCurrentScreenshot();
      setScreenshot(dataUrl);
      setOpen(true);
    } finally {
      setCapturing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`flex shrink-0 items-center justify-center disabled:opacity-40 ${floating
          ? "size-14 rounded-2xl border border-border-primary bg-bg-primary text-text-primary shadow-lg active:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent"
          : "size-9 rounded-lg text-sidebar-text hover:bg-sidebar-hover interactive-btn"}`}
        aria-label="Report bug or request feature"
        title="Report a bug or request a feature"
        disabled={capturing}
        onClick={handleClick}
      >
        <Bug size={floating ? 24 : 16} aria-hidden="true" />
      </button>
      {open ? (
        <FeedbackDialog
          screenshot={screenshot}
          onClose={() => {
            setOpen(false);
            setScreenshot("");
          }}
        />
      ) : null}
    </>
  );
}
