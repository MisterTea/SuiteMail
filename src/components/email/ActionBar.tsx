import { useState, useEffect } from "react";
import type { Thread } from "@/stores/threadStore";
import { useThreadStore } from "@/stores/threadStore";
import { useAccountStore } from "@/stores/accountStore";
import { useActiveLabel } from "@/hooks/useRouteNavigation";
import { navigateToLabel } from "@/router/navigate";
import { useUIStore } from "@/stores/uiStore";
import { archiveThread, trashThread, permanentDeleteThread, markThreadRead, starThread, spamThread } from "@/services/emailActions";
import { deleteThread as deleteThreadFromDb, pinThread as pinThreadDb, unpinThread as unpinThreadDb, muteThread as muteThreadDb, unmuteThread as unmuteThreadDb } from "@/services/db/threads";
import { deleteDraftsForThread } from "@/services/gmail/draftDeletion";
import { snoozeThread } from "@/services/snooze/snoozeManager";
import { getGmailClient } from "@/services/gmail/tokenManager";
import { SnoozeDialog } from "./SnoozeDialog";
import { FollowUpDialog } from "./FollowUpDialog";
import { Archive, Trash2, MailOpen, Mail, Star, Clock, Ban, Pin, MailMinus, BellRing, VolumeX, Reply, ReplyAll, Forward, FolderInput, Printer, Download, ExternalLink, PanelRightClose, PanelRightOpen, ListTodo, ArrowLeft, Menu } from "lucide-react";
import type { DbMessage } from "@/services/db/messages";
import { insertFollowUpReminder, getFollowUpForThread, cancelFollowUpForThread } from "@/services/db/followUpReminders";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/stores/toastStore";

interface ActionBarProps {
  thread: Thread;
  messages?: DbMessage[];
  noReply?: boolean;
  defaultReplyMode?: "reply" | "replyAll";
  contactSidebarVisible?: boolean;
  taskSidebarVisible?: boolean;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
  onPrint?: () => void;
  onExport?: () => void;
  onPopOut?: () => void;
  onToggleContactSidebar?: () => void;
  onToggleTaskSidebar?: () => void;
}

function Separator() {
  return <div className="w-px h-4 bg-border-primary/50 mx-1.5 shrink-0" />;
}

