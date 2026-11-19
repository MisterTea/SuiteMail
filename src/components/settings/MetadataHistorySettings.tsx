import { useState, useEffect, useCallback } from "react";
import {
  RotateCcw,
  History,
  Clock,
  RefreshCw,
  Tag,
  Folder,
  Bell,
  Filter,
} from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/Button";
import {
  getMetadataHistory,
  getMetadataChangesPastHour,
  type MetadataHistoryRecord,
} from "@/services/db/metadataHistory";
import {
  reverseMetadataChangesPastHour,
  reverseMetadataChange,
} from "@/services/crdt/metadataReversion";

function getFieldIcon(field: string | null) {
  switch (field) {
    case "labels":
      return <Tag size={13} className="text-indigo-400 shrink-0" />;
    case "category":
      return <Folder size={13} className="text-blue-400 shrink-0" />;
    case "followUpAt":
      return <Bell size={13} className="text-amber-400 shrink-0" />;
    case "isFiltered":
      return <Filter size={13} className="text-purple-400 shrink-0" />;
    default:
      return <Clock size={13} className="text-text-tertiary shrink-0" />;
  }
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function MetadataHistorySettings() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const showToast = useToastStore((s) => s.showToast);

  const [history, setHistory] = useState<MetadataHistoryRecord[]>([]);
  const [pastHourCount, setPastHourCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [reversing, setReversing] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    if (!activeAccountId) return;
    setLoading(true);
    try {
      const [hist, pastHour] = await Promise.all([
        getMetadataHistory(activeAccountId, { limit: 50 }),
        getMetadataChangesPastHour(activeAccountId),
      ]);
      setHistory(hist);
      setPastHourCount(pastHour.length);
    } catch (err) {
      console.warn("Failed to load metadata history:", err);
    } finally {
      setLoading(false);
    }
  }, [activeAccountId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleReversePastHour = async () => {
    if (!activeAccountId || reversing) return;
    setReversing(true);
    try {
      const result = await reverseMetadataChangesPastHour(activeAccountId);
      if (result.reversedCount > 0) {
        showToast({
          message: `Reversed ${result.reversedCount} metadata change${result.reversedCount === 1 ? "" : "s"} from the past hour`,
          duration: 4500,
        });
      } else {
        showToast({
          message: "No un-reverted metadata changes in the past hour",
          duration: 3500,
        });
      }
      await loadData();
    } catch (err) {
      console.error("Failed to reverse metadata changes:", err);
      showToast({
        message: "Failed to reverse metadata changes",
        duration: 4000,
      });
    } finally {
      setReversing(false);
    }
  };

  const handleReverseSingle = async (changeId: string) => {
    if (!activeAccountId) return;
    try {
      const success = await reverseMetadataChange(changeId, activeAccountId);
      if (success) {
        showToast({
          message: "Reversed metadata change",
          duration: 3500,
        });
        await loadData();
      }
    } catch (err) {
      console.error("Failed to reverse change:", err);
      showToast({
        message: "Failed to reverse change",
        duration: 4000,
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header and explanation */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <History size={16} className="text-accent" />
            Metadata Audit Ledger & Reversibility
          </h3>
          <p className="text-xs text-text-tertiary mt-1">
            Metadata modifications (labels, categories, reminders, filters) are stored as an append-only JSONL ledger in your IMAP mailbox and SQLite audit history. Changes made within the past hour can be reverted at any time.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadData}
          disabled={loading}
          title="Refresh History"
          className="shrink-0"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* 1-Hour Reversion Action Card */}
      <div className="p-4 rounded-xl border border-border-primary bg-bg-secondary flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/10 text-accent shrink-0">
            <RotateCcw size={18} />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">
              Revert Past Hour's Changes
            </div>
            <div className="text-xs text-text-tertiary">
              {pastHourCount === 0
                ? "No un-reverted metadata changes in the past 60 minutes."
                : `${pastHourCount} metadata change${pastHourCount === 1 ? "" : "s"} recorded in the past hour ready to be reversed.`}
            </div>
          </div>
        </div>
        <Button
          variant="primary"
          onClick={handleReversePastHour}
          disabled={pastHourCount === 0 || reversing}
          className="shrink-0"
        >
          <RotateCcw size={14} className={reversing ? "animate-spin mr-1.5" : "mr-1.5"} />
          {reversing ? "Reversing..." : "Reverse Changes (Past Hour)"}
        </Button>
      </div>

      {/* History List */}
      <div className="border border-border-primary rounded-xl overflow-hidden bg-bg-secondary">
        <div className="px-4 py-2.5 border-b border-border-primary flex items-center justify-between bg-bg-tertiary/40">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Recent Audit Log ({history.length})
          </span>
          {pastHourCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
              {pastHourCount} in past hour
            </span>
          )}
        </div>

        {history.length === 0 ? (
          <div className="py-8 text-center text-text-tertiary text-xs">
            No metadata history recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-border-primary/50 max-h-80 overflow-y-auto">
            {history.map((record) => {
              const isPastHour = Date.now() - record.timestamp <= 3600 * 1000;
              const isReverted = record.reverted === 1;
              const isRevertAction = record.action === "revert";

              return (
                <div
                  key={record.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 text-xs hover:bg-bg-tertiary/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {getFieldIcon(record.field)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary truncate">
                          {record.change_summary || record.action}
                        </span>
                        {isReverted && (
                          <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary text-[10px] font-medium">
                            Reverted
                          </span>
                        )}
                        {!isReverted && isRevertAction && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-medium">
                            Reversion
                          </span>
                        )}
                        {!isReverted && !isRevertAction && isPastHour && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-medium">
                            &lt; 1h
                          </span>
                        )}
                      </div>
                      <div className="text-text-tertiary text-[11px] mt-0.5 flex items-center gap-2">
                        <span>Conv: {record.conversation_id}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(record.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  {!isReverted && !isRevertAction && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReverseSingle(record.id)}
                      className="shrink-0 text-text-tertiary hover:text-accent hover:bg-accent/10 text-[11px] h-7 px-2"
                      title="Reverse this specific change"
                    >
                      <RotateCcw size={12} className="mr-1" />
                      Reverse
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
