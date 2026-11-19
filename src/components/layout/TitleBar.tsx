import { useState } from "react";
import { isElectron, platformMinimize, platformToggleMaximize, platformClose } from "@/platform";
import { Minus, Square, X, Copy } from "lucide-react";

const isMac = navigator.userAgent.includes("Macintosh");

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  if (!isElectron()) return null;

  const handleMinimize = () => {
    platformMinimize().catch(() => {});
  };
  const handleMaximize = () => {
    platformToggleMaximize().then(() => setMaximized((m) => !m)).catch(() => {});
  };
  const handleClose = () => {
    platformClose().catch(() => {});
  };

  return (
    <div
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className="flex items-center justify-between h-9 bg-sidebar-bg border-b border-border-primary select-none shrink-0"
    >
      {/* App title — left side (extra padding on macOS for traffic light buttons) */}
      <div className={`flex items-center gap-2 ${isMac ? "pl-20" : "pl-4"}`}>
        <span className="text-xs font-semibold text-sidebar-text tracking-wide">
          SuiteMail
        </span>
      </div>

      {/* Window controls — right side (hidden on macOS, uses native traffic lights) */}
      {!isMac && (
        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex items-center h-full"
        >
          <button
            onClick={handleMinimize}
            className="h-full px-3.5 flex items-center justify-center text-sidebar-text/70 hover:bg-sidebar-hover transition-colors"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-full px-3.5 flex items-center justify-center text-sidebar-text/70 hover:bg-sidebar-hover transition-colors"
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            onClick={handleClose}
            className="h-full px-3.5 flex items-center justify-center text-sidebar-text/70 hover:bg-danger hover:text-white transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
