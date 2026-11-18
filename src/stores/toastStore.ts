import { create } from "zustand";
import type { ReactNode } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastItem {
  id: string;
  message: string;
  icon?: ReactNode;
  action?: ToastAction;
  duration?: number;
}

interface ToastState {
  currentToast: ToastItem | null;
  showToast: (toast: Omit<ToastItem, "id">) => void;
  dismissToast: () => void;
}

let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  currentToast: null,

  showToast: (toast) => {
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }

    const id = crypto.randomUUID();
    const duration = toast.duration ?? 4500;
    const item: ToastItem = { ...toast, id, duration };

    set({ currentToast: item });

    if (duration > 0) {
      autoDismissTimer = setTimeout(() => {
        set({ currentToast: null });
        autoDismissTimer = null;
      }, duration);
    }
  },

  dismissToast: () => {
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
    set({ currentToast: null });
  },
}));
