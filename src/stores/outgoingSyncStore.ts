import { create } from "zustand";

export interface OutgoingDiffItem {
  id: string;
  type: "label" | "archive" | "trash" | "spam" | "move" | "delete" | "metadata" | "send";
  summary: string;
  threadId?: string;
  subject?: string;
  labels?: string[];
  folder?: string;
  details?: string;
}

export interface OutgoingSyncSummary {
  total: number;
  labelsCount?: number;
  archiveCount?: number;
  trashCount?: number;
  spamCount?: number;
  metadataCount?: number;
  otherCount?: number;
}

export interface OutgoingSyncRequest {
  accountId: string;
  accountEmail?: string;
  isFirstSync?: boolean;
  title: string;
  description: string;
  items: OutgoingDiffItem[];
  summary: OutgoingSyncSummary;
}

interface OutgoingSyncState {
  activeRequest: OutgoingSyncRequest | null;
  isOpen: boolean;
  resolveSync: ((confirmed: boolean) => void) | null;
  requestConfirmation: (req: OutgoingSyncRequest) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
  reset: () => void;
}

export const useOutgoingSyncStore = create<OutgoingSyncState>((set, get) => ({
  activeRequest: null,
  isOpen: false,
  resolveSync: null,

  requestConfirmation: (req: OutgoingSyncRequest) => {
    // If a request is already pending, resolve false before opening the new one
    const prevResolve = get().resolveSync;
    if (prevResolve) {
      prevResolve(false);
    }

    return new Promise<boolean>((resolve) => {
      set({
        activeRequest: req,
        isOpen: true,
        resolveSync: (confirmed: boolean) => {
          set({
            isOpen: false,
            activeRequest: null,
            resolveSync: null,
          });
          resolve(confirmed);
        },
      });
    });
  },

  confirm: () => {
    const { resolveSync } = get();
    if (resolveSync) {
      resolveSync(true);
    }
  },

  cancel: () => {
    const { resolveSync } = get();
    if (resolveSync) {
      resolveSync(false);
    }
  },

  reset: () => {
    const { resolveSync } = get();
    if (resolveSync) {
      resolveSync(false);
    }
    set({
      activeRequest: null,
      isOpen: false,
      resolveSync: null,
    });
  },
}));

export async function requestOutgoingSyncConfirmation(req: OutgoingSyncRequest): Promise<boolean> {
  return useOutgoingSyncStore.getState().requestConfirmation(req);
}
