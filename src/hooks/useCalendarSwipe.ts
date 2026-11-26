import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent } from "react";

export const CALENDAR_SNAP_DURATION_MS = 100;

/** Keep vertical scrolling native; reserve horizontal touch gestures for dates. */
export function useCalendarSwipe(onPrevious: () => void, onNext: () => void) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    axis: "horizontal" | "vertical" | null;
  } | null>(null);
  const suppressClick = useRef(false);

  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      suppressClick.current = false;
      if (event.pointerType !== "touch" || !event.isPrimary) {
        gesture.current = null;
        return;
      }
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = Math.abs(event.clientX - start.x);
      const dy = Math.abs(event.clientY - start.y);
      if (!start.axis && Math.max(dx, dy) >= 10) {
        start.axis = dx > dy ? "horizontal" : "vertical";
      }
      if (start.axis === "horizontal") suppressClick.current = true;
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      gesture.current = null;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.axis === "vertical" || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      suppressClick.current = true;
      if (dx < 0) onNext();
      else onPrevious();
    },
    onPointerCancel() {
      gesture.current = null;
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}

export interface FluidCalendarSwipeOptions {
  /** Pixel width of one snap unit (e.g., 1 day column or 1 month page). */
  getStepPx: () => number;
  /** Maximum number of snap units the user can drag in one gesture. */
  maxSteps: number;
  /** Called after the snap animation finishes when deltaSteps !== 0 (+ = forward, - = backward). */
  onSnap: (deltaSteps: number) => void;
  /** Snap animation duration in milliseconds (defaults to 100ms). */
  snapDurationMs?: number;
}

export interface FluidCalendarSwipeResult {
  offsetPx: number;
  isSnapping: boolean;
  snapDurationMs: number;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: () => void;
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  };
}

/**
 * Fluid horizontal touch swipe for calendar views.
 * Tracks horizontal finger movement 1:1 while preserving native vertical scroll,
 * then snaps to the nearest day/month boundary with a ~100ms ease-out animation.
 */
export function useFluidCalendarSwipe({
  getStepPx,
  maxSteps,
  onSnap,
  snapDurationMs = CALENDAR_SNAP_DURATION_MS,
}: FluidCalendarSwipeOptions): FluidCalendarSwipeResult {
  const [offsetPx, setOffsetPx] = useState(0);
  const [isSnapping, setIsSnapping] = useState(false);

  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    axis: "horizontal" | "vertical" | null;
    stepPx: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDelta = useRef<number>(0);
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;

  const flushPendingSnap = useCallback(() => {
    if (snapTimer.current !== null) {
      clearTimeout(snapTimer.current);
      snapTimer.current = null;
      const delta = pendingDelta.current;
      pendingDelta.current = 0;
      if (delta !== 0) onSnapRef.current(delta);
      setIsSnapping(false);
      setOffsetPx(0);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (snapTimer.current !== null) {
        clearTimeout(snapTimer.current);
        snapTimer.current = null;
      }
    };
  }, []);

  const clampOffset = useCallback(
    (dx: number, stepPx: number) => {
      if (stepPx <= 0 || maxSteps <= 0) return 0;
      const maxPx = maxSteps * stepPx;
      return Math.max(-maxPx, Math.min(maxPx, dx));
    },
    [maxSteps],
  );

  const startSnapAnimation = useCallback(
    (deltaSteps: number, stepPx: number) => {
      const targetOffset = -deltaSteps * stepPx;
      pendingDelta.current = deltaSteps;
      setIsSnapping(true);
      setOffsetPx(targetOffset);

      if (snapTimer.current !== null) clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => {
        snapTimer.current = null;
        const delta = pendingDelta.current;
        pendingDelta.current = 0;
        if (delta !== 0) onSnapRef.current(delta);
        setIsSnapping(false);
        setOffsetPx(0);
      }, snapDurationMs);
    },
    [snapDurationMs],
  );

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      suppressClick.current = false;
      if (event.pointerType !== "touch" || !event.isPrimary) {
        gesture.current = null;
        return;
      }
      flushPendingSnap();
      const stepPx = Math.max(1, getStepPx());
      gesture.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: null,
        stepPx,
      };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      const rawDx = event.clientX - g.startX;
      const rawDy = event.clientY - g.startY;
      if (!g.axis && Math.max(Math.abs(rawDx), Math.abs(rawDy)) >= 10) {
        g.axis = Math.abs(rawDx) > Math.abs(rawDy) ? "horizontal" : "vertical";
      }
      if (g.axis !== "horizontal") return;
      suppressClick.current = true;
      setIsSnapping(false);
      setOffsetPx(clampOffset(rawDx, g.stepPx));
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      gesture.current = null;

      const rawDx = event.clientX - g.startX;
      const rawDy = event.clientY - g.startY;
      if (g.axis === "vertical") {
        setIsSnapping(false);
        setOffsetPx(0);
        return;
      }

      const clampedDx = clampOffset(rawDx, g.stepPx);
      let deltaSteps = Math.round(-clampedDx / g.stepPx);

      // Quick flick fallback when user swipes >= 48px horizontally on wide columns (e.g. 1-day or month)
      if (
        deltaSteps === 0 &&
        Math.abs(rawDx) >= 48 &&
        Math.abs(rawDx) >= Math.abs(rawDy) * 1.2
      ) {
        deltaSteps = rawDx < 0 ? 1 : -1;
      }

      deltaSteps = Math.max(-maxSteps, Math.min(maxSteps, deltaSteps));

      if (deltaSteps !== 0) {
        suppressClick.current = true;
        startSnapAnimation(deltaSteps, g.stepPx);
      } else if (g.axis === "horizontal") {
        // Snap smoothly back to 0 over 100ms
        startSnapAnimation(0, g.stepPx);
      }
    },
    onPointerCancel() {
      const g = gesture.current;
      gesture.current = null;
      if (g?.axis === "horizontal") {
        startSnapAnimation(0, g.stepPx);
      }
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };

  return { offsetPx, isSnapping, snapDurationMs, handlers };
}
