# Storyboard 06 — Archive email

Evidence: `recordings/android/storyboard-6-archive-email.png` shows a scrolled Inbox with “Conversation archived” and a prominent Undo pill above bottom navigation. Static evidence confirms feedback placement, but cannot establish gesture reliability or scroll restoration.

## 1. Keep Archive immediately reachable

**Evidence:** `ActionBar.tsx` places Archive after Back, Menu, Reply, Reply All, and Forward in a horizontally scrolling strip. At narrow phone widths those preceding controls can push Archive outside the initial viewport. Inbox cards expose Pin and Star, but no visible Archive alternative to swiping.

**Change:** Put Archive directly after Back in the mobile action bar, with a minimum 48 × 48 CSS-pixel target and an accessible name of “Archive.” Keep secondary reply variants in overflow on phones. Retain a reachable explicit Archive action for users who cannot swipe.

**Acceptance:** At 360 and 412 CSS-pixel widths, Archive is fully visible without horizontal scrolling when a conversation opens; one tap archives once and returns to the originating Inbox context. TalkBack announces “Archive, button” without a desktop keyboard shortcut.

## 2. Distinguish intentional swipe from vertical scrolling

**Evidence:** `ThreadCard.tsx` tracks only the starting X coordinate and commits beyond 75 pixels. It does not compare vertical travel or handle touch cancellation; movement beyond 120 pixels stops updating the offset. A diagonal scroll can therefore become an archive, and the card also retains its normal click handler.

**Change:** Track both axes and lock horizontal intent only after 12 pixels with horizontal travel at least 1.5 times vertical travel. Preserve native vertical scrolling, clamp rather than freeze swipe distance, show the existing Archive label before commitment, and commit only on release beyond 75 pixels. Reset on cancellation and suppress the following click after an intentional swipe; do not begin row swipes from Pin, Star, or selection controls.

**Acceptance:** Vertical and mostly vertical diagonal drags never archive or open a conversation; a short horizontal drag returns the card unchanged; a deliberate left swipe beyond threshold archives exactly once. Cancellation resets the card. Long swipes remain visually attached to the finger. Swiping does not interfere with Android edge-back navigation.

## 3. Make Undo dependable and preserve reading position

**Evidence:** The screenshot already gives Undo a strong filled treatment above navigation; preserve it. `ActionFeedbackToast.tsx` supplies a 44-pixel minimum action height, but `archiveThread` in `emailActions.ts` restores an undone thread by prepending it to the list. That can move the message away from its original position in this scrolled Inbox.

**Change:** Retain the visible Undo treatment with a 48-pixel touch target and at least six seconds to respond; accommodate accessibility timeout preferences. Reserve safe-area-aware space above navigation so the snackbar does not cover the last actionable row. Capture the archived row’s ordering and visible list anchor; restore both on Undo or failed archive. Report failure visibly instead of leaving success feedback in place.

**Acceptance:** Archive from mid-list leaves the same surviving anchor row at the same screen position (within 4 CSS pixels), with no jump to the top. Undo restores the conversation at its previous sorted position, updates the count, and leaves the viewport stable. At 360-pixel width and enlarged text, Undo remains fully visible and tappable above navigation. Repeated archives target the correct conversation; a failed request restores the row and announces the failure.
