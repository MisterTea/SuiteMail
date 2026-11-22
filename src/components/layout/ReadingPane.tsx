import { useEffect, useState } from "react";
import { useAccountStore } from "@/stores/accountStore";
import { getThreadById } from "@/services/db/threads";
import { mapDbThread } from "@/services/db/mapThread";
import { ThreadView } from "../email/ThreadView";
import { useThreadStore, type Thread } from "@/stores/threadStore";
import { useSelectedThreadId } from "@/hooks/useRouteNavigation";
import { EmptyState } from "../ui/EmptyState";
import { ReadingPaneIllustration } from "../ui/illustrations";

export function ReadingPane() {
  const selectedThreadId = useSelectedThreadId();
  const accountId = useAccountStore((state) => state.activeAccountId);
  const listed = useThreadStore((state) => selectedThreadId ? state.threadMap.get(selectedThreadId) : undefined);
  const [direct, setDirect] = useState<Thread | null>(null);
  const selectedThread = listed?.accountId === accountId
    ? listed
    : direct?.accountId === accountId && direct?.id === selectedThreadId ? direct : null;

  useEffect(() => {
    if (!accountId || !selectedThreadId || listed?.accountId === accountId) return;
    let current = true;
    void getThreadById(accountId, selectedThreadId).then((row) => row && mapDbThread(row)).then((thread) => {
      if (current && thread) setDirect(thread);
    }).catch(() => {});
    return () => { current = false; };
  }, [accountId, selectedThreadId, listed?.accountId]);

  if (!selectedThread) {
    return (
      <div className="flex-1 flex flex-col bg-bg-primary/50 glass-panel">
        <EmptyState illustration={ReadingPaneIllustration} title="SuiteMail" subtitle="Select an email to read" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-bg-primary/50 overflow-hidden glass-panel">
      <ThreadView key={JSON.stringify([selectedThread.accountId, selectedThread.id])} thread={selectedThread} />
    </div>
  );
}
