# Storyboard 09 — Pin urgent thread

Evidence: `recordings/android/storyboard-9-pin-urgent-thread.png` shows adjacent unlabeled outline Pin and Star icons on Inbox rows and a “Thread pinned to top” toast. The captured viewport remains mid-list, with no visible Pinned section or pinned destination. This establishes a discoverability and confirmation gap; the static image cannot establish whether scrolling or reordering occurred.

## 1. Expose Pin in a labeled mobile action menu

**Evidence:** `ActionBar.tsx` renders Pin late in a horizontally scrolling strip of icon-only controls; `ThreadCard.tsx` relies on an unlabeled quick Pin icon or context interaction. Tooltips and desktop shortcut labels do not teach a touch user what Pin does.

**Change:** Add an always-visible “More actions” button on phones, opening labeled actions. Include “Pin to top” with supporting text “Keep at the top of this list,” changing to “Unpin” when active. Keep the row shortcut as an optional convenience. Use at least 48 × 48 CSS pixels for the trigger and quick Pin/Star controls, and at least 48 pixels of height for each menu action; the current card minimum is 44 pixels and drops to 28 at `sm`.

**Acceptance:** At 360 and 412 CSS-pixel widths, a user opens More actions and finds Pin without scrolling the toolbar, hovering, or long-pressing. One tap pins exactly once without opening the row; TalkBack announces the action and active state. Targets remain at least 48 pixels throughout phone layouts, including landscape below the tablet breakpoint. Dismissal restores focus to the trigger.

## 2. Explain Pin separately from Star

**Evidence:** The screenshot puts similarly weighted Pin and Star icons side by side. `ThreadCard.tsx` already has a textual Pinned badge and `ActionBar.tsx` has independent Pin and Star handlers; preserve that independence while making the meanings explicit.

**Change:** In the same mobile menu, label Star “Star” with supporting text “Save in Starred,” and Pin “Pin to top.” Show a pin symbol plus “Pinned” on pinned rows; retain the distinct star shape and amber filled state for starred rows. Expose pressed states and action names without desktop shortcut suffixes.

**Acceptance:** Pinning an unstarred thread leaves it absent from Starred; starring an unpinned thread does not pin it. A thread can have both states. Unpin changes only Pin, and Unstar changes only Star. Both states remain identifiable without relying on color, with TalkBack announcing each toggle independently.

## 3. Make the pinned destination obvious

**Evidence:** `EmailList.tsx` already sorts pinned threads first and renders a Pinned heading/count plus an Other emails divider, but only when their rows enter the viewport. Bundle rows render ahead of this section. The screenshot's success toast alone does not reveal where the urgent thread went.

**Change:** Put the Pinned group before bundle rows in the current filtered list, with a clear “Pinned” heading/count and “Other emails” boundary. After pinning from a scrolled position, retain the reading position and show “Pinned to top” with a 48-pixel-high “View” action that reveals and focuses the pinned row. Use accessible status feedback; offer “Undo” when space allows or retain direct Unpin in the menu. On persistence failure, restore the previous state and announce failure.

**Acceptance:** Pin from mid-list, tap View, and see the correct thread under Pinned above bundles. The count increments once; unpinning the last thread removes the empty section. Reopening the list retains persisted pin order. Filtering shows only matching pinned threads and accurate matching counts. At 360-pixel width with enlarged text, heading, row state, and View remain readable and reachable above bottom navigation. A failed save never leaves a success message or a falsely pinned row.
