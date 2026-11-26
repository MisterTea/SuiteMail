import { isIOS } from "@/platform/ios";
import { IOSDrafts, useIOSDrafts } from "./IOSDrafts";
import { openThreadDraft } from "@/services/draft/openThreadDraft";
import { useEffect, useMemo, useState } from "react";
import { Inbox, Menu, Search } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import { type Thread } from "@/stores/threadStore";
import { useSelectedThreadId } from "@/hooks/useRouteNavigation";
import { navigateToLabel, navigateToThread } from "@/router/navigate";
import { getUnifiedThreads } from "@/services/db/unifiedMail";
import { getThreadById } from "@/services/db/threads";
import { mapDbThread } from "@/services/db/mapThread";
import { ThreadView } from "../email/ThreadView";
import { MailListScrollArea } from "./MailListScrollArea";

const PAGE_SIZE = 50;
const VIEWS = [
  { name: "Inbox", label: "INBOX" },
  { name: "All mail", label: null },
  { name: "Starred", label: "STARRED" },
  { name: "Sent", label: "SENT" },
  { name: "Drafts", label: "DRAFT" },
] as const;

function mailboxThreadKey(thread: Thread): string {
  return JSON.stringify([thread.accountId, thread.id]);
}

export function UnifiedMailbox() {
  const accounts = useAccountStore((s) => s.accounts);
  const mailAccounts = useMemo(() => accounts.filter((account) => account.provider !== "caldav"), [accounts]);
  const selectedKey = useSelectedThreadId();
  const [label, setLabel] = useState<string | null>("INBOX");
  const [query, setQuery] = useState("");
  const deviceDrafts = useIOSDrafts(mailAccounts.map((account) => account.id).join(","), isIOS() && label === "DRAFT" && !query.trim());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [openedThread, setOpenedThread] = useState<Thread | null>(null);
  const selected = threads.find((thread) => mailboxThreadKey(thread) === selectedKey && mailAccounts.some((account) => account.id === thread.accountId))
    ?? (openedThread && mailboxThreadKey(openedThread) === selectedKey && mailAccounts.some((account) => account.id === openedThread.accountId) ? openedThread : null);
  const readingPane = useUIStore((s) => s.readingPanePosition);

  useEffect(() => {
    if (!selectedKey || selected) return;
    let target: unknown;
    try { target = JSON.parse(selectedKey); } catch { return; }
    if (!Array.isArray(target) || target.length !== 2 || typeof target[1] !== "string") return;
    const [accountId, threadId] = target;
    if (!mailAccounts.some((account) => account.id === accountId)) return;
    let current = true;
    void getThreadById(accountId, threadId).then((row) => row && mapDbThread(row)).then((thread) => {
      if (current && thread) setOpenedThread(thread);
    }).catch(() => {});
    return () => { current = false; };
  }, [mailAccounts, selectedKey, selected]);

  useEffect(() => {
    if (mailAccounts.length < 2) navigateToLabel("inbox");
  }, [mailAccounts.length]);

  useEffect(() => {
    const reload = () => setRevision((value) => value + 1);
    window.addEventListener("suitemail-sync-done", reload);
    window.addEventListener("suitemail-sync-progress", reload);
    window.addEventListener("suitemail-thread-changed", reload);
    return () => {
      window.removeEventListener("suitemail-sync-done", reload);
      window.removeEventListener("suitemail-sync-progress", reload);
      window.removeEventListener("suitemail-thread-changed", reload);
    };
  }, []);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const rows = await getUnifiedThreads(mailAccounts.map((account) => account.id), query.trim() ? null : label, query.trim(), limit + 1, 0);
        const results = await Promise.all(rows.slice(0, limit).map(mapDbThread));
        if (current) {
          setThreads(results);
          setHasMore(rows.length > limit);
        }
      } catch {
        if (current) setError(true);
      } finally {
        if (current) setLoading(false);
      }
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [mailAccounts, label, query, limit, revision]);

  return (
    <div data-mail-layout className={`flex flex-1 min-w-0 min-h-0 pb-14 md:pb-0 ${readingPane === "bottom" ? "flex-col" : "flex-row"}`}>
      <section aria-label="All accounts" className={`min-w-0 flex-col bg-bg-secondary/50 border-r border-border-primary ${selected ? "hidden md:flex" : "flex"} ${readingPane === "bottom" ? "h-2/5" : "flex-1 md:max-w-lg"} ${selected && readingPane === "hidden" ? "md:hidden" : ""}`}>
        <div className="p-3 space-y-3 border-b border-border-primary">
          <div className="flex items-center gap-2">
            <button type="button" className="md:hidden min-w-11 min-h-11" aria-label="Open menu" onClick={() => useUIStore.getState().toggleMobileSidebar()}><Menu size={20} /></button>
            <Inbox size={18} />
            <h2 className="font-semibold">All Accounts</h2>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-border-primary px-3">
            <Search size={16} />
            <input type="search" aria-label="Search all accounts" placeholder="Search all accounts" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} className="w-full bg-transparent py-2 outline-none" />
          </label>
          {!query.trim() && <div className="flex flex-wrap gap-1" aria-label="Mail folders">
            {VIEWS.map((view) => (
              <button key={view.name} type="button" aria-pressed={label === view.label} className={`px-2 py-2 rounded-md text-sm ${label === view.label ? "bg-accent/15 text-accent" : "hover:bg-bg-hover"}`}
                onClick={() => { setLabel(view.label); setLimit(PAGE_SIZE); navigateToLabel("unified"); }}>
                {view.name}
              </button>
            ))}
          </div>}
        </div>
        <MailListScrollArea unified>
          {error && <p role="alert" className="p-4 text-sm text-danger">Couldn’t load mail from your accounts.</p>}
          <IOSDrafts drafts={deviceDrafts} />
          {!error && !threads.length && !deviceDrafts.length && <p className="p-4 text-sm text-text-secondary">{loading ? "Loading mail…" : "No conversations found."}</p>}
          {threads.map((thread) => {
            const key = mailboxThreadKey(thread);
            const email = mailAccounts.find((account) => account.id === thread.accountId)?.email;
            return (
              <button key={key} type="button" aria-pressed={key === selectedKey} className={`block w-full text-left p-3 border-b border-border-secondary ${key === selectedKey ? "bg-accent/10" : "hover:bg-bg-hover"}`}
                onClick={() => {
                  if (thread.labelIds.includes("DRAFT")) {
                    void openThreadDraft(thread);
                  } else {
                    setOpenedThread(thread);
                    navigateToThread(key);
                  }
                }}>
                <span className="flex justify-between items-baseline gap-2">
                  <span className={`truncate text-sm ${thread.isRead ? "" : "font-semibold"}`}>{thread.fromName || thread.fromAddress || "(Unknown sender)"}</span>
                  <span className="text-xs text-text-tertiary truncate max-w-1/2">{email}</span>
                </span>
                <span className={`block truncate text-sm ${thread.isRead ? "" : "font-semibold"}`}>{thread.subject || "(No subject)"}</span>
                <span className="block truncate text-xs text-text-secondary">{thread.snippet}</span>
              </button>
            );
          })}
          {hasMore && <button type="button" disabled={loading} className="p-3 text-accent" onClick={() => setLimit((value) => value + PAGE_SIZE)}>Load more</button>}
        </MailListScrollArea>
      </section>
      {selected && <div className="flex flex-1 min-w-0 flex-col">
        <button type="button" onClick={() => navigateToLabel("unified")} className={`text-left px-4 py-2 text-sm text-accent ${readingPane === "hidden" ? "" : "md:hidden"}`}>Back to All Accounts</button>
        <ThreadView key={mailboxThreadKey(selected)} thread={selected} />
      </div>}
    </div>
  );
}
