import { create } from "zustand";

export type ComposerMode = "new" | "reply" | "replyAll" | "forward";
export type ComposerViewMode = "modal" | "fullpage";

export interface ComposerAttachment {
  id: string;
  file?: File;
  filename: string;
  mimeType: string;
  size: number;
  content: string; // base64
}

export interface ScheduledToastInfo {
  id: string;
  timestamp: number;
  formattedTime: string;
  recipient: string;
  subject: string;
  recurrenceRule?: string | null;
  savedDraft?: {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    bodyHtml: string;
    threadId: string | null;
    inReplyToMessageId: string | null;
    contractActive?: boolean;
    contractText?: string;
  };
}

export interface ComposerState {
  isOpen: boolean;
  mode: ComposerMode;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  threadId: string | null;
  inReplyToMessageId: string | null;
  showCcBcc: boolean;
  draftId: string | null;
  undoSendTimer: ReturnType<typeof setTimeout> | null;
  undoSendVisible: boolean;
  undoSendRestore: (() => void) | null;
  scheduledToast: ScheduledToastInfo | null;
  attachments: ComposerAttachment[];
  lastSavedAt: number | null;
  isSaving: boolean;
  fromEmail: string | null;
  viewMode: ComposerViewMode;
  signatureHtml: string;
  signatureId: string | null;
  quotedHtml: string | null;
  contractActive: boolean;
  contractText: string;

  openComposer: (opts?: {
    mode?: ComposerMode;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    bodyHtml?: string;
    threadId?: string | null;
    inReplyToMessageId?: string | null;
    draftId?: string | null;
    attachments?: ComposerAttachment[];
    quotedHtml?: string | null;
    contractActive?: boolean;
    contractText?: string;
  }) => void;
  closeComposer: () => void;
  setTo: (to: string[]) => void;
  setCc: (cc: string[]) => void;
  setBcc: (bcc: string[]) => void;
  setSubject: (subject: string) => void;
  setBodyHtml: (bodyHtml: string) => void;
  setQuotedHtml: (quotedHtml: string | null) => void;
  setShowCcBcc: (show: boolean) => void;
  setDraftId: (id: string | null) => void;
  setUndoSendTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
  setUndoSendVisible: (visible: boolean) => void;
  setUndoSendRestore: (restore: (() => void) | null) => void;
  setScheduledToast: (toast: ScheduledToastInfo | null) => void;
  addAttachment: (attachment: ComposerAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setLastSavedAt: (ts: number | null) => void;
  setIsSaving: (saving: boolean) => void;
  setFromEmail: (email: string | null) => void;
  setViewMode: (mode: ComposerViewMode) => void;
  setSignatureHtml: (html: string) => void;
  setSignatureId: (id: string | null) => void;
  setContractActive: (active: boolean) => void;
  setContractText: (text: string) => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  isOpen: false,
  mode: "new",
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  bodyHtml: "",
  threadId: null,
  inReplyToMessageId: null,
  showCcBcc: false,
  draftId: null,
  undoSendTimer: null,
  undoSendVisible: false,
  undoSendRestore: null,
  scheduledToast: null,
  attachments: [],
  viewMode: "modal",
  fromEmail: null,
  lastSavedAt: null,
  isSaving: false,
  signatureHtml: "",
  signatureId: null,
  quotedHtml: null,
  contractActive: false,
  contractText: "",

  openComposer: (opts) =>
    set({
      isOpen: true,
      mode: opts?.mode ?? "new",
      to: opts?.to ?? [],
      cc: opts?.cc ?? [],
      bcc: opts?.bcc ?? [],
      subject: opts?.subject ?? "",
      bodyHtml: opts?.bodyHtml ?? "",
      threadId: opts?.threadId ?? null,
      inReplyToMessageId: opts?.inReplyToMessageId ?? null,
      showCcBcc: (opts?.cc?.length ?? 0) > 0 || (opts?.bcc?.length ?? 0) > 0,
      draftId: opts?.draftId ?? null,
      viewMode: "modal",
      fromEmail: null,
      attachments: opts?.attachments ?? [],
      lastSavedAt: null,
      isSaving: false,
      signatureHtml: "",
      signatureId: null,
      quotedHtml: opts?.quotedHtml ?? null,
      contractActive: opts?.contractActive ?? false,
      contractText: opts?.contractText ?? "",
    }),
  closeComposer: () =>
    set({
      isOpen: false,
      mode: "new",
      to: [],
      cc: [],
      bcc: [],
      subject: "",
      bodyHtml: "",
      threadId: null,
      inReplyToMessageId: null,
      showCcBcc: false,
      draftId: null,
      attachments: [],
      viewMode: "modal",
      fromEmail: null,
      lastSavedAt: null,
      isSaving: false,
      signatureHtml: "",
      signatureId: null,
      quotedHtml: null,
      contractActive: false,
      contractText: "",
    }),
  setTo: (to) => set({ to }),
  setCc: (cc) => set({ cc }),
  setBcc: (bcc) => set({ bcc }),
  setSubject: (subject) => set({ subject }),
  setBodyHtml: (bodyHtml) => set({ bodyHtml }),
  setShowCcBcc: (showCcBcc) => set({ showCcBcc }),
  setDraftId: (draftId) => set({ draftId }),
  setUndoSendTimer: (undoSendTimer) => set({ undoSendTimer }),
  setUndoSendVisible: (undoSendVisible) => set({ undoSendVisible }),
  setUndoSendRestore: (undoSendRestore) => set({ undoSendRestore }),
  setScheduledToast: (scheduledToast) => set({ scheduledToast }),
  addAttachment: (attachment) =>
    set((state) => ({ attachments: [...state.attachments, attachment] })),
  removeAttachment: (id) =>
    set((state) => ({
      attachments: state.attachments.filter((a) => a.id !== id),
    })),
  clearAttachments: () => set({ attachments: [] }),
  setLastSavedAt: (lastSavedAt) => set({ lastSavedAt }),
  setIsSaving: (isSaving) => set({ isSaving }),
  setFromEmail: (fromEmail) => set({ fromEmail }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSignatureHtml: (signatureHtml) => set({ signatureHtml }),
  setSignatureId: (signatureId) => set({ signatureId }),
  setQuotedHtml: (quotedHtml) => set({ quotedHtml }),
  setContractActive: (contractActive) => set({ contractActive }),
  setContractText: (contractText) => set({ contractText }),
}));
