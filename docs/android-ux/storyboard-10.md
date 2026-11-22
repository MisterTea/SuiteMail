# Storyboard 10 — Search emails

Evidence: `recordings/android/storyboard-10-search-emails.png` shows a focused, empty search field and Android search keyboard. The placeholder is visibly clipped after desktop operator examples. Inbox and “20 conversations” remain visible, with bottom navigation consuming space above the keyboard. This still establishes the entry state only; it does not demonstrate submitted results or Back behavior.

## 1. Give typing a focused phone layout

**Change:** In `SearchBar.tsx`, use “Search emails” on phones, keep the existing 16px text and Search keyboard action, and add an explicit accessible “Search emails” label. Keep operator syntax available through optional help rather than the placeholder. Retain a minimum 48px field height. While the keyboard is open, collapse bottom navigation so the list gets the remaining viewport. Pressing the keyboard Search action submits immediately, dismisses the keyboard, and leaves the query visible.

**Acceptance:** At 360 and 412 CSS-pixel widths, the complete placeholder fits and focusing opens a search keyboard without capitalization or autocorrection. Search submits the latest typed query once, with no debounce-delayed older query replacing it. The field stays visible as the viewport resizes; result rows scroll above the keyboard. Enlarged text causes neither horizontal scrolling nor overlapping controls.

## 2. Make result status single and truthful

**Evidence:** `EmailList.tsx` currently repeats the count in the header and query chip. Both switch to results for any nonempty query, although `SearchBar.tsx` only executes searches from two trimmed characters. The pulse indicator is unconditional, and old matches remain during the debounce.

**Change:** Use one phone summary below the field: “Enter at least 2 characters,” then “Searching…,” then “N matching conversations” once the latest request finishes. Keep the folder/account scope visible and show an active read filter by name. Use a polite live status; remove the duplicate phone chip/count. Report search failure with Retry rather than silently showing the inbox as results. A zero count leads to the existing no-results guidance and Clear action.

**Acceptance:** One character never labels the entire inbox as matches. Rapidly changing queries displays only the latest settled result count; loading never claims a settled count. Zero, one, and multiple matches use accurate conversation wording. With Unread selected, the summary identifies that filter and counts displayed matches. TalkBack announces each completed status without moving input focus. If only loaded conversations or capped hits are searched, the summary states that limitation rather than implying an exhaustive mailbox count.

## 3. Separate clearing from leaving search

**Evidence:** The field Clear button already refocuses input, but its 44px target shrinks at `sm`; the separate summary Clear is only 36px tall. Search exit currently has an Escape path and no visible phone Back affordance. The field also places Save as Smart Folder beside Clear, competing for typing width.

**Change:** While search is active on phones, replace the menu trigger with a 48 × 48px Back button labeled “Exit search.” Keep a single 48 × 48px trailing Clear button inside the field; Clear empties text, restores the unfiltered list, and keeps keyboard focus for another query. Back exits search, dismisses the keyboard, restores the prior folder list, and returns focus to the search entry. Move Save as Smart Folder to a labeled secondary action after results settle.

**Acceptance:** At 360px width and phone landscape, Back and Clear remain separate reachable targets with TalkBack names. Clear supports typing a replacement immediately; Back returns to the prior folder without navigating to an unrelated screen. Android system Back first dismisses the open keyboard while retaining the query; a subsequent Back exits search. No Escape key, hover tooltip, or long press is required. A slow request finishing after Clear/Back cannot restore a cleared search.
