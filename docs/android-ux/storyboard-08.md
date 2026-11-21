# Storyboard 08 — Star / flag important email

Evidence: `recordings/android/storyboard-8-star-flag-important-email.png` shows the Starred folder with one Finance Payroll conversation, a filled amber row star, a neighboring pin, and seven bottom navigation actions. The filled star and selected Starred destination already communicate success. A still image cannot establish tap accuracy, persistence, or screen-reader behavior.

## 1. Give the row star its own reliable touch target

**Evidence:** `ThreadCard.tsx` renders the star as a role-button span inside the thread-opening button, with a 44 × 44 CSS-pixel mobile minimum and negative margins. Click and touch propagation are stopped, but the nested interaction model and adjacent pin leave avoidable ambiguity.

**Change:** Make the star a native button beside the thread-opening control, with a minimum 48 × 48 CSS-pixel hit area that never overlaps Pin or the thread opener. Keep the outlined star visible on touch devices; retain the filled amber state after starring. Preserve event isolation for taps, keyboard activation, and row swipe initiation. Use the consistent term “Starred”; do not add a competing flag state.

**Acceptance:** At 360 and 412 CSS-pixel widths, in every density, taps at the star target’s center and edges toggle exactly once without opening, selecting, pinning, or swiping the thread. The adjacent subject still opens normally. Filled versus outlined shape distinguishes the states without color, and the selected state persists after leaving and returning to the list.

## 2. Expose the same accessible toggle state in list and reader

**Evidence:** `ThreadCard.tsx` and `ActionBar.tsx` change the accessible name between Star and Unstar but do not expose `aria-pressed`. The reader already specifies a 48-pixel mobile star target, and its successful action offers undo feedback; the list handler only logs failures.

**Change:** Give both native buttons a stable accessible name of “Star conversation” and `aria-pressed={thread.isStarred}`. Hide decorative star SVGs from accessibility, retain visible keyboard focus, and use matching filled/outline styling. Show concise “Added to Starred” / “Removed from Starred” feedback with Undo from either surface. Announce failures and restore the prior state; prevent duplicate pending toggles.

**Acceptance:** TalkBack announces a button with its pressed or unpressed state; Enter, Space, and touch each toggle once. List and reader immediately agree on state. A failed request leaves the original state and announces failure; Undo restores it. Feedback does not cover navigation or intercept the next row tap.

## 3. Preserve Starred discovery while simplifying mobile navigation

**Evidence:** `MobileNavBar.tsx` contains Folders, Inbox, Starred, Compose, Calendar, Tasks, and Settings; its Starred target has a 44-pixel minimum. `Sidebar.tsx` also provides a named Starred folder and count. The screenshot shows the resulting seven-way competition for a narrow bottom bar.

**Change:** Use four mobile destinations/actions: Folders, Inbox, Starred, Compose, each with a minimum 48-pixel target and a readable label. Keep Calendar, Tasks, and Settings in the Folders drawer. Preserve Starred in both locations, mark the current folder with `aria-current="page"`, and close the drawer after navigation. Keep the existing Starred page heading and conversation count.

**Acceptance:** At 360-pixel width and enlarged text, all four bottom labels fit without collision or horizontal scrolling; Starred is one tap from Inbox. Calendar, Tasks, and Settings remain reachable through Folders. Selecting Starred shows starred conversations, updates the heading/count, and exposes the current destination to TalkBack. Removing the last star yields a clear empty state with a route back to Inbox rather than an unexplained blank list.
