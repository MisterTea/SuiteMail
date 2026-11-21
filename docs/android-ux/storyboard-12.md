# Storyboard 12 — Mark as unread

Evidence: `recordings/android/storyboard-12-mark-as-unread.png` shows the open “Annual Benefits Enrollment Deadline” message, an envelope control at the toolbar’s right edge, and a bottom toast whose outcome is truncated to “Marked…” while its “Mark as read” action remains visible. The message-count chip does not identify read state. The still establishes unclear confirmation, but cannot prove persistence or a delayed read-state race. Current `ActionBar.tsx` already provides an Android More actions sheet and state-dependent “Mark unread” / “Mark read” labels; `ThreadCard.tsx` distinguishes unread rows with bold text, dots, and an accessible unread prefix.

## 1. Name the current state and the target action

**Change:** In the mobile Message actions sheet show “Currently read” or “Currently unread” beside the subject, followed by the exact target action “Mark as unread” or “Mark as read.” Pair the action with closed/open envelope icons respectively. Keep the visible More trigger and make this action a minimum 48-pixel-high full-width row; avoid relying on the captured icon-only toolbar or hover titles. Include read state explicitly in each inbox row’s accessible name, preserving the existing bold/dot unread treatment.

**Acceptance:** At 360 and 412 CSS-pixel widths, More and the read-state action are reachable without horizontal scrolling or long-pressing. TalkBack announces the current state and intended action separately. After changing to unread, the action becomes “Mark as read,” and the inbox row announces “Unread.” Labels remain readable with enlarged text, and focus returns to the invoking control when the sheet closes.

## 2. Keep the whole result readable and reversible

**Change:** Show the complete outcome “Marked as unread” with a short “Undo” action instead of competing long labels. Permit the outcome to wrap above a separate action row on narrow screens. Announce it as an accessible status above bottom navigation, with at least a 48 × 48-pixel Undo target. Retain the prior state for Undo; prevent repeat submissions while saving and surface a visible failure if the change or reversal fails.

**Acceptance:** At 360 pixels and enlarged text, neither “Marked as unread” nor Undo is ellipsized or covered by navigation. One activation changes only the selected conversation and announces one result. Undo restores its prior state; failed operations restore the previous representation and announce a clear error rather than a success message. The result stays visible long enough to read and activate Undo, respecting accessibility timeout preferences.

## 3. Preserve explicit unread intent in the open message

**Evidence:** `ThreadView.tsx` automatically marks a newly opened unread thread read, immediately or after two seconds depending on settings. Its per-thread guard helps avoid repeated marking, but the existing delayed callback should be checked against an explicit unread choice during that interval.

**Change:** Treat an explicit “Mark as unread” as authoritative for the current viewing session. Cancel or invalidate pending automatic-read work for that thread before applying it. Keep the open message visible, preserve scroll position, and leave it unread when returning to the list. A fresh, deliberate reopening may follow the user’s automatic-read preference again.

**Acceptance:** With the two-second preference, mark unread before the delay expires and wait beyond two seconds: the conversation remains unread. Repeat after instant marking and in manual mode. Scrolling, opening More, and returning to the list never silently reverse the explicit choice. The inbox row shows its unread dot/bold state, and reloading the list retains persisted unread state. Undo and an explicit “Mark as read” still work; moving to a different thread does not inherit the previous thread’s suppression.
