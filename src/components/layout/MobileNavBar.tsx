import { useThreadStore } from "@/stores/threadStore";
import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { Capacitor } from "@capacitor/core";
import { Mail, Star, Calendar, ListTodo, Plus, Settings, Menu } from "lucide-react";
import { FeedbackButton } from "../feedback/FeedbackButton";
import { useActiveLabel, useActiveSettingsTab, useSelectedThreadId } from "@/hooks/useRouteNavigation";
import { navigateToLabel, navigateToSettings } from "@/router/navigate";
import { getSettingsGroup, SETTINGS_GROUPS } from "@/constants/settingsGroups";
import { useComposerStore } from "@/stores/composerStore";
import { useTaskStore } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";

export function MobileNavBar() {
  const androidMobile = useAndroidMobile();
  const selectedThreadId = useSelectedThreadId();
  const selectedCount = useThreadStore((s)=>s.selectedThreadIds.size);
  const activeLabel = useActiveLabel();
  const settingsGroup = getSettingsGroup(useActiveSettingsTab());
  const openComposer = useComposerStore((s) => s.openComposer);
  const composerOpen = useComposerStore((s) => s.isOpen);
  const incompleteTaskCount = useTaskStore((s) => s.incompleteCount);
  const toggleMobileSidebar = useUIStore((s) => s.toggleMobileSidebar);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const showFloatingCompose = androidMobile && !composerOpen && activeLabel !== "settings" && activeLabel !== "calendar" && !selectedThreadId && !selectedCount;
  const floatingFeedback = (androidMobile || Capacitor.getPlatform() === "android") && (
    <div
      data-android-feedback
      data-bulk-selected={androidMobile && selectedCount > 0 ? "true" : undefined}
      data-composer-open={composerOpen ? "true" : undefined}
      className="fixed right-4 z-[70]"
    >
      <FeedbackButton floating />
    </div>
  );

  if (androidMobile) {
    const destinations = [
      {label:"Inbox", id:"inbox", icon:Mail},
      {label:"Starred", id:"starred", icon:Star},
      {label:"Calendar", id:"calendar", icon:Calendar},
      {label:"Folders", id:"folders", icon:Menu},
    ];
    return <>
      {floatingFeedback}
      <nav data-mobile-nav aria-label="Mobile navigation" className="fixed bottom-0 inset-x-0 z-30 grid grid-cols-4 border-t border-border-primary bg-bg-primary px-2 pt-1">
        {destinations.map(({label,id,icon:Icon}) => <button key={id} data-testid={id === "folders" ? "mobile-nav-menu" : undefined}
          aria-label={id === "folders" ? "Open folders menu" : label} aria-current={activeLabel === id ? "page" : undefined}
          onClick={()=>{if(id === "folders") toggleMobileSidebar();else {setMobileSidebarOpen(false);navigateToLabel(id);}}}
          className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium ${activeLabel === id ? "text-accent bg-accent/10" : "text-text-secondary"}`}>
          <Icon size={24} /><span>{label}</span>
        </button>)}
      </nav>
      {showFloatingCompose && <button data-mobile-nav data-android-compose title="Compose Email" aria-label="Compose email" onClick={()=>{setMobileSidebarOpen(false);openComposer({mode:"new"});}}
        className="fixed right-20 z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-white shadow-lg active:bg-accent-hover">
        <Plus size={24} aria-hidden="true" />
      </button>}
    </>;
  }

  const showCompose = activeLabel !== "settings" && activeLabel !== "calendar";
  return <>
    {floatingFeedback}
    <nav
      aria-label="Mobile navigation"
      className={`md:hidden fixed bottom-0 left-0 right-0 z-30 grid items-center py-1.5 border-t border-border-primary bg-bg-primary/95 backdrop-blur-md glass-panel shadow-lg select-none ${showCompose ? "grid-cols-8" : "grid-cols-7"}`}
    >
      {/* Menu / Folders Drawer Trigger */}
      <button
        onClick={toggleMobileSidebar}
        data-testid="mobile-nav-menu"
        aria-label="Open folders menu"
        className="flex flex-col items-center justify-center p-1.5 rounded-lg text-[10px] font-medium text-text-tertiary hover:text-text-secondary active:scale-95 transition-all"
      >
        <Menu size={18} />
        <span className="mt-0.5">Folders</span>
      </button>

      {/* Inbox */}
      <button
        onClick={() => {
          setMobileSidebarOpen(false);
          navigateToLabel("inbox");
        }}
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
        onClick={() => {
          setMobileSidebarOpen(false);
          navigateToLabel("starred");
        }}
        aria-label="Starred"
        className={`relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl py-1.5 text-[10px] font-medium transition-all active:scale-90 ${
          activeLabel === "starred"
            ? "text-amber-500 dark:text-amber-400 font-semibold"
            : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        <Star
          size={18}
          className={`transition-all duration-200 ${
            activeLabel === "starred"
              ? "fill-amber-400 text-amber-500 dark:text-amber-400 star-animate drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]"
              : ""
          }`}
        />
        <span className="mt-0.5">Starred</span>
      </button>

      {/* Compose Center Pill / FAB */}
      {showCompose && <button
        onClick={() => {
          setMobileSidebarOpen(false);
          openComposer({ mode: "new" });
        }}
        title="Compose Email"
        aria-label="Compose email"
        className="flex aspect-square w-full max-w-10 min-[360px]:max-w-11 items-center justify-center justify-self-center -mt-2.5 rounded-full bg-accent text-white shadow-md hover:bg-accent-hover transition-all active:scale-95"
      >
        <Plus size={24} aria-hidden="true" />
      </button>}

      {/* Calendar */}
      <button
        onClick={() => {
          setMobileSidebarOpen(false);
          navigateToLabel("calendar");
        }}
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
        onClick={() => {
          setMobileSidebarOpen(false);
          navigateToLabel("tasks");
        }}
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

      {Object.entries(SETTINGS_GROUPS).map(([group, { label, firstTab }]) => (
        <button
          key={group}
          type="button"
          aria-label={`${label} settings`}
          aria-current={activeLabel === "settings" && settingsGroup === group ? "page" : undefined}
          onClick={() => {
            setMobileSidebarOpen(false);
            navigateToSettings(firstTab);
          }}
          className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg text-[10px] font-medium transition-colors ${
            activeLabel === "settings" && settingsGroup === group
              ? "text-accent"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          <Settings size={18} aria-hidden="true" />
          <span className="mt-0.5">{label}</span>
        </button>
      ))}
    </nav>
  </>;
}
