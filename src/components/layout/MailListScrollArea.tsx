import { Capacitor } from "@capacitor/core";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type RefObject } from "react";
import { triggerSync } from "@/services/gmail/syncManager";
import { useAccountStore } from "@/stores/accountStore";

const DRAG_SLOP = 8;
const REFRESH_THRESHOLD = 88;

interface MailListScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
  scrollRef?: RefObject<HTMLDivElement | null>;
  unified?: boolean;
}

export function MailListScrollArea({ scrollRef, unified = false, className = "", ...props }: MailListScrollAreaProps) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? localRef;
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const canRefresh = useAccountStore((s) => s.accounts.some((account) =>
    account.provider !== "caldav" && (unified ? account.isActive : account.id === activeAccountId),
  ));
  const enabled = ["android", "ios"].includes(Capacitor.getPlatform()) && canRefresh;
  const refreshing = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  useEffect(() => {
    const scrollArea = ref.current;
    if (!enabled || !scrollArea) return;
    let start: { x: number; y: number } | null = null;
    let distance = 0;

    const resetPull = () => {
      start = null;
      distance = 0;
      setPullDistance(0);
    };

    const onTouchStart = (event: TouchEvent) => {
      resetPull();
      const touch = event.touches[0];
      if (refreshing.current || scrollArea.scrollTop > 0 || event.touches.length !== 1 || !touch) return;
      start = { x: touch.clientX, y: touch.clientY };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1 || scrollArea.scrollTop > 0 || !event.cancelable) {
        resetPull();
        return;
      }
      const dx = Math.abs(touch.clientX - start.x);
      const dy = touch.clientY - start.y;
      if (distance === 0) {
        if (Math.max(dx, Math.abs(dy)) < DRAG_SLOP) return;
        if (dy <= dx) {
          resetPull();
          return;
        }
      }

      // Claim only the downward pull at the top so Android can scroll the list normally.
      event.preventDefault();
      distance = Math.max(0, dy);
      setPullDistance(distance);
    };

    const onTouchEnd = () => {
      const shouldSync = distance >= REFRESH_THRESHOLD;
      resetPull();
      if (!shouldSync || refreshing.current) return;
      const accountIds = unified
        ? useAccountStore.getState().accounts.filter((account) => account.isActive && account.provider !== "caldav").map((account) => account.id)
        : activeAccountId ? [activeAccountId] : [];
      if (!accountIds.length) return;
      refreshing.current = true;
      setIsRefreshing(true);
      void triggerSync(accountIds)
        .catch((error) => console.error("Manual sync failed:", error))
        .finally(() => {
          refreshing.current = false;
          setIsRefreshing(false);
        });
    };

    scrollArea.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollArea.addEventListener("touchmove", onTouchMove, { passive: false });
    scrollArea.addEventListener("touchend", onTouchEnd, { passive: true });
    scrollArea.addEventListener("touchcancel", resetPull, { passive: true });
    return () => {
      scrollArea.removeEventListener("touchstart", onTouchStart);
      scrollArea.removeEventListener("touchmove", onTouchMove);
      scrollArea.removeEventListener("touchend", onTouchEnd);
      scrollArea.removeEventListener("touchcancel", resetPull);
      resetPull();
    };
  }, [activeAccountId, enabled, ref, unified]);

  const progress = Math.min(pullDistance / REFRESH_THRESHOLD, 1);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        {...props}
        ref={ref}
        className={`min-h-0 flex-1 overflow-y-auto ${enabled ? "overscroll-y-none" : ""} ${className}`}
      />
      {enabled && (pullDistance > 0 || isRefreshing) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
          <div
            role={isRefreshing ? "status" : undefined}
            aria-hidden={isRefreshing ? undefined : true}
            className="flex size-10 items-center justify-center rounded-full border border-border-primary bg-bg-primary text-accent shadow-md"
            style={{
              opacity: isRefreshing ? 1 : progress,
              transform: `translateY(${isRefreshing ? 12 : progress * 52 - 40}px)`,
            }}
          >
            {isRefreshing && <span className="sr-only">Syncing mail…</span>}
            <span
              className={isRefreshing ? "motion-safe:animate-spin" : undefined}
              style={isRefreshing ? undefined : { transform: `rotate(${progress * 360}deg)` }}
            >
              <RefreshCw size={20} aria-hidden="true" className="block" />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
