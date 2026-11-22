# Storyboard 13 — Snooze email

Evidence: `recordings/android/storyboard-13-snooze-email.png` shows Snoozed with one Book Club conversation and a bottom confirmation, “Snoozed until Tomorrow, 9:00 AM,” beside Undo. The row's Snoozed badge confirms category but does not show the return date; its adjacent Nov 14, 2023 date is ambiguous. The still does not establish preset readability or keyboard behavior. `SnoozeDialog.tsx` currently has full-width 52-pixel preset buttons, truncated 12-pixel details, native date/time inputs, and a custom Snooze button enabled whenever a date exists. `ActionBar.tsx` immediately closes the sheet, removes the row, returns mobile users to the current label, and shows a five-second Undo toast.

## 1. Make every preset's actual return time readable

**Change:** Keep full-width preset rows with a minimum 56-pixel mobile height; show a 16-pixel label and a wrapping 14-pixel localized weekday, calendar date, and time beneath it. Remove detail truncation and allow rows to grow with text size. Generate displayed text from the exact submitted timestamp, including the actual date when “Later today” crosses midnight; refresh presets whenever the sheet opens. Keep shortcut hints hidden on touch layouts and name the action “Snooze” in the mobile action sheet.

**Acceptance:** At 360 and 412 CSS pixels with enlarged text, every preset displays its entire date/time without horizontal scrolling. Tapping anywhere in a row submits the same timestamp it displays exactly once. At 11 PM, “Later today” does not incorrectly say Today for a return after midnight. Reopening across midnight refreshes dates; TalkBack reads each label and its return time together.

## 2. Keep custom selection usable above the keyboard

**Change:** Associate visible Date and Time labels with their inputs; use minimum 48-pixel field and quick-time targets. Stack fields on narrow screens, keep the custom section scrollable within the visible viewport, and scroll the focused input and Snooze button into view when the keyboard opens. Display the resolved local return date/time and timezone before submission. Disable Snooze until the combined value is valid and strictly in the future, and show an inline error for past or invalid values. Keep dismissal dragging on the handle/header only.

**Acceptance:** On Android at 360 pixels with the keyboard open, users can edit both fields, choose a quick time, read validation, and reach Snooze without closing the sheet or losing entered values. Labels are announced correctly. Today plus an earlier time, blank time, and invalid values never submit; a valid future selection submits once. Scrolling the form never dismisses it; Back dismisses the keyboard before abandoning the selection.

## 3. Confirm the outcome and provide a direct route to Snoozed

**Change:** After a successful save, announce “Snoozed until [weekday, date, time]” in a wrapping status above bottom navigation, with separate minimum 48-pixel Undo and “View Snoozed” actions. Preserve enough display time for accessibility preferences. View Snoozed opens that folder and exposes the affected conversation with its explicit return date/time. Keep the folder available through Folders after the confirmation expires. During saving prevent duplicate activation; on failure restore the conversation and show an actionable error instead of a success result.

**Acceptance:** At 360 pixels and enlarged text, confirmation and both actions remain fully readable and clear of navigation. View Snoozed opens the correct account's Snoozed folder and the conversation shows the chosen return time. Undo restores its previous state and placement; a failed save or failed Undo announces the actual failure. Closing the status does not change the snooze. Users can subsequently reach the conversation through Folders → Snoozed.
