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
  const [applyToWholeInbox, setApplyToWholeInbox] = useState(true);
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
    setApplyToWholeInbox(true);
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

  // Execute Pi agent filter generation
  const handleGenerateAi = useCallback(
    async (textPrompt: string) => {
      const q = textPrompt.trim();
      if (!q || !accountId || loading) return;

      const version = ++requestVersion.current;
      setAgentProgress("Starting Pi agent…");
      setLoading(true);
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
          50,
        );
        if (version !== requestVersion.current) return;
        setAffectedEmails(affected);
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
        50,
      );
      if (version !== requestVersion.current) return;
      setAffectedEmails(affected);
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
    if (!suggestedFilter || !accountId || saving) return;

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
        const threadIds = affectedEmails.map((e) => e.threadId);
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
    }
  }, [
    suggestedFilter,
    accountId,
    saving,
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-modal-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 glass-backdrop"
        onClick={handleClose}
      />

      {/* Modal Dialog */}
      <div className="relative bg-bg-primary border border-border-primary rounded-xl glass-modal w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border-primary bg-bg-secondary">
          <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
            {mode === "ai" ? <Sparkles size={16} /> : <PenTool size={16} />}
          </div>
          <div className="flex-1">
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
            <div className="flex items-center bg-bg-tertiary p-0.5 rounded-lg border border-border-secondary mr-2">
              <button
                type="button"
                onClick={() => {
                  setMode("ai");
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
                onClick={() => {
                  setMode("manual");
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
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-danger/10 border border-danger/30 text-xs text-danger">
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
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Describe what you want this filter to do in plain English:
                  </label>
                  <textarea
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
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Filter Name
                  </label>
                  <input
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
                      <label className="text-[0.6875rem] text-text-tertiary block mb-1">
                        From contains
                      </label>
                      <input
                        type="text"
                        value={manualFrom}
                        onChange={(e) => setManualFrom(e.target.value)}
                        placeholder="e.g. boss@corp.com or github.com"
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[0.6875rem] text-text-tertiary block mb-1">
                        To contains
                      </label>
                      <input
                        type="text"
                        value={manualTo}
                        onChange={(e) => setManualTo(e.target.value)}
                        placeholder="e.g. team-leads@corp.com"
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[0.6875rem] text-text-tertiary block mb-1">
                        Subject contains
                      </label>
                      <input
                        type="text"
                        value={manualSubject}
                        onChange={(e) => setManualSubject(e.target.value)}
                        placeholder="e.g. Invoice, Receipt, Urgent"
                        className="w-full bg-bg-primary text-xs text-text-primary px-2.5 py-1.5 rounded border border-border-primary focus:border-accent outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[0.6875rem] text-text-tertiary block mb-1">
                        Body contains
                      </label>
                      <input
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
                      <label className="text-[0.6875rem] text-text-tertiary block mb-1">
                        Apply to existing folder / label
                      </label>
                      <select
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
                  <div className="flex flex-wrap gap-4 pt-1">
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
                    onClick={() => {
                      requestVersion.current += 1;
                      setLoading(false);
                      setSuggestedFilter(null);
                      setAffectedEmails([]);
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
                  <label className="text-[0.6875rem] font-medium text-text-tertiary block mb-1">
                    Rule Name
                  </label>
                  <input
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-primary">
                      Affected Emails
                    </span>
                    <span className="text-[0.6875rem] px-2 py-0.5 rounded-full font-medium bg-accent/15 text-accent">
                      {affectedEmails.length} matching email
                      {affectedEmails.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="text-[0.6875rem] text-text-tertiary">
                    Assuming this filter has highest priority
                  </span>
                </div>

                {affectedEmails.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 border border-border-primary rounded-lg p-2 bg-bg-secondary">
                    {affectedEmails.map((email) => (
                      <div
                        key={email.id}
                        className="p-2.5 rounded-md bg-bg-primary border border-border-secondary space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between text-text-tertiary text-[0.6875rem]">
                          <span className="font-medium text-text-primary truncate">
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
                        <div className="font-medium text-text-primary truncate">
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

                {/* Whole Inbox Checkbox */}
                <div className="pt-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-text-primary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={applyToWholeInbox}
                      onChange={(e) => setApplyToWholeInbox(e.target.checked)}
                      className="rounded border-border-primary accent-accent"
                    />
                    Apply this new filter to whole inbox
                  </label>
                  <p className="text-[0.6875rem] text-text-tertiary ml-5 mt-0.5">
                    {applyToWholeInbox
                      ? `Will apply actions to all ${affectedEmails.length} existing matching emails in your inbox right now.`
                      : "Will only filter future incoming emails without modifying existing emails in your inbox."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer / User Decision */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border-primary bg-bg-secondary">
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
                Add this filter to your rules or discard?
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
                  disabled={saving}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow"
                >
                  {saving ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <Check size={13} />
                      Add Filter (Highest Priority)
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
