import { useState, useEffect } from "react";
import { isTauri } from "@/platform";
import { Minus, Square, X, Copy } from "lucide-react";

const isMac = navigator.userAgent.includes("Macintosh");

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      appWindow.isMaximized().then(setMaximized);

      appWindow.onResized(() => {
        appWindow.isMaximized().then(setMaximized);
      });
    }).catch(() => {});
  }, []);

  if (!isTauri()) return null;

  const handleMinimize = () => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize()).catch(() => {});
  };
  const handleMaximize = () => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize()).catch(() => {});
  };
  const handleClose = () => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close()).catch(() => {});
  };

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-9 bg-sidebar-bg border-b border-border-primary select-none shrink-0"
    >
      {/* App title — left side (extra padding on macOS for traffic light buttons) */}
      <div data-tauri-drag-region className={`flex items-center gap-2 ${isMac ? "pl-20" : "pl-4"}`}>
        <span data-tauri-drag-region className="text-xs font-semibold text-sidebar-text tracking-wide">
          SuiteMail
        </span>
      </div>

      {/* Window controls — right side (hidden on macOS, uses native traffic lights) */}
      {!isMac && (
        <div className="flex items-center h-full">
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
