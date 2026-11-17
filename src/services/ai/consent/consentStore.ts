import { create } from "zustand";
import type { ConsentRequest } from "./types";

interface ConsentState {
  activeRequest: ConsentRequest | null;
  isOpen: boolean;
  resolveConsent: ((approved: boolean) => void) | null;
  requestConsent: (req: ConsentRequest) => Promise<boolean>;
  approve: () => void;
  refuse: () => void;
  reset: () => void;
}

export const useConsentStore = create<ConsentState>((set, get) => ({
  activeRequest: null,
  isOpen: false,
  resolveConsent: null,

  requestConsent: (req: ConsentRequest) => {
    // If a request is already pending, reject the previous one before starting a new one
    const prevResolve = get().resolveConsent;
    if (prevResolve) {
      prevResolve(false);
    }

    return new Promise<boolean>((resolve) => {
      set({
        activeRequest: req,
        isOpen: true,
        resolveConsent: (approved: boolean) => {
          set({
            isOpen: false,
            activeRequest: null,
            resolveConsent: null,
          });
          resolve(approved);
        },
      });
    });
  },

  approve: () => {
    const { resolveConsent } = get();
    if (resolveConsent) {
      resolveConsent(true);
    }
  },

  refuse: () => {
    const { resolveConsent } = get();
    if (resolveConsent) {
      resolveConsent(false);
    }
  },

  reset: () => {
    const { resolveConsent } = get();
    if (resolveConsent) {
      resolveConsent(false);
    }
    set({
      activeRequest: null,
      isOpen: false,
      resolveConsent: null,
    });
  },
}));

export async function requestAgentConsent(req: ConsentRequest): Promise<boolean> {
  return useConsentStore.getState().requestConsent(req);
}
