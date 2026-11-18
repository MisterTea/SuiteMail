import { useState, useEffect, useCallback } from "react";
import { Calendar, MapPin, User, Check, X, Clock, ExternalLink, AlertCircle } from "lucide-react";
import type { InviteDetails, InviteResponseStatus } from "@/services/calendar/types";
import type { DbMessage } from "@/services/db/messages";
import { respondToInvite, getExistingEventRsvp } from "@/services/calendar/inviteDetector";
import { useAccountStore } from "@/stores/accountStore";
import { navigateToLabel } from "@/router/navigate";

interface CalendarInviteBannerProps {
  message: DbMessage;
  invite: InviteDetails;
}

export function CalendarInviteBanner({ message, invite }: CalendarInviteBannerProps) {
  const activeAccount = useAccountStore((s) =>
    s.accounts.find((a) => a.id === message.account_id) ?? s.accounts[0],
  );

  const [currentRsvp, setCurrentRsvp] = useState<InviteResponseStatus | "needs-action" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const userEmail = activeAccount?.email ?? "";
  const userDisplayName = activeAccount?.displayName ?? undefined;

  useEffect(() => {
    if (!userEmail) return;
    getExistingEventRsvp(message.account_id, invite.uid, userEmail).then((status) => {
      if (status) {
        setCurrentRsvp(status);
      }
    });
  }, [message.account_id, invite.uid, userEmail]);

  const handleRsvp = useCallback(
    async (responseStatus: InviteResponseStatus) => {
      if (!userEmail || submitting) return;
      setSubmitting(true);
      setStatusMessage(null);

      try {
        const res = await respondToInvite({
          accountId: message.account_id,
          message,
          invite,
          responseStatus,
          userEmail,
          userDisplayName,
        });

        if (res.success) {
          setCurrentRsvp(responseStatus);
          setStatusMessage(
            responseStatus === "accepted"
              ? "You accepted this invitation and added it to your calendar."
              : responseStatus === "declined"
                ? "You declined this invitation."
                : "You responded tentative to this invitation.",
          );
        } else {
          setStatusMessage("Failed to send response: " + (res.error ?? "unknown error"));
        }
      } catch {
        setStatusMessage("Error sending response");
      } finally {
        setSubmitting(false);
      }
    },
    [message, invite, userEmail, userDisplayName, submitting],
  );

  const handleDownloadIcs = useCallback(() => {
    try {
      const icsData =
        invite.icalData ||
        `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//SuiteMail//Calendar//EN\nBEGIN:VEVENT\nSUMMARY:${invite.summary}\nUID:${invite.uid}\nEND:VEVENT\nEND:VCALENDAR`;
      const blob = new Blob([icsData], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(invite.summary || "event").replace(/[^a-zA-Z0-9_-]/g, "_")}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback
    }
  }, [invite]);

  const startDate = invite.startTime ? new Date(invite.startTime * 1000) : null;
  const endDate = invite.endTime ? new Date(invite.endTime * 1000) : null;

  // Calendar tear-off badge metadata
  const monthBadge = startDate
    ? startDate.toLocaleDateString(undefined, { month: "short" }).toUpperCase()
    : "CAL";
  const dayBadge = startDate ? startDate.getDate() : null;
  const weekdayBadge = startDate
    ? startDate.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()
    : "";

  const formatInviteTime = () => {
    if (!startDate) return "";

    if (invite.isAllDay) {
      return startDate.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }

    const dateStr = startDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const startTimeStr = startDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    const endTimeStr = endDate
      ? endDate.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : "";

    return `${dateStr} · ${startTimeStr} – ${endTimeStr}`;
  };

  const isErrorStatus = statusMessage?.startsWith("Failed") || statusMessage?.startsWith("Error");

  return (
    <div className="mb-4 mx-2 sm:mx-4 rounded-2xl border border-border-primary/90 dark:border-border-secondary/80 bg-gradient-to-br from-bg-primary via-bg-primary to-accent/[0.04] dark:from-bg-secondary dark:via-bg-secondary dark:to-accent/[0.08] p-3.5 sm:p-4 text-sm transition-all shadow-sm relative overflow-hidden">
      {/* Top Section: Date Badge & Event Details */}
      <div className="flex items-start gap-3 sm:gap-3.5 min-w-0">
        {/* Calendar Tear-Off Badge */}
        <div className="shrink-0 flex flex-col items-center justify-between w-13 h-15 rounded-xl overflow-hidden border border-border-secondary/90 bg-bg-primary dark:bg-bg-tertiary shadow-xs select-none">
          {/* Tear-off top header band */}
          <div className="w-full bg-red-600 dark:bg-red-500 text-white text-[10px] font-extrabold tracking-widest uppercase text-center py-0.5 leading-tight shadow-inner">
            {monthBadge}
          </div>
          {/* Day number & Weekday */}
          <div className="flex-1 w-full flex flex-col items-center justify-center py-0.5 bg-gradient-to-b from-bg-primary to-bg-secondary/40 dark:from-bg-secondary dark:to-bg-tertiary/70">
            {dayBadge !== null ? (
              <>
                <span className="text-xl font-black text-text-primary leading-none tracking-tight">
                  {dayBadge}
                </span>
                {weekdayBadge && (
                  <span className="text-[9px] font-bold text-text-tertiary tracking-wider uppercase mt-0.5">
                    {weekdayBadge}
                  </span>
                )}
              </>
            ) : (
              <Calendar size={18} className="text-accent" />
            )}
          </div>
        </div>

        {/* Event Information */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-text-primary text-base leading-snug tracking-tight">
              {invite.summary}
            </h3>
            {currentRsvp && (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full transition-all shadow-xs ${
                  currentRsvp === "accepted"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                    : currentRsvp === "declined"
                      ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                }`}
              >
                {currentRsvp === "accepted" ? (
                  <>
                    <Check size={12} className="stroke-[3]" />
                    <span>Accepted</span>
                  </>
                ) : currentRsvp === "declined" ? (
                  <>
                    <X size={12} className="stroke-[3]" />
                    <span>Declined</span>
                  </>
                ) : (
                  <>
                    <Clock size={12} className="stroke-[3]" />
                    <span>Tentative</span>
                  </>
                )}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-1.5 text-xs text-text-secondary">
            <div className="font-semibold text-text-primary flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-accent/10 dark:bg-accent/20 flex items-center justify-center shrink-0">
                <Clock size={12} className="text-accent shrink-0" />
              </div>
              <span className="leading-tight">{formatInviteTime()}</span>
            </div>

            {invite.location && (
              <div className="flex items-center gap-2 text-text-secondary">
                <div className="w-5 h-5 rounded-md bg-bg-tertiary flex items-center justify-center shrink-0">
                  <MapPin size={12} className="shrink-0 text-text-tertiary" />
                </div>
                <span className="break-words leading-tight">{invite.location}</span>
              </div>
            )}

            {invite.organizerEmail && (
              <div className="flex items-center gap-2 text-text-tertiary">
                <div className="w-5 h-5 rounded-md bg-bg-tertiary flex items-center justify-center shrink-0">
                  <User size={12} className="shrink-0" />
                </div>
                <span className="truncate leading-tight">
                  Organizer: <span className="text-text-secondary font-medium">{invite.organizerEmail}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RSVP Action Buttons */}
      <div className="mt-3.5 pt-3 border-t border-border-secondary/60 flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-2 w-full">
          {/* Accept / Yes Button */}
          <button
            type="button"
            onClick={() => handleRsvp("accepted")}
            disabled={submitting}
            aria-label="Yes, Accept"
            className={`inline-flex flex-col sm:flex-row justify-center items-center gap-1 sm:gap-1.5 min-h-[48px] px-2 sm:px-3 py-2 text-xs font-medium rounded-xl transition-all duration-150 shadow-xs cursor-pointer select-none active:scale-95 touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed ${
              currentRsvp === "accepted"
                ? "bg-emerald-600 text-white border border-emerald-600 ring-2 ring-emerald-500/30 font-semibold shadow-sm"
                : currentRsvp
                  ? "bg-bg-tertiary/40 text-text-secondary border border-border-secondary/80 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300 hover:border-emerald-500/30"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/20 hover:border-emerald-500/40"
            }`}
          >
            <Check size={15} className={`shrink-0 ${currentRsvp === "accepted" ? "stroke-[3]" : "stroke-[2.5]"}`} />
            <div className="flex items-center gap-1">
              <span className="font-bold text-xs">Yes</span>
              <span className="text-[11px] opacity-80 font-normal">Accept</span>
            </div>
          </button>

          {/* Tentative / Maybe Button */}
          <button
            type="button"
            onClick={() => handleRsvp("tentative")}
            disabled={submitting}
            aria-label="Maybe, Tentative"
            className={`inline-flex flex-col sm:flex-row justify-center items-center gap-1 sm:gap-1.5 min-h-[48px] px-2 sm:px-3 py-2 text-xs font-medium rounded-xl transition-all duration-150 shadow-xs cursor-pointer select-none active:scale-95 touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed ${
              currentRsvp === "tentative"
                ? "bg-amber-600 text-white border border-amber-600 ring-2 ring-amber-500/30 font-semibold shadow-sm"
                : currentRsvp
                  ? "bg-bg-tertiary/40 text-text-secondary border border-border-secondary/80 hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-300 hover:border-amber-500/30"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25 hover:bg-amber-500/20 hover:border-amber-500/40"
            }`}
          >
            <Clock size={15} className={`shrink-0 ${currentRsvp === "tentative" ? "stroke-[3]" : "stroke-[2.5]"}`} />
            <div className="flex items-center gap-1">
              <span className="font-bold text-xs">Maybe</span>
              <span className="text-[11px] opacity-80 font-normal">Tentative</span>
            </div>
          </button>

          {/* Decline / No Button */}
          <button
            type="button"
            onClick={() => handleRsvp("declined")}
            disabled={submitting}
            aria-label="No, Decline"
            className={`inline-flex flex-col sm:flex-row justify-center items-center gap-1 sm:gap-1.5 min-h-[48px] px-2 sm:px-3 py-2 text-xs font-medium rounded-xl transition-all duration-150 shadow-xs cursor-pointer select-none active:scale-95 touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed ${
              currentRsvp === "declined"
                ? "bg-rose-600 text-white border border-rose-600 ring-2 ring-rose-500/30 font-semibold shadow-sm"
                : currentRsvp
                  ? "bg-bg-tertiary/40 text-text-secondary border border-border-secondary/80 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300 hover:border-rose-500/30"
                  : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25 hover:bg-rose-500/20 hover:border-rose-500/40"
            }`}
          >
            <X size={15} className={`shrink-0 ${currentRsvp === "declined" ? "stroke-[3]" : "stroke-[2.5]"}`} />
            <div className="flex items-center gap-1">
              <span className="font-bold text-xs">No</span>
              <span className="text-[11px] opacity-80 font-normal">Decline</span>
            </div>
          </button>
        </div>

        {/* Status Confirmation Banner */}
        {statusMessage && (
          <div
            className={`flex items-center gap-2 text-xs font-medium rounded-xl p-3 animate-fade-in transition-all ${
              isErrorStatus
                ? "bg-rose-500/10 text-rose-800 dark:text-rose-200 border border-rose-500/30"
                : currentRsvp === "accepted"
                  ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-500/30"
                  : currentRsvp === "declined"
                    ? "bg-rose-500/10 text-rose-800 dark:text-rose-200 border border-rose-500/30"
                    : "bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/30"
            }`}
          >
            {!isErrorStatus && currentRsvp === "accepted" && (
              <Check size={14} className="shrink-0 stroke-[2.5] text-emerald-600 dark:text-emerald-400" />
            )}
            {!isErrorStatus && currentRsvp === "declined" && (
              <X size={14} className="shrink-0 stroke-[2.5] text-rose-600 dark:text-rose-400" />
            )}
            {!isErrorStatus && currentRsvp === "tentative" && (
              <Clock size={14} className="shrink-0 stroke-[2.5] text-amber-600 dark:text-amber-400" />
            )}
            {isErrorStatus && <AlertCircle size={14} className="shrink-0 text-rose-600 dark:text-rose-400" />}
            <span className="leading-relaxed">{statusMessage}</span>
          </div>
        )}

        {/* Auxiliary Calendar Affordances: Open in Calendar & Add to Calendar (.ics) */}
        <div className="flex items-center gap-2 pt-1 border-t border-border-secondary/40">
          <button
            type="button"
            onClick={() => navigateToLabel("calendar")}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-text-secondary hover:text-accent hover:bg-accent/10 active:scale-95 min-h-[44px] px-3 py-2 rounded-xl border border-border-secondary/70 transition-all touch-manipulation cursor-pointer"
            title="Open in Calendar"
          >
            <ExternalLink size={13} className="shrink-0" />
            <span>Open in Calendar</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadIcs}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-text-secondary hover:text-accent hover:bg-accent/10 active:scale-95 min-h-[44px] px-3 py-2 rounded-xl border border-border-secondary/70 transition-all touch-manipulation cursor-pointer"
            title="Add to Calendar"
          >
            <Calendar size={13} className="shrink-0" />
            <span>Add to Calendar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
