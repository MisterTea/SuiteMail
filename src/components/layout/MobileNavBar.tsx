import { Mail, Star, Calendar, ListTodo, Plus, Settings } from "lucide-react";
import { useActiveLabel } from "@/hooks/useRouteNavigation";
import { navigateToLabel, navigateToSettings } from "@/router/navigate";
import { useComposerStore } from "@/stores/composerStore";
import { useTaskStore } from "@/stores/taskStore";

export function MobileNavBar() {
  const activeLabel = useActiveLabel();
  const openComposer = useComposerStore((s) => s.openComposer);
  const incompleteTaskCount = useTaskStore((s) => s.incompleteCount);

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around px-2 py-1.5 border-t border-border-primary bg-bg-primary/95 backdrop-blur-md glass-panel shadow-lg select-none"
    >
      {/* Inbox */}
      <button
        onClick={() => navigateToLabel("inbox")}
        className={`flex flex-col items-center justify-center p-1.5 rounded-lg text-[10px] font-medium transition-colors ${
          activeLabel === "inbox"
            ? "text-accent"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        <Mail size={18} />
        <span className="mt-0.5">Inbox</span>
      </button>

      {/* Starred */}
      <button
        onClick={() => navigateToLabel("starred")}
        className={`flex flex-col items-center justify-center p-1.5 rounded-lg text-[10px] font-medium transition-colors ${
          activeLabel === "starred"
            ? "text-accent"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        <Star size={18} />
        <span className="mt-0.5">Starred</span>
      </button>

      {/* Compose Center FAB */}
      <button
        onClick={() => openComposer({ mode: "new" })}
        title="Compose Email"
        className="flex items-center justify-center w-10 h-10 -mt-3 rounded-full bg-accent text-white shadow-md hover:bg-accent-hover transition-all active:scale-95"
      >
        <Plus size={20} />
      </button>

      {/* Calendar */}
      <button
        onClick={() => navigateToLabel("calendar")}
        className={`flex flex-col items-center justify-center p-1.5 rounded-lg text-[10px] font-medium transition-colors ${
          activeLabel === "calendar"
            ? "text-accent"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        <Calendar size={18} />
        <span className="mt-0.5">Calendar</span>
      </button>

      {/* Tasks */}
      <button
        onClick={() => navigateToLabel("tasks")}
        className={`relative flex flex-col items-center justify-center p-1.5 rounded-lg text-[10px] font-medium transition-colors ${
          activeLabel === "tasks"
            ? "text-accent"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        <ListTodo size={18} />
        {incompleteTaskCount > 0 && (
          <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-accent" />
        )}
        <span className="mt-0.5">Tasks</span>
      </button>

      {/* Settings */}
      <button
        onClick={() => navigateToSettings("general")}
        className={`flex flex-col items-center justify-center p-1.5 rounded-lg text-[10px] font-medium transition-colors ${
          activeLabel === "settings"
            ? "text-accent"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        <Settings size={18} />
        <span className="mt-0.5">Settings</span>
      </button>
    </nav>
  );
}
