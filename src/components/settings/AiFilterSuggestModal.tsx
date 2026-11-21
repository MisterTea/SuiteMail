import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  X,
  Check,
  RotateCcw,
  AlertCircle,
  Mail,
  Paperclip,
  Tag,
  Archive,
  Star,
  CheckCheck,
  Trash2,
  Loader2,
  FolderPlus,
  PenTool,
  ArrowRight,
} from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import {
  suggestFilterWithPiAgent,
  type SuggestedFilter,
} from "@/services/ai/piEmailAgent";
import {
  getAffectedEmailsForFilter,
  applyFilterActionsToThreads,
  type AffectedEmail,
} from "@/services/filters/filterEngine";
import { insertFilter, type FilterCriteria, type FilterActions } from "@/services/db/filters";
import { getLabelsForAccount, ensureLabelOrFolder, type DbLabel } from "@/services/db/labels";
import { uploadFilterChangeForAccount } from "@/services/imap/settingsSidecarSync";

export interface AiFilterSuggestModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId?: string;
  initialPrompt?: string;
  initialMode?: "ai" | "manual";
  onFilterAdded?: (filterId: string) => void;
}

const SAMPLE_PROMPTS = [
  "Archive all newsletters from github.com and mark them as read",
  "Move invoices to a new Invoices folder and star them",
  "Move Uber receipts to a new Receipts folder and mark as read",
  "Trash all marketing emails with 'discount' or 'deal' in subject",
];

