import { create } from "zustand";
import { setSetting } from "@/services/db/settings";
import type { ColorThemeId } from "@/constants/themes";
import type { CalendarView } from "@/components/calendar/CalendarToolbar";
import type { SyncProgress } from "@/services/gmail/sync";

type Theme = "light" | "dark" | "system";
type ReadingPanePosition = "right" | "bottom" | "hidden";
type ReadFilter = "all" | "read" | "unread";
export type EmailDensity = "compact" | "default" | "spacious";
export type DefaultReplyMode = "reply" | "replyAll";
export type MarkAsReadBehavior = "instant" | "2s" | "manual";
export type FontScale = "small" | "default" | "large" | "xlarge";
export type InboxViewMode = "unified" | "split";

export interface SidebarNavItem {
  id: string;
  visible: boolean;
}

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  contactSidebarVisible: boolean;
  readingPanePosition: ReadingPanePosition;
  readFilter: ReadFilter;
  emailListWidth: number;
  emailDensity: EmailDensity;
  defaultReplyMode: DefaultReplyMode;
  markAsReadBehavior: MarkAsReadBehavior;
  fontScale: FontScale;
  colorTheme: ColorThemeId;
  sendAndArchive: boolean;
  inboxViewMode: InboxViewMode;
  calendarView: CalendarView;
  taskSidebarVisible: boolean;
  sidebarNavConfig: SidebarNavItem[] | null;
  reduceMotion: boolean;
  isOnline: boolean;
  pendingOpsCount: number;
  accountSyncProgress: Partial<Record<string, SyncProgress | null>>;
  isSyncingFolder: string | null;
  mobileSidebarOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  toggleContactSidebar: () => void;
  setContactSidebarVisible: (visible: boolean) => void;
  setReadingPanePosition: (position: ReadingPanePosition) => void;
  setReadFilter: (filter: ReadFilter) => void;
  setEmailListWidth: (width: number) => void;
  setEmailDensity: (density: EmailDensity) => void;
  setDefaultReplyMode: (mode: DefaultReplyMode) => void;
  setMarkAsReadBehavior: (behavior: MarkAsReadBehavior) => void;
  setFontScale: (scale: FontScale) => void;
  setColorTheme: (theme: ColorThemeId) => void;
  setSendAndArchive: (enabled: boolean) => void;
  setInboxViewMode: (mode: InboxViewMode) => void;
  setCalendarView: (view: CalendarView) => void;
  toggleTaskSidebar: () => void;
  setTaskSidebarVisible: (visible: boolean) => void;
  setSidebarNavConfig: (config: SidebarNavItem[]) => void;
  restoreSidebarNavConfig: (config: SidebarNavItem[]) => void;
  setReduceMotion: (reduce: boolean) => void;
  setOnline: (online: boolean) => void;
  setPendingOpsCount: (count: number) => void;
  setAccountSyncing: (accountId: string, syncing: boolean, progress?: SyncProgress) => void;
  setSyncingFolder: (folder: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: "system",
  sidebarCollapsed: false,
  contactSidebarVisible: false,
  readingPanePosition: "right",
  readFilter: "all",
  emailListWidth: 320,
  emailDensity: "default",
  defaultReplyMode: "reply",
  markAsReadBehavior: "instant",
  fontScale: typeof window !== "undefined" && window.innerWidth < 768 ? "large" : "default",
  colorTheme: "leaf",
  sendAndArchive: false,
  inboxViewMode: "unified",
  calendarView: "month",
  taskSidebarVisible: false,
  sidebarNavConfig: null,
  reduceMotion: false,
  isOnline: true,
  pendingOpsCount: 0,
  accountSyncProgress: {},
  isSyncingFolder: null,
  mobileSidebarOpen: false,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () =>
    set((state) => {
      const collapsed = !state.sidebarCollapsed;
      setSetting("sidebar_collapsed", String(collapsed)).catch(() => {});
      return { sidebarCollapsed: collapsed };
    }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
  toggleMobileSidebar: () => set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
  toggleContactSidebar: () =>
    set((state) => {
      const visible = !state.contactSidebarVisible;
      setSetting("contact_sidebar_visible", String(visible)).catch(() => {});
      return { contactSidebarVisible: visible };
    }),
  setContactSidebarVisible: (contactSidebarVisible) => set({ contactSidebarVisible }),
  setReadingPanePosition: (readingPanePosition) => {
    setSetting("reading_pane_position", readingPanePosition).catch(() => {});
    set({ readingPanePosition });
  },
  setReadFilter: (readFilter) => {
    setSetting("read_filter", readFilter).catch(() => {});
    set({ readFilter });
  },
  setEmailListWidth: (emailListWidth) => {
    setSetting("email_list_width", String(emailListWidth)).catch(() => {});
    set({ emailListWidth });
  },
  setEmailDensity: (emailDensity) => {
    setSetting("email_density", emailDensity).catch(() => {});
    set({ emailDensity });
  },
  setDefaultReplyMode: (defaultReplyMode) => {
    setSetting("default_reply_mode", defaultReplyMode).catch(() => {});
    set({ defaultReplyMode });
  },
  setMarkAsReadBehavior: (markAsReadBehavior) => {
    setSetting("mark_as_read_behavior", markAsReadBehavior).catch(() => {});
    set({ markAsReadBehavior });
  },
  setFontScale: (fontScale) => {
    setSetting("font_size", fontScale).catch(() => {});
    set({ fontScale });
  },
  setColorTheme: (colorTheme) => {
    setSetting("color_theme", colorTheme).catch(() => {});
    set({ colorTheme });
  },
  setSendAndArchive: (sendAndArchive) => {
    setSetting("send_and_archive", String(sendAndArchive)).catch(() => {});
    set({ sendAndArchive });
  },
  setInboxViewMode: (inboxViewMode) => {
    setSetting("inbox_view_mode", inboxViewMode).catch(() => {});
    set({ inboxViewMode });
  },
  setCalendarView: (calendarView) => {
    setSetting("calendar_view", calendarView).catch(() => {});
    set({ calendarView });
  },
  toggleTaskSidebar: () =>
    set((state) => {
      const visible = !state.taskSidebarVisible;
      setSetting("task_sidebar_visible", String(visible)).catch(() => {});
      return { taskSidebarVisible: visible };
    }),
  setTaskSidebarVisible: (taskSidebarVisible) => set({ taskSidebarVisible }),
  setSidebarNavConfig: (sidebarNavConfig) => {
    setSetting("sidebar_nav_config", JSON.stringify(sidebarNavConfig)).catch(() => {});
    set({ sidebarNavConfig });
  },
  restoreSidebarNavConfig: (sidebarNavConfig) => set({ sidebarNavConfig }),
  setReduceMotion: (reduceMotion) => {
    setSetting("reduce_motion", String(reduceMotion)).catch(() => {});
    set({ reduceMotion });
  },
  setOnline: (isOnline) => set({ isOnline }),
  setPendingOpsCount: (pendingOpsCount) => set({ pendingOpsCount }),
  setAccountSyncing: (accountId, syncing, progress) => set((state) => {
    const accountSyncProgress = { ...state.accountSyncProgress };
    if (syncing) {
      accountSyncProgress[accountId] = progress ?? null;
    } else {
      delete accountSyncProgress[accountId];
    }
    return { accountSyncProgress };
  }),
  setSyncingFolder: (isSyncingFolder) => set({ isSyncingFolder }),
}));
