# Storyboard 11 — Organize / Move to Folder

Evidence: `recordings/android/storyboard-11-organize-move-to-folder.png` shows Inbox after a move, with “Moved to Projects” above bottom navigation. It establishes useful destination feedback, but does not show the trigger, chooser, keyboard behavior, or selected destination. `MoveToFolderDialog.tsx` already provides a full-width phone sheet, searchable destinations and generous rows; both `autoFocus` and `handleEntered` force search focus. Its initial index also marks Inbox with a check before the user chooses anything. `Sidebar.tsx` provides folder/label navigation and drag targets; desktop drag-and-drop and hover-only label editing are insufficient as the phone's move path.

## 1. Make Move a labeled touch action

**Change:** Expose a folder icon plus visible “Move” in the mobile thread actions and selected-thread actions. If space requires an overflow menu, its visible, 48 × 48 CSS-pixel “More actions” trigger must reveal a full-width “Move to folder” row. Keep sidebar folder navigation distinct from moving selected mail; do not require dragging into Sidebar or long-pressing to discover Move.

**Acceptance:** At 360 and 412 CSS pixels, open one thread or select multiple threads and reach the labeled Move action without horizontal toolbar scrolling or hovering. TalkBack announces “Move to folder” and the chooser identifies the number of selected conversations. Closing returns focus to the initiating action without moving messages.

## 2. Open a searchable sheet without the keyboard

**Change:** Preserve the edge-to-edge bottom sheet on phones, titled “Move to folder,” with the selected conversation count, an explicitly labeled “Search folders or labels” input, scrollable destination list and reachable Close control. Remove automatic search focus on touch devices; focus the sheet heading/container instead. Open the keyboard only after a search-field tap. Use at least 48-pixel targets for Close, Clear search and creation actions, and account for Android safe areas and the visible viewport when the keyboard opens.

**Acceptance:** Opening on an Android phone leaves the keyboard closed and displays destinations immediately. Tapping Search opens the keyboard and filters case-insensitively; clearing restores all destinations. At 360-pixel width and enlarged text, there is no horizontal overflow and the list remains scrollable with the keyboard visible. Close and creation controls remain reachable above system navigation; desktop keyboard navigation still works.

## 3. Distinguish a destination choice from successful completion

**Change:** Keep each entire destination row tappable with at least 48-pixel height and readable folder names. Do not show a mobile check on the default keyboard-highlighted Inbox row: keyboard focus is not a chosen destination. On a deliberate row tap, indicate the chosen name and pending state, prevent duplicate submission, then dismiss only after success and announce “Moved to [destination].” Preserve the captured destination toast above bottom navigation. On failure, retain the chooser and announce a retryable error rather than success. Show long or nested folder names through wrapping or a secondary path so users can distinguish destinations.

**Acceptance:** A fresh chooser has no falsely selected destination. Tapping Projects moves exactly the selected conversations once, produces “Moved to Projects,” and refreshes the source list; repeated taps while pending cannot duplicate the operation. A failed move keeps the destination available for retry and never reports success. Multiple same-name nested destinations are distinguishable. With TalkBack and enlarged text, destination names, pending/error feedback and the success status are understandable without color alone.