export function AiFilterSuggestModal({
  isOpen,
  onClose,
  accountId: propAccountId,
  initialPrompt = "",
  initialMode = "ai",
  onFilterAdded,
}: AiFilterSuggestModalProps) {
  const androidMobile = useAndroidMobile();
  const saveInFlight = useRef(false);
  const [previewReady, setPreviewReady] = useState(false);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accountId = propAccountId ?? activeAccountId;

  const [mode, setMode] = useState<"ai" | "manual">(initialMode);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [loading, setLoading] = useState(false);
  const [agentProgress, setAgentProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Suggested / Configured Filter Result
  const [suggestedFilter, setSuggestedFilter] = useState<SuggestedFilter | null>(null);
  const [filterName, setFilterName] = useState("");
  const [affectedEmails, setAffectedEmails] = useState<AffectedEmail[]>([]);
  const [applyToWholeInbox, setApplyToWholeInbox] = useState(false);
  const [saving, setSaving] = useState(false);

  // Manual Form State
  const [availableLabels, setAvailableLabels] = useState<DbLabel[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualFrom, setManualFrom] = useState("");
  const [manualTo, setManualTo] = useState("");
  const [manualSubject, setManualSubject] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [manualHasAttachment, setManualHasAttachment] = useState(false);
  const [manualSelectedLabel, setManualSelectedLabel] = useState("");
  const [manualNewFolder, setManualNewFolder] = useState("");
  const [manualArchive, setManualArchive] = useState(false);
  const [manualStar, setManualStar] = useState(false);
  const [manualMarkRead, setManualMarkRead] = useState(false);
  const [manualTrash, setManualTrash] = useState(false);

  const requestVersion = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync initialMode and initialPrompt when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      if (initialPrompt) setPrompt(initialPrompt);
      if (accountId) {
        getLabelsForAccount(accountId)
          .then((l) => setAvailableLabels(l.filter((lb) => lb.type === "user")))
          .catch(() => {});
      }
    }
  }, [isOpen, initialMode, initialPrompt, accountId]);

  // Reset state on open/close
  const handleReset = useCallback(() => {
    requestVersion.current += 1;
    setPrompt("");
    setLoading(false);
    setError(null);
    setSuggestedFilter(null);
    setFilterName("");
    setAffectedEmails([]);
    setApplyToWholeInbox(false);
    setPreviewReady(false);
    saveInFlight.current = false;
    setSaving(false);

    // Reset manual form
    setManualName("");
    setManualFrom("");
    setManualTo("");
    setManualSubject("");
    setManualBody("");
    setManualHasAttachment(false);
    setManualSelectedLabel("");
    setManualNewFolder("");
    setManualArchive(false);
    setManualStar(false);
    setManualMarkRead(false);
    setManualTrash(false);
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  // Keep native Back (dispatched as Escape) and keyboard focus inside this portal.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button, input, textarea")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!saveInFlight.current) handleClose(); }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'));
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [isOpen, handleClose]);

  // Execute Pi agent filter generation
  const handleGenerateAi = useCallback(
    async (textPrompt: string) => {
      const q = textPrompt.trim();
      if (!q || !accountId || loading) return;

      const version = ++requestVersion.current;
      setAgentProgress("Starting Pi agent…");
      setLoading(true);
      setPreviewReady(false);
      setError(null);
      setSuggestedFilter(null);
      setAffectedEmails([]);

      try {
        const agentResult = await suggestFilterWithPiAgent({
          prompt: q,
          accountId,
          onProgress: (message) => {
            if (version === requestVersion.current) setAgentProgress(message);
          },
        });

        if (version !== requestVersion.current) return;
        const filter = agentResult.filter;
        setSuggestedFilter(filter);
        setFilterName(filter.name);

        // Fetch emails affected by this new filter (assuming highest priority)
        const affected = await getAffectedEmailsForFilter(
          accountId,
          filter.criteria,
          filter.actions,
          Number.POSITIVE_INFINITY,
        );
        if (version !== requestVersion.current) return;
        setAffectedEmails(affected);
        setPreviewReady(true);
      } catch (err) {
        if (version !== requestVersion.current) return;
        console.error("Failed to suggest filter with Pi Agent:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Pi Agent was unable to suggest a filter. Please check your AI connection and try again.",
        );
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [accountId, loading],
  );

  // Handle Manual Filter Submission -> Transition to Same Accept/Reject Pane
  const handleManualPreview = useCallback(async () => {
    if (!accountId) return;
    const name = manualName.trim() || "Manual Filter";

    const criteria: FilterCriteria = {};
    if (manualFrom.trim()) criteria.from = manualFrom.trim();
    if (manualTo.trim()) criteria.to = manualTo.trim();
    if (manualSubject.trim()) criteria.subject = manualSubject.trim();
    if (manualBody.trim()) criteria.body = manualBody.trim();
    if (manualHasAttachment) criteria.hasAttachment = true;

    const actions: FilterActions = {};
    const newFolder = manualNewFolder.trim() || undefined;
    if (newFolder) {
      actions.applyLabel = newFolder;
    } else if (manualSelectedLabel) {
      actions.applyLabel = manualSelectedLabel;
    }
    if (manualArchive) actions.archive = true;
    if (manualStar) actions.star = true;
    if (manualMarkRead) actions.markRead = true;
    if (manualTrash) actions.trash = true;

    const hasCriteria = Object.keys(criteria).length > 0;
    const hasActions = Object.keys(actions).length > 0;

    if (!hasCriteria && !hasActions) {
      setError("Please specify at least one criteria or action for the filter.");
      return;
    }

    const version = ++requestVersion.current;
    setLoading(true);
      setPreviewReady(false);
    setError(null);

    try {
      const filter: SuggestedFilter = {
        name,
        criteria,
        actions,
        newFolder,
        explanation: "Manually created filter rule.",
      };

      setSuggestedFilter(filter);
      setFilterName(name);

      const affected = await getAffectedEmailsForFilter(
        accountId,
        criteria,
        actions,
        Number.POSITIVE_INFINITY,
      );
      if (version !== requestVersion.current) return;
      setAffectedEmails(affected);
        setPreviewReady(true);
    } catch (err) {
      if (version !== requestVersion.current) return;
      setError(err instanceof Error ? err.message : "Failed to calculate affected emails");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [
    accountId,
    manualName,
    manualFrom,
    manualTo,
    manualSubject,
    manualBody,
    manualHasAttachment,
    manualNewFolder,
    manualSelectedLabel,
    manualArchive,
    manualStar,
    manualMarkRead,
    manualTrash,
  ]);

  // Confirm adding the filter with highest priority
  const handleAddFilter = useCallback(async () => {
    if (!suggestedFilter || !accountId || saving || saveInFlight.current || loading || !previewReady) return;
    saveInFlight.current = true;

    setSaving(true);
    try {
      const finalName = filterName.trim() || suggestedFilter.name;
      const finalActions: FilterActions = { ...suggestedFilter.actions };

      // If a new folder was suggested, create it now!
      if (suggestedFilter.newFolder) {
        const createdFolderId = await ensureLabelOrFolder(
          accountId,
          suggestedFilter.newFolder,
        );
        finalActions.applyLabel = createdFolderId;
      }

      // Insert filter with highest priority (lowest sort_order so it's evaluated first)
      const newFilterId = await insertFilter({
        accountId,
        name: finalName,
        criteria: suggestedFilter.criteria,
        actions: finalActions,
        isEnabled: true,
        highestPriority: true,
      });

      // Apply to whole inbox if checkbox is selected
      if (applyToWholeInbox && affectedEmails.length > 0) {
        const threadIds = [...new Set(affectedEmails.map((e) => e.threadId))];
        await applyFilterActionsToThreads(accountId, finalActions, threadIds);
      }

      // Upload IMAP sync sidecar change if applicable
      uploadFilterChangeForAccount(accountId, {
        action: "add",
        filter: {
          id: newFilterId,
          name: finalName,
          isEnabled: true,
          criteria: suggestedFilter.criteria,
          actions: finalActions,
        },
      }).catch((err) =>
        console.warn("[AiFilterSuggestModal] Failed to upload filter replacement:", err),
      );

      onFilterAdded?.(newFilterId);
      handleClose();
    } catch (err) {
      console.error("Failed to add suggested filter:", err);
      setError("Failed to save filter rule to database.");
      setSaving(false);
      saveInFlight.current = false;
    }
  }, [
    suggestedFilter,
    accountId,
    saving,
    loading,
    previewReady,
    filterName,
    applyToWholeInbox,
    affectedEmails,
    onFilterAdded,
    handleClose,
  ]);

  // Discard filter without saving
  const handleDiscard = useCallback(() => {
    handleClose();
  }, [handleClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-modal-title"
      className={`fixed inset-0 z-[70] flex items-center justify-center ${androidMobile ? "p-0" : "p-4"}`}
      style={androidMobile ? { height: "var(--android-viewport-height, 100dvh)", bottom: "auto" } : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 glass-backdrop"
        onClick={() => { if (!saveInFlight.current) handleClose(); }}
      />

      {/* Modal Dialog */}
      <div className={`relative bg-bg-primary border border-border-primary glass-modal w-full overflow-hidden flex flex-col shadow-2xl ${androidMobile ? "h-full text-base [&_input:not([type=checkbox])]:min-h-12 [&_input]:text-base [&_select]:min-h-12 [&_select]:text-base [&_textarea]:text-base [&_button]:min-h-12 [&_label]:text-sm [&_label:has(input[type=checkbox])]:min-h-12 [&_label:has(input[type=checkbox])]:p-2 [&_.text-xs]:text-sm [&_p]:text-sm [&_span]:text-sm [&_.grid]:grid-cols-1" : "rounded-xl max-w-2xl max-h-[88vh]"}`}>
        {/* Header */}
        <div className={`flex items-center gap-2 px-5 py-3.5 border-b border-border-primary bg-bg-secondary shrink-0 ${androidMobile ? "flex-wrap" : ""}`}>
          <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
            {mode === "ai" ? <Sparkles size={16} /> : <PenTool size={16} />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="filter-modal-title" className="text-sm font-semibold text-text-primary">
              {suggestedFilter
                ? "Review Filter & Affected Emails"
                : mode === "ai"
                  ? "AI Filter Assistant"
                  : "Create Filter Manually"}
            </h2>
            <p className="text-[0.6875rem] text-text-tertiary">
              {suggestedFilter
                ? "Preview rule effects before accepting or discarding"
                : mode === "ai"
                  ? "Powered by Pi Agent & Gemma 4"
                  : "Specify criteria and actions by hand"}
            </p>
          </div>

          {/* Mode Switcher Tabs (when not in accept/reject review pane) */}
          {!suggestedFilter && (
            <div className={`flex items-center bg-bg-tertiary p-0.5 rounded-lg border border-border-secondary ${androidMobile ? "order-last w-full [&_button]:flex-1 [&_button]:justify-center" : "mr-2"}`}>
              <button
                type="button"
                aria-pressed={mode === "ai"}
                onClick={() => {
                  setMode("ai");
                  requestVersion.current += 1; setLoading(false);
                  setApplyToWholeInbox(false);
                  setError(null);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
                  mode === "ai"
                    ? "bg-bg-primary text-accent shadow-sm"
                    : "text-text-tertiary hover:text-text-primary"
                }`}
              >
                <Sparkles size={12} />
                AI Agent
              </button>
              <button
                type="button"
                aria-pressed={mode === "manual"}
                onClick={() => {
                  setMode("manual");
                  requestVersion.current += 1; setLoading(false);
                  setApplyToWholeInbox(false);
                  setError(null);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
                  mode === "manual"
                    ? "bg-bg-primary text-accent shadow-sm"
                    : "text-text-tertiary hover:text-text-primary"
                }`}
              >
                <PenTool size={12} />
                Manual
              </button>
            </div>
          )}

          <button
            onClick={handleClose}
            className={`${androidMobile ? "min-w-12 flex items-center justify-center" : "p-1"} rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors`}
            disabled={saving}
            aria-label="Close filter editor"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body Content */}
        <div className={`flex-1 min-h-0 overflow-y-auto space-y-4 ${androidMobile ? "p-4" : "p-5"}`}>
          {error && (
            <div role="alert" className="flex items-start gap-2.5 p-3 rounded-lg bg-danger/10 border border-danger/30 text-xs text-danger">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {loading && agentProgress && mode === "ai" && (
            <p role="status" className="text-xs text-text-secondary">{agentProgress}</p>
          )}
          {!suggestedFilter ? (
            mode === "ai" ? (
              /* AI Mode: Prompt Input View */
              <div className="space-y-4">
                <div>
                  <label htmlFor="filter-field-1" className="block text-xs font-medium text-text-secondary mb-1.5">
                    Describe what you want this filter to do in plain English:
                  </label>
                  <textarea id="filter-field-1"
                    ref={inputRef}
                    autoFocus
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleGenerateAi(prompt);
                      }
                    }}
                    placeholder="e.g. Move all receipts into a new Receipts folder, star them, and mark as read..."
                    className="w-full bg-bg-secondary text-sm text-text-primary placeholder:text-text-tertiary rounded-lg p-3 border border-border-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none transition-colors"
                  />
                </div>

                {/* Sample prompts */}
                <div>
                  <div className="text-[0.6875rem] font-medium text-text-tertiary uppercase tracking-wider mb-2">
                    Try asking:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SAMPLE_PROMPTS.map((sample, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setPrompt(sample);
                          handleGenerateAi(sample);
                        }}
                        className="text-left text-xs p-2.5 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-text-primary border border-border-secondary transition-colors"
                      >
                        "{sample}"
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Manual Mode: Hand-crafted Filter Form */
              <div className="space-y-4">
                <div>
                  <label htmlFor="filter-field-2" className="block text-xs font-medium text-text-secondary mb-1">
                    Filter Name
                  </label>
                  <input id="filter-field-2"
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="e.g. Important Client Updates"
                    className="w-full bg-bg-secondary text-sm text-text-primary px-3 py-2 rounded-lg border border-border-primary focus:border-accent outline-none"
                  />
                </div>

                {/* Match criteria */}
                <div className="bg-bg-secondary p-3.5 rounded-lg border border-border-primary space-y-2.5">
                  <span className="text-xs font-semibold text-text-primary block">
                    Match Criteria (AND logic)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="filter-field-3" className="text-[0.6875rem] text-text-tertiary block mb-1">
                        From contains
                      </label>
                      <input id="filter-field-3"
                        type="text"
                        value={manualFrom}
                        onChange={(e) => setManualFrom(e.target.value)}
                        placeholder="e.g. boss@corp.com or github.com"
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="filter-field-4" className="text-[0.6875rem] text-text-tertiary block mb-1">
                        To contains
                      </label>
                      <input id="filter-field-4"
                        type="text"
                        value={manualTo}
                        onChange={(e) => setManualTo(e.target.value)}
                        placeholder="e.g. team-leads@corp.com"
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="filter-field-5" className="text-[0.6875rem] text-text-tertiary block mb-1">
                        Subject contains
                      </label>
                      <input id="filter-field-5"
                        type="text"
                        value={manualSubject}
                        onChange={(e) => setManualSubject(e.target.value)}
                        placeholder="e.g. Invoice, Receipt, Urgent"
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="filter-field-6" className="text-[0.6875rem] text-text-tertiary block mb-1">
                        Body contains
                      </label>
                      <input id="filter-field-6"
                        type="text"
                        value={manualBody}
                        onChange={(e) => setManualBody(e.target.value)}
                        placeholder="e.g. confirmation number, tracking"
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={manualHasAttachment}
                      onChange={(e) => setManualHasAttachment(e.target.checked)}
                      className="rounded border-border-primary accent-accent"
                    />
                    Message must have an attachment
                  </label>
                </div>

                {/* Actions */}
                <div className="bg-bg-secondary p-3.5 rounded-lg border border-border-primary space-y-3">
                  <span className="text-xs font-semibold text-text-primary block">
                    Actions & Destination Folder
                  </span>

                  {/* Folder / Label destination */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="filter-field-7" className="text-[0.6875rem] text-text-tertiary block mb-1">
                        Apply to existing folder / label
                      </label>
                      <select id="filter-field-7"
                        value={manualSelectedLabel}
                        onChange={(e) => {
                          setManualSelectedLabel(e.target.value);
                          if (e.target.value) setManualNewFolder("");
                        }}
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      >
                        <option value="">None (or choose below)</option>
                        {availableLabels.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[0.6875rem] text-text-tertiary block mb-1">
                        Or create new folder
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={manualNewFolder}
                          onChange={(e) => {
                            setManualNewFolder(e.target.value);
                            if (e.target.value) setManualSelectedLabel("");
                          }}
                          placeholder="e.g. Invoices, Taxes, ClientB"
                          className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none pl-7"
                        />
                        <FolderPlus
                          size={13}
                          className="absolute left-2.5 top-2 text-accent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Additional Action Checkboxes */}
                  <div className={androidMobile ? "flex flex-col gap-1 pt-1" : "flex flex-wrap gap-4 pt-1"}>
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualArchive}
                        onChange={(e) => setManualArchive(e.target.checked)}
                        className="rounded border-border-primary accent-accent"
                      />
                      Archive from Inbox
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualStar}
                        onChange={(e) => setManualStar(e.target.checked)}
                        className="rounded border-border-primary accent-accent"
                      />
                      Star email
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualMarkRead}
                        onChange={(e) => setManualMarkRead(e.target.checked)}
                        className="rounded border-border-primary accent-accent"
                      />
                      Mark as read
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualTrash}
                        onChange={(e) => setManualTrash(e.target.checked)}
                        className="rounded border-border-primary accent-accent"
                      />
                      Move to Trash
                    </label>
                  </div>
                </div>
              </div>
            )
          ) : (
            /* Accept/Reject Pane (Unified for both AI and Manual Creation) */
            <div className="space-y-4">
              {/* Filter Summary Card */}
              <div className="bg-bg-secondary rounded-lg border border-border-primary p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[0.6875rem] font-semibold text-accent uppercase tracking-wider">
                    Filter Rule Summary
                  </span>
                  <button
                    disabled={saving}
                    onClick={() => {
                      requestVersion.current += 1;
                      setLoading(false);
                      setSuggestedFilter(null);
                      setAffectedEmails([]);
                      setPreviewReady(false);
                      setApplyToWholeInbox(false);
                      setError(null);
                    }}
                    className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw size={12} />
                    Back to edit
                  </button>
                </div>

                {/* Filter Name */}
                <div>
                  <label htmlFor="filter-field-8" className="text-[0.6875rem] font-medium text-text-tertiary block mb-1">
                    Rule Name
                  </label>
                  <input id="filter-field-8"
                    type="text"
                    value={filterName}
                    onChange={(e) => setFilterName(e.target.value)}
                    className="w-full bg-bg-primary text-sm font-medium text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                  />
                </div>

                {/* Criteria Badges */}
                <div>
                  <span className="text-[0.6875rem] font-medium text-text-tertiary block mb-1.5">
                    Match Criteria
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedFilter.criteria.from && (
                      <span className="inline-flex items-center gap-1 text-xs bg-bg-primary px-2.5 py-1 rounded border border-border-secondary text-text-primary">
                        <Mail size={11} className="text-accent" />
                        From: <strong className="font-medium">{suggestedFilter.criteria.from}</strong>
                      </span>
                    )}
                    {suggestedFilter.criteria.to && (
                      <span className="inline-flex items-center gap-1 text-xs bg-bg-primary px-2.5 py-1 rounded border border-border-secondary text-text-primary">
                        <Mail size={11} className="text-accent" />
                        To: <strong className="font-medium">{suggestedFilter.criteria.to}</strong>
                      </span>
                    )}
                    {suggestedFilter.criteria.subject && (
                      <span className="inline-flex items-center gap-1 text-xs bg-bg-primary px-2.5 py-1 rounded border border-border-secondary text-text-primary">
                        Subject: <strong className="font-medium">{suggestedFilter.criteria.subject}</strong>
                      </span>
                    )}
                    {suggestedFilter.criteria.body && (
                      <span className="inline-flex items-center gap-1 text-xs bg-bg-primary px-2.5 py-1 rounded border border-border-secondary text-text-primary">
                        Body: <strong className="font-medium">{suggestedFilter.criteria.body}</strong>
                      </span>
                    )}
                    {suggestedFilter.criteria.hasAttachment && (
                      <span className="inline-flex items-center gap-1 text-xs bg-bg-primary px-2.5 py-1 rounded border border-border-secondary text-text-primary">
                        <Paperclip size={11} className="text-accent" />
                        Has attachment
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions Badges & New Folder */}
                <div>
                  <span className="text-[0.6875rem] font-medium text-text-tertiary block mb-1.5">
                    Actions To Apply
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedFilter.newFolder && (
                      <span className="inline-flex items-center gap-1 text-xs bg-accent/15 text-accent font-semibold px-2.5 py-1 rounded border border-accent/30">
                        <FolderPlus size={12} />
                        Creates new folder: "{suggestedFilter.newFolder}"
                      </span>
                    )}
                    {suggestedFilter.actions.applyLabel && !suggestedFilter.newFolder && (
                      <span className="inline-flex items-center gap-1 text-xs bg-accent/10 text-accent font-medium px-2.5 py-1 rounded border border-accent/20">
                        <Tag size={11} />
                        Apply Label: {suggestedFilter.actions.applyLabel}
                      </span>
                    )}
                    {suggestedFilter.actions.archive && (
                      <span className="inline-flex items-center gap-1 text-xs bg-bg-primary text-text-secondary px-2.5 py-1 rounded border border-border-secondary">
                        <Archive size={11} />
                        Archive from Inbox
                      </span>
                    )}
                    {suggestedFilter.actions.star && (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded border border-amber-500/20">
                        <Star size={11} />
                        Star
                      </span>
                    )}
                    {suggestedFilter.actions.markRead && (
                      <span className="inline-flex items-center gap-1 text-xs bg-bg-primary text-text-secondary px-2.5 py-1 rounded border border-border-secondary">
                        <CheckCheck size={11} />
                        Mark as read
                      </span>
                    )}
                    {suggestedFilter.actions.trash && (
                      <span className="inline-flex items-center gap-1 text-xs bg-danger/10 text-danger px-2.5 py-1 rounded border border-danger/20">
                        <Trash2 size={11} />
                        Move to Trash
                      </span>
                    )}
                  </div>
                </div>

                {suggestedFilter.explanation && (
                  <p className="text-xs text-text-secondary italic bg-bg-primary/50 p-2 rounded">
                    "{suggestedFilter.explanation}"
                  </p>
                )}
              </div>

              {/* Affected Emails Section */}
              <div className="space-y-2">
                <div className={androidMobile ? "flex flex-col gap-2" : "flex items-center justify-between"}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-primary">
                      {applyToWholeInbox ? "Matching existing emails" : "Existing matches — preview only"}
                    </span>
                    <span className="text-[0.6875rem] px-2 py-0.5 rounded-full font-medium bg-accent/15 text-accent">
                      {previewReady ? affectedEmails.length : "Checking"} matching email
                      {affectedEmails.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="text-sm text-text-tertiary">
                    Assuming this filter has highest priority
                  </span>
                </div>

                {loading ? <p role="status">Calculating matching emails…</p> : !previewReady ? <p role="status">Matching emails could not be checked. Go back to edit and retry.</p> : affectedEmails.length > 0 ? (
                  <div className={`${androidMobile ? "" : "max-h-44 overflow-y-auto"} space-y-1.5 border border-border-primary rounded-lg p-2 bg-bg-secondary`}>
                    {affectedEmails.slice(0, 50).map((email) => (
                      <div
                        key={email.id}
                        className="p-2.5 rounded-md bg-bg-primary border border-border-secondary space-y-1 text-xs"
                      >
                        <div className={`flex text-text-tertiary text-[0.6875rem] ${androidMobile ? "flex-col gap-1" : "items-center justify-between"}`}>
                          <span className={`font-medium text-text-primary ${androidMobile ? "break-words min-w-0" : "truncate"}`}>
                            {email.fromName
                              ? `${email.fromName} <${email.fromAddress}>`
                              : email.fromAddress ?? "Unknown"}
                          </span>
                          <span className="shrink-0 ml-2">
                            {new Date(
                              email.date > 1e11 ? email.date : email.date * 1000,
                            ).toLocaleDateString()}
                          </span>
                        </div>
                        <div className={`font-medium text-text-primary ${androidMobile ? "break-words min-w-0" : "truncate"}`}>
                          {email.subject ?? "(no subject)"}
                        </div>
                        {email.snippet && (
                          <div className="text-text-tertiary line-clamp-1">
                            {email.snippet}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1 pt-1">
                          {email.actionChanges.map((change, cIdx) => (
                            <span
                              key={cIdx}
                              className="text-[0.625rem] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary"
                            >
                              {change}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-lg border border-border-primary bg-bg-secondary text-center space-y-1">
                    <p className="text-xs font-medium text-text-secondary">
                      No existing emails match this criteria.
                    </p>
                    <p className="text-[0.6875rem] text-text-tertiary">
                      This rule will automatically apply to future incoming emails with highest priority.
                    </p>
                  </div>
                )}

                {affectedEmails.length > 50 && <p>Showing 50 of {affectedEmails.length} matching emails. Applying includes all matches.</p>}
                {/* Whole Inbox Checkbox */}
                <div className="pt-2">
                  <label className="flex items-center gap-3 min-h-12 p-3 text-sm font-medium text-text-primary cursor-pointer select-none rounded border border-border-primary">
                    <input
                      type="checkbox"
                      aria-describedby="filter-scope-help"
                      checked={applyToWholeInbox}
                      onChange={(e) => setApplyToWholeInbox(e.target.checked)}
                      className="rounded border-border-primary accent-accent"
                    />
                    <span>Also apply to matching existing emails
                  <span id="filter-scope-help" className="block text-sm text-text-tertiary mt-1">
                    {applyToWholeInbox
                      ? `Will apply actions to all ${affectedEmails.length} matching emails in this account right now.`
                      : "Will only filter future incoming emails without modifying existing emails in this account."}
                  </span></span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer / User Decision */}
        <div className={`shrink-0 px-5 py-3.5 border-t border-border-primary bg-bg-secondary ${androidMobile ? "[&>div]:flex-col [&>div]:gap-2 [&>div>span]:hidden [&>div>div]:w-full [&>div>div]:justify-end [&>div>div]:flex-col-reverse [&>div>div>button]:w-full [&>div>div>button]:justify-center [&_button]:min-h-12 [&_button]:text-sm" : "flex items-center justify-between"}`}
          style={androidMobile ? { paddingBottom: "max(12px, var(--safe-area-inset-bottom, 0px))" } : undefined}>
          {!suggestedFilter ? (
            mode === "ai" ? (
              <div className="flex items-center justify-between w-full">
                <span className="text-xs text-text-tertiary">
                  Press Ctrl+Enter to generate
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGenerateAi(prompt)}
                    disabled={!prompt.trim() || loading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Analyzing with Pi Agent...
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        Generate Filter
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full">
                <span className="text-xs text-text-tertiary">
                  Configure rule criteria and actions
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleManualPreview}
                    disabled={loading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Calculating...
                      </>
                    ) : (
                      <>
                        Preview & Continue
                        <ArrowRight size={13} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          ) : (
            /* Accept/Reject Decision Buttons */
            <div className="flex items-center justify-between w-full">
              <div className="text-xs font-medium text-text-primary">
                {androidMobile ? (applyToWholeInbox ? "New and existing matching emails" : "Future emails only · Existing emails stay unchanged") : "Add this filter to your rules or discard?"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={saving}
                  className="px-3.5 py-1.5 text-xs font-medium text-text-secondary hover:text-danger hover:bg-danger/10 rounded-md transition-colors"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleAddFilter}
                  disabled={saving || loading || !previewReady}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow"
                >
                  {saving ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      Saving filter…
                    </>
                  ) : (
                    <>
                      <Check size={13} />
                      {androidMobile ? (applyToWholeInbox ? "Create & apply" : "Create filter") : "Add Filter (Highest Priority)"}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
