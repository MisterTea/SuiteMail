import { useState, useEffect, useCallback } from "react";
import { Calendar, MapPin, User, Check, X, Clock, ExternalLink } from "lucide-react";
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
      } catch (err) {
        setStatusMessage("Error sending response");
      } finally {
        setSubmitting(false);
      }
    },
    [message, invite, userEmail, userDisplayName, submitting],
  );

  const formatInviteTime = () => {
    if (!invite.startTime) return "";
    const startDate = new Date(invite.startTime * 1000);
    const endDate = invite.endTime ? new Date(invite.endTime * 1000) : null;

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

  return (
    <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 dark:bg-accent/10 p-3.5 text-sm transition-all shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="rounded-md bg-accent/15 p-2 text-accent shrink-0 mt-0.5">
            <Calendar size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-text-primary text-base leading-tight">
                {invite.summary}
              </span>
              {currentRsvp && (
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    currentRsvp === "accepted"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                      : currentRsvp === "declined"
                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                        : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                  }`}
                >
                  {currentRsvp === "accepted"
                    ? "Accepted"
                    : currentRsvp === "declined"
                      ? "Declined"
                      : "Tentative"}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-col gap-1 text-xs text-text-secondary">
              <div className="font-medium text-text-primary flex items-center gap-1.5">
                <Clock size={13} className="text-accent" />
                <span>{formatInviteTime()}</span>
              </div>

              {invite.location && (
                <div className="flex items-center gap-1.5 truncate">
                  <MapPin size={13} className="shrink-0 text-text-tertiary" />
                  <span className="truncate">{invite.location}</span>
                </div>
              )}

              {invite.organizerEmail && (
                <div className="flex items-center gap-1.5 truncate text-text-tertiary">
                  <User size={13} className="shrink-0" />
                  <span>Organizer: {invite.organizerEmail}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => navigateToLabel("calendar")}
          className="flex items-center gap-1 text-xs text-text-tertiary hover:text-accent transition-colors shrink-0 px-2 py-1 rounded hover:bg-accent/10"
          title="Open in Calendar"
        >
          <ExternalLink size={13} />
          <span className="hidden sm:inline">Calendar</span>
        </button>
      </div>

      {/* RSVP Action Buttons */}
      <div className="mt-3 pt-3 border-t border-border-secondary/60 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRsvp("accepted")}
            disabled={submitting}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-xs ${
              currentRsvp === "accepted"
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-bg-primary text-text-primary border border-border-primary hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600"
            }`}
          >
            <Check size={13} />
            <span>Accept</span>
          </button>

          <button
            onClick={() => handleRsvp("tentative")}
            disabled={submitting}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-xs ${
              currentRsvp === "tentative"
                ? "bg-amber-600 text-white hover:bg-amber-700"
                : "bg-bg-primary text-text-primary border border-border-primary hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600"
            }`}
          >
            <Clock size={13} />
            <span>Tentative</span>
          </button>

          <button
            onClick={() => handleRsvp("declined")}
            disabled={submitting}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-xs ${
              currentRsvp === "declined"
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "bg-bg-primary text-text-primary border border-border-primary hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-600"
            }`}
          >
            <X size={13} />
            <span>Decline</span>
          </button>
        </div>

        {statusMessage && (
          <span className="text-xs text-text-secondary italic animate-fade-in">
            {statusMessage}
          </span>
        )}
      </div>
    </div>
  );
}
