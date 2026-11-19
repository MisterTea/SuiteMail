import { useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useThreadStore } from "@/stores/threadStore";
import { useAccountStore } from "@/stores/accountStore";
import { addThreadLabel, removeThreadLabel } from "@/services/emailActions";
import { gmailNavSpec } from "@/constants/gmailSidebar";

// Map sidebar IDs to Gmail label IDs (same as EmailList)
const LABEL_MAP: Record<string, string> = {
  inbox: "INBOX",
  starred: "STARRED",
  sent: "SENT",
  drafts: "DRAFT",
  trash: "TRASH",
  spam: "SPAM",
  snoozed: "SNOOZED",
  all: "",
};

export interface DragData {
  threadIds: string[];
  sourceLabel: string;
}

/**
 * Determine which Gmail labels to add/remove when moving threads between labels.
 * Returns null if no change should be made (same label, or invalid).
 */
export function resolveLabelChange(
  targetSidebarId: string,
  sourceLabel: string,
): { addLabelIds: string[]; removeLabelIds: string[]; stayInView?: boolean } | null {
  const targetSpec = gmailNavSpec(targetSidebarId);
  if (targetSpec) {
    const sourceSpec = gmailNavSpec(sourceLabel);
    if (sourceSpec?.id === targetSpec.id) return null;
    // Important and categories are labels, not folders. Dropping mail on
    // them must not archive it. Moving between categories replaces the old one.
    const removeLabelIds = sourceSpec?.inboxOnly && targetSpec.inboxOnly
      ? [sourceSpec.gmailLabelId]
      : [];
    return {
      addLabelIds: [targetSpec.gmailLabelId],
      removeLabelIds,
      stayInView: removeLabelIds.length === 0,
    };
  }

  if (targetSidebarId === "focused") {
    if (sourceLabel === "focused") return null;
    return { addLabelIds: ["INBOX", "FOCUSED"], removeLabelIds: [] };
  }
  if (targetSidebarId === "other") {
    if (sourceLabel === "other") return null;
    return { addLabelIds: ["INBOX"], removeLabelIds: ["FOCUSED"] };
  }

  const targetGmailId = LABEL_MAP[targetSidebarId] ?? targetSidebarId;
  const sourceGmailId = LABEL_MAP[sourceLabel] ?? sourceLabel;

  // No-op if same label
  if (targetGmailId === sourceGmailId) return null;

  // Dragging to trash: add TRASH, remove source (if specific)
  if (targetGmailId === "TRASH") {
    const removeLabelIds = sourceGmailId && sourceGmailId !== "" ? [sourceGmailId] : [];
    return { addLabelIds: ["TRASH"], removeLabelIds };
  }

  // Dragging from "all mail": only add target (don't remove anything)
  if (sourceLabel === "all" || sourceGmailId === "") {
    if (!targetGmailId) return null;
    return { addLabelIds: [targetGmailId], removeLabelIds: [] };
  }

  // Normal case: add target, remove source
  if (!targetGmailId) return null;
  return { addLabelIds: [targetGmailId], removeLabelIds: [sourceGmailId] };
}

interface DndProviderProps {
  children: ReactNode;
}

export function DndProvider({ children }: DndProviderProps) {
  const [dragData, setDragData] = useState<DragData | null>(null);
  const removeThreads = useThreadStore((s) => s.removeThreads);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (data) {
      setDragData(data);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { over } = event;
    setDragData(null);

    if (!over || !dragData || !activeAccountId) return;

    const targetLabel = over.id as string;
    const change = resolveLabelChange(targetLabel, dragData.sourceLabel);
    if (!change) return;

    try {
      for (const threadId of dragData.threadIds) {
        for (const labelId of change.addLabelIds) {
          await addThreadLabel(activeAccountId, threadId, labelId);
        }
        for (const labelId of change.removeLabelIds) {
          await removeThreadLabel(activeAccountId, threadId, labelId);
        }
      }
      // Important and category drops keep the thread in the current folder.
      if (!change.stayInView) {
        removeThreads(dragData.threadIds);
      }
    } catch (err) {
      console.error("Failed to move threads:", err);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragData && (
          <div className="bg-accent text-white text-sm font-medium px-3 py-1.5 rounded-lg shadow-lg pointer-events-none">
            {dragData.threadIds.length === 1
              ? "1 conversation"
              : `${dragData.threadIds.length} conversations`}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