export function ActionBar({ thread, messages, noReply, defaultReplyMode = "reply", contactSidebarVisible, taskSidebarVisible, onReply, onReplyAll, onForward, onPrint, onExport, onPopOut, onToggleContactSidebar, onToggleTaskSidebar }: ActionBarProps) {
  const updateThread = useThreadStore((s) => s.updateThread);
  const removeThread = useThreadStore((s) => s.removeThread);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeLabel = useActiveLabel();
  const [showSnooze, setShowSnooze] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [hasFollowUp, setHasFollowUp] = useState(false);
  const isSpamView = activeLabel === "spam";
  const hasLastMessage = !!messages?.length;

  const lastMsg = messages?.[messages.length - 1];
  const replyAllRecipients = (() => {
    if (!lastMsg) return { count: 0, hasMultiple: false };
    const replyTo = lastMsg.reply_to ?? lastMsg.from_address;
    const addrs = new Set<string>();
    if (replyTo) addrs.add(replyTo);
    if (lastMsg.to_addresses) {
      lastMsg.to_addresses.split(",").forEach((a) => {
        const t = a.trim();
        if (t) addrs.add(t);
      });
    }
    if (lastMsg.cc_addresses) {
      lastMsg.cc_addresses.split(",").forEach((a) => {
        const t = a.trim();
        if (t) addrs.add(t);
      });
    }
    return { count: addrs.size, hasMultiple: addrs.size > 1 };
  })();

  // Check if thread has an active follow-up reminder
  useEffect(() => {
    if (!activeAccountId) return;
    getFollowUpForThread(activeAccountId, thread.id)
      .then((r) => setHasFollowUp(r !== null))
      .catch(() => setHasFollowUp(false));
  }, [activeAccountId, thread.id]);

  const handleToggleRead = async () => {
    if (!activeAccountId) return;
    const nextReadState = !thread.isRead;
    await markThreadRead(activeAccountId, thread.id, [], nextReadState);
    useToastStore.getState().showToast({
      message: nextReadState ? "Marked as read" : "Marked as unread",
      icon: nextReadState ? (
        <MailOpen size={15} className="text-accent shrink-0" />
      ) : (
        <Mail size={15} className="text-accent shrink-0" />
      ),
      duration: 4000,
      action: {
        label: nextReadState ? "Mark unread" : "Mark as read",
        onClick: async () => {
          try {
            await markThreadRead(activeAccountId, thread.id, [], !nextReadState);
          } catch (err) {
            console.error("Failed to toggle read state:", err);
          }
        },
      },
    });
  };

  const handleToggleStar = async () => {
    if (!activeAccountId) return;
    const nextStarred = !thread.isStarred;
    await starThread(activeAccountId, thread.id, [], nextStarred);
    useToastStore.getState().showToast({
      message: nextStarred ? "Marked as Starred" : "Removed from Starred",
      icon: <Star size={14} className={nextStarred ? "fill-amber-400 text-amber-500 shrink-0" : "text-text-tertiary shrink-0"} />,
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            await starThread(activeAccountId, thread.id, [], !nextStarred);
          } catch (err) {
            console.error("Failed to undo star:", err);
          }
        },
      },
    });
  };

  const handleArchive = async () => {
    if (!activeAccountId) return;
    await archiveThread(activeAccountId, thread.id, []);
  };

  const handleDelete = async () => {
    if (!activeAccountId) return;
    const isTrashView = activeLabel === "trash";
    const isDraftsView = activeLabel === "drafts";
    if (isTrashView) {
      await permanentDeleteThread(activeAccountId, thread.id, []);
      await deleteThreadFromDb(activeAccountId, thread.id);
    } else if (isDraftsView) {
      removeThread(thread.id);
      try {
        const client = await getGmailClient(activeAccountId);
        await deleteDraftsForThread(client, activeAccountId, thread.id);
      } catch (err) {
        console.error("Failed to delete drafts:", err);
      }
    } else {
      await trashThread(activeAccountId, thread.id, []);
    }
  };

  const handleSnooze = async (until: number) => {
    if (!activeAccountId) return;
    setShowSnooze(false);

    // Compute target time label
    const targetDate = new Date(until * 1000);
    const today = new Date();
    const isTomorrow =
      targetDate.getDate() === new Date(today.getTime() + 86400000).getDate() &&
      targetDate.getMonth() === new Date(today.getTime() + 86400000).getMonth();
    const timeStr = targetDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const dayStr = isTomorrow
      ? "Tomorrow"
      : targetDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const targetLabel = `${dayStr}, ${timeStr}`;

    // Immediate optimistic removal from view
    removeThread(thread.id);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      navigateToLabel(activeLabel);
    }

    // Immediate action feedback toast with one-tap Undo
    useToastStore.getState().showToast({
      message: `Snoozed until ${targetLabel}`,
      icon: <Clock size={15} className="text-accent shrink-0" />,
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            useToastStore.getState().dismissToast();
            const { unsnoozeThread } = await import("@/services/snooze/snoozeManager");
            await unsnoozeThread(activeAccountId, thread.id);
          } catch (err) {
            console.error("Failed to undo snooze:", err);
          }
        },
      },
    });

    try {
      await snoozeThread(activeAccountId, thread.id, until);
    } catch (err) {
      console.error("Failed to snooze:", err);
    }
  };

  const handleSpam = async () => {
    if (!activeAccountId) return;
    await spamThread(activeAccountId, thread.id, [], !isSpamView);
  };

  // Find the first message with an unsubscribe header
  const unsubscribeMessage = messages?.find((m) => m.list_unsubscribe);
  const hasUnsubscribe = !!unsubscribeMessage?.list_unsubscribe;
  const [unsubscribeStatus, setUnsubscribeStatus] = useState<"idle" | "loading" | "done">("idle");

  const handleUnsubscribe = async () => {
    if (!unsubscribeMessage?.list_unsubscribe || !activeAccountId) return;
    setUnsubscribeStatus("loading");
    try {
      const { executeUnsubscribe } = await import("@/services/unsubscribe/unsubscribeManager");
      const result = await executeUnsubscribe(
        activeAccountId,
        thread.id,
        unsubscribeMessage.from_address ?? "unknown",
        unsubscribeMessage.from_name,
        unsubscribeMessage.list_unsubscribe,
        unsubscribeMessage.list_unsubscribe_post,
      );
      if (result.success) {
        setUnsubscribeStatus("done");
        try {
          const { insertFilter } = await import("@/services/db/filters");
          if (unsubscribeMessage.from_address) {
            await insertFilter({
              accountId: activeAccountId,
              name: `Auto-archive: ${unsubscribeMessage.from_name || unsubscribeMessage.from_address}`,
              criteria: { from: unsubscribeMessage.from_address },
              actions: { archive: true },
              isEnabled: true,
            });
          }
        } catch {
          // ignore filter insert failure
        }
        // Auto-archive after successful unsubscribe
        await archiveThread(activeAccountId, thread.id, []);
      } else {
        setUnsubscribeStatus("idle");
      }
    } catch (err) {
      console.error("Failed to unsubscribe:", err);
      setUnsubscribeStatus("idle");
    }
  };

  const handleTogglePin = async () => {
    if (!activeAccountId) return;
    const newPinned = !thread.isPinned;
    updateThread(thread.id, { isPinned: newPinned });
    try {
      if (newPinned) {
        await pinThreadDb(activeAccountId, thread.id);
        useToastStore.getState().showToast({
          message: "Thread pinned to top",
          icon: <Pin size={14} className="text-accent fill-current -rotate-45" />,
        });
      } else {
        await unpinThreadDb(activeAccountId, thread.id);
        useToastStore.getState().showToast({
          message: "Thread unpinned",
          icon: <Pin size={14} className="text-text-tertiary" />,
        });
      }
    } catch (err) {
      console.error("Failed to toggle pin:", err);
      updateThread(thread.id, { isPinned: !newPinned });
    }
  };

  const handleToggleMute = async () => {
    if (!activeAccountId) return;
    const newMuted = !thread.isMuted;
    if (newMuted) {
      // Mute: mark as muted and archive
      updateThread(thread.id, { isMuted: true });
      try {
        await muteThreadDb(activeAccountId, thread.id);
        await archiveThread(activeAccountId, thread.id, []);
      } catch (err) {
        console.error("Failed to mute:", err);
        await unmuteThreadDb(activeAccountId, thread.id);
        updateThread(thread.id, { isMuted: false });
      }
    } else {
      // Unmute
      updateThread(thread.id, { isMuted: false });
      try {
        await unmuteThreadDb(activeAccountId, thread.id);
      } catch (err) {
        console.error("Failed to unmute:", err);
        updateThread(thread.id, { isMuted: true });
      }
    }
  };

  const handleFollowUp = async (remindAt: number) => {
    if (!activeAccountId || !messages || messages.length === 0) return;
    setShowFollowUp(false);
    const lastMsg = messages[messages.length - 1]!;
    try {
      await insertFollowUpReminder(activeAccountId, thread.id, lastMsg.id, remindAt);
      setHasFollowUp(true);
    } catch (err) {
      console.error("Failed to set follow-up reminder:", err);
    }
  };

  const handleCancelFollowUp = async () => {
    if (!activeAccountId) return;
    try {
      await cancelFollowUpForThread(activeAccountId, thread.id);
      setHasFollowUp(false);
    } catch (err) {
      console.error("Failed to cancel follow-up:", err);
    }
  };

  return (
    <>
      <div className="flex items-center flex-nowrap gap-1 px-2 md:px-3.5 py-1.5 border-b border-border-primary/80 bg-bg-secondary/70 backdrop-blur-md overflow-x-auto scrollbar-none touch-pan-x shrink-0">
        {/* Mobile Back & Menu buttons */}
        <div className="flex items-center shrink-0 md:hidden gap-1 mr-1 sticky left-0 z-10 bg-bg-secondary/95 py-0.5 pl-0.5 pr-1 rounded-r-lg">
          <Button
            variant="secondary"
            iconOnly
            icon={<ArrowLeft size={18} />}
            onClick={() => navigateToLabel(activeLabel)}
            title="Back to list"
            aria-label="Back to list"
            className="w-12 h-12 min-w-[48px] min-h-[48px] text-text-primary hover:bg-bg-hover active:bg-accent/15 active:scale-90 transition-all rounded-full touch-manipulation"
          />
          <Button
            variant="secondary"
            iconOnly
            icon={<Menu size={18} />}
            onClick={() => useUIStore.getState().toggleMobileSidebar()}
            title="Open menu"
            aria-label="Open menu"
            data-testid="mobile-menu-button"
            className="w-12 h-12 min-w-[48px] min-h-[48px] text-text-secondary hover:bg-bg-hover active:scale-90 transition-all rounded-full touch-manipulation"
          />
        </div>
        {/* Reply / Forward group */}
        {hasLastMessage && (
          <>
            <Button
              variant="secondary"
              iconOnly
              icon={
                defaultReplyMode === "replyAll" ? (
                  <div className="relative flex items-center justify-center">
                    <ReplyAll size={16} />
                    {replyAllRecipients.hasMultiple && (
                      <span
                        className="absolute -top-1.5 -right-2 min-w-[15px] h-3.5 px-0.5 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center leading-none ring-1 ring-bg-secondary"
                        aria-label={`${replyAllRecipients.count} recipients`}
                      >
                        {replyAllRecipients.count}
                      </span>
                    )}
                  </div>
                ) : (
                  <Reply size={16} />
                )
              }
              onClick={defaultReplyMode === "replyAll" ? onReplyAll : onReply}
              disabled={noReply}
              title={noReply ? "This sender does not accept replies" : defaultReplyMode === "replyAll" ? "Reply All (r)" : "Reply (r)"}
              aria-label={defaultReplyMode === "replyAll" ? "Reply All" : "Reply"}
              className={`w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary touch-manipulation shrink-0 ${
                defaultReplyMode === "replyAll" && replyAllRecipients.hasMultiple
                  ? "bg-accent/15 border border-accent/30 text-accent font-semibold"
                  : "text-accent hover:bg-accent/10"
              }`}
            />
            <Button
              variant="secondary"
              iconOnly
              icon={
                defaultReplyMode === "replyAll" ? (
                  <Reply size={16} />
                ) : (
                  <div className="relative flex items-center justify-center">
                    <ReplyAll size={16} className={replyAllRecipients.hasMultiple ? "text-accent" : ""} />
                    {replyAllRecipients.hasMultiple && (
                      <span
                        className="absolute -top-1.5 -right-2 min-w-[15px] h-3.5 px-0.5 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center leading-none ring-1 ring-bg-secondary shadow-xs"
                        aria-label={`${replyAllRecipients.count} recipients`}
                      >
                        {replyAllRecipients.count}
                      </span>
                    )}
                  </div>
                )
              }
              onClick={defaultReplyMode === "replyAll" ? onReply : onReplyAll}
              disabled={noReply}
              title={noReply ? "This sender does not accept replies" : defaultReplyMode === "replyAll" ? "Reply (a)" : "Reply All (a)"}
              aria-label={defaultReplyMode === "replyAll" ? "Reply" : "Reply All"}
              className={`w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary touch-manipulation shrink-0 ${
                replyAllRecipients.hasMultiple && defaultReplyMode !== "replyAll"
                  ? "bg-accent/15 border border-accent/30 text-accent font-semibold shadow-xs"
                  : ""
              }`}
            />
            <Button
              variant="secondary"
              iconOnly
              icon={<Forward size={16} />}
              onClick={onForward}
              title="Forward (f)"
              aria-label="Forward (f)"
              className="w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 hover:text-accent hover:bg-accent/10 transition-all duration-150 active:scale-90 active:translate-y-0.5 touch-manipulation shrink-0"
            />
            <Separator />
          </>
        )}

        {/* Core actions group */}
        <Button
          variant="secondary"
          iconOnly
          icon={<Archive size={17} className="transition-transform group-hover:scale-110 active:scale-90" />}
          onClick={handleArchive}
          title="Archive (e)"
          aria-label="Archive (e)"
          className="hover:text-accent hover:bg-accent/10 active:bg-accent/20 active:text-accent active:scale-90 active:translate-y-0.5 w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 touch-manipulation shrink-0 rounded-lg sm:rounded-md"
        />
        <Button
          variant="secondary"
          iconOnly
          icon={<Trash2 size={16} />}
          onClick={handleDelete}
          title={activeLabel === "trash" ? "Delete permanently (#)" : "Delete (#)"}
          aria-label={activeLabel === "trash" ? "Delete permanently" : "Delete"}
          className="hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 active:bg-red-500/25 active:text-red-600 dark:active:text-red-400 active:scale-90 active:ring-2 active:ring-red-500/30 w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 touch-manipulation shrink-0"
        />
        <Button
          variant="secondary"
          iconOnly
          icon={
            thread.isRead ? (
              <Mail size={17} className="transition-transform group-hover:scale-110 active:scale-90" />
            ) : (
              <MailOpen size={17} className="text-accent transition-transform group-hover:scale-110 active:scale-90" />
            )
          }
          onClick={handleToggleRead}
          title={thread.isRead ? "Mark unread" : "Mark read"}
          aria-label={thread.isRead ? "Mark unread" : "Mark read"}
          className={`w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 active:translate-y-0.5 touch-manipulation shrink-0 rounded-lg sm:rounded-md ${
            !thread.isRead
              ? "text-accent bg-accent/15 hover:bg-accent/25 hover:text-accent-hover ring-1 ring-accent/30 active:bg-accent/30 shadow-2xs"
              : "hover:text-accent hover:bg-accent/10 active:bg-accent/20 active:text-accent"
          }`}
        />
        <Button
          variant="secondary"
          iconOnly
          icon={
            <Star
              size={17}
              className={`transition-all duration-200 ${
                thread.isStarred
                  ? "fill-amber-400 text-amber-500 dark:text-amber-400 star-animate drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]"
                  : "transition-transform hover:scale-110 active:scale-95"
              }`}
            />
          }
          onClick={handleToggleStar}
          title={thread.isStarred ? "Unstar (s)" : "Star (s)"}
          aria-label={thread.isStarred ? "Unstar" : "Star"}
          className={`w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-200 active:scale-90 active:bg-amber-500/30 touch-manipulation shrink-0 ${
            thread.isStarred
              ? "text-amber-500 dark:text-amber-400 bg-amber-500/15 hover:bg-amber-500/25 ring-1 ring-amber-500/30 shadow-xs"
              : "hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10"
          }`}
        />
        <Button
          variant="secondary"
          iconOnly
          icon={<Clock size={16} />}
          onClick={() => setShowSnooze(true)}
          title="Snooze (h)"
          className="w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-95 touch-manipulation shrink-0"
        />
        <Button
          variant="secondary"
          iconOnly
          icon={<Ban size={16} className={isSpamView ? "text-success" : "transition-transform group-hover:scale-105"} />}
          onClick={handleSpam}
          title={isSpamView ? "Not Spam (!)" : "Report Spam (!)"}
          aria-label={isSpamView ? "Not Spam" : "Report Spam"}
          className={`w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-95 touch-manipulation shrink-0 ${
            isSpamView
              ? "text-success hover:bg-success/15 hover:text-success ring-1 ring-success/30"
              : "hover:text-danger hover:bg-danger/10"
          }`}
        />
        <Button
          variant="secondary"
          iconOnly
          icon={<FolderInput size={16} />}
          onClick={() => {
            if (!activeAccountId) return;
            window.dispatchEvent(new CustomEvent("velo-move-to-folder", { detail: { threadIds: [thread.id] } }));
          }}
          title="Move to folder (v)"
          aria-label="Move to folder"
          className="w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 touch-manipulation shrink-0"
        />
        <Button
          variant="secondary"
          iconOnly
          icon={
            <Pin
              size={16}
              className={`transition-transform duration-200 ${
                thread.isPinned ? "fill-current -rotate-45 pin-animate text-accent" : "group-hover:-rotate-12"
              }`}
            />
          }
          onClick={handleTogglePin}
          title={thread.isPinned ? "Unpin (p)" : "Pin (p)"}
          aria-label={thread.isPinned ? "Unpin (p)" : "Pin (p)"}
          className={`group w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 touch-manipulation shrink-0 ${
            thread.isPinned
              ? "text-accent bg-accent/15 border border-accent/30 hover:bg-accent/25 hover:text-accent font-semibold shadow-xs ring-1 ring-accent/30"
              : "hover:text-accent hover:bg-accent/10"
          }`}
        />
        <Button
          variant="secondary"
          iconOnly
          icon={<VolumeX size={16} className={thread.isMuted ? "fill-current" : ""} />}
          onClick={handleToggleMute}
          title={thread.isMuted ? "Unmute (m)" : "Mute (m)"}
          aria-label={thread.isMuted ? "Unmute" : "Mute"}
          className={`w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 touch-manipulation shrink-0 ${thread.isMuted ? "text-warning bg-warning/10 hover:bg-warning/20 hover:text-warning" : ""}`}
        />
        {hasFollowUp ? (
          <Button
            variant="secondary"
            iconOnly
            icon={<BellRing size={16} className="fill-current" />}
            onClick={handleCancelFollowUp}
            title="Cancel follow-up reminder"
            aria-label="Cancel follow-up reminder"
            className="w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 touch-manipulation shrink-0 text-accent bg-accent/10 hover:bg-accent/20 hover:text-accent"
          />
        ) : (
          <Button
            variant="secondary"
            iconOnly
            icon={<BellRing size={16} />}
            onClick={() => setShowFollowUp(true)}
            title="Remind me if no reply"
            aria-label="Remind me if no reply"
            className="w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 touch-manipulation shrink-0"
          />
        )}
        {hasUnsubscribe && (
          <Button
            variant="secondary"
            iconOnly
            icon={<MailMinus size={16} />}
            onClick={handleUnsubscribe}
            title={unsubscribeStatus === "loading" ? "Unsubscribing..." : unsubscribeStatus === "done" ? "Unsubscribed" : "Unsubscribe (u)"}
            aria-label="Unsubscribe"
            className={`w-12 h-12 min-w-[48px] min-h-[48px] sm:w-auto sm:h-auto sm:min-w-0 sm:min-h-0 transition-all duration-150 active:scale-90 touch-manipulation shrink-0 ${unsubscribeStatus === "done" ? "text-success bg-success/10" : ""}`}
          />
        )}

        {/* Spacer */}
        <div className="hidden sm:block ml-auto" />

        {/* Utility group (desktop/tablet only) */}
        <Button variant="secondary" iconOnly icon={<Printer size={15} />} onClick={onPrint} title="Print" className="hidden sm:inline-flex transition-all duration-150 active:scale-95" />
        <Button variant="secondary" iconOnly icon={<Download size={15} />} onClick={onExport} title="Export thread (.eml, .mbox)" className="hidden sm:inline-flex transition-all duration-150 active:scale-95" />
        <Button variant="secondary" iconOnly icon={<ExternalLink size={15} />} onClick={onPopOut} title="Open in new window" className="hidden sm:inline-flex transition-all duration-150 active:scale-95" />
        <Button
          variant="secondary"
          iconOnly
          icon={<ListTodo size={15} className={taskSidebarVisible ? "text-accent" : ""} />}
          onClick={onToggleTaskSidebar}
          title={taskSidebarVisible ? "Hide task panel" : "Show task panel"}
          className={`hidden sm:inline-flex transition-all duration-150 active:scale-95 ${taskSidebarVisible ? "text-accent bg-accent/10 hover:bg-accent/20 hover:text-accent" : ""}`}
        />
        <Button
          variant="secondary"
          iconOnly
          icon={contactSidebarVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          onClick={onToggleContactSidebar}
          title={contactSidebarVisible ? "Hide contact sidebar" : "Show contact sidebar"}
          className={`hidden sm:inline-flex transition-all duration-150 active:scale-95 ${contactSidebarVisible ? "text-accent bg-accent/10 hover:bg-accent/20 hover:text-accent" : ""}`}
        />
      </div>

      <SnoozeDialog
        isOpen={showSnooze}
        onSnooze={handleSnooze}
        onClose={() => setShowSnooze(false)}
      />
      <FollowUpDialog
        isOpen={showFollowUp}
        onSetReminder={handleFollowUp}
        onClose={() => setShowFollowUp(false)}
      />
    </>
  );
}
