import { useRef, type PointerEvent, type MouseEvent } from "react";

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
