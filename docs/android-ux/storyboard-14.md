# Storyboard 14 — Schedule send

Evidence: `recordings/android/storyboard-14-schedule-send.png` captures the inbox after scheduling. The toast truncates “Delivery scheduled for Tomorrow at 9:…” while “View in Outbox,” Undo, and dismiss remain visible. It does not show the picker or establish successful delivery. `Composer.tsx` exposes scheduling through an unlabeled chevron beside Send. `ScheduleSendDialog.tsx` already has full-width presets and a native mobile date/time field, but date/time competes horizontally with truncated labels, timezone appears only in the header, and custom submission accepts past times. `ScheduledSendToast.tsx` truncates its confirmation and its Outbox action actually navigates to Drafts. The scheduled-send manager runs an application checker; this flow must not promise delivery with the Android app closed.

## 1. Make Send later a visible phone action

**Change:** Show the exact label **Send later** alongside its clock/chevron in the composer footer, with a minimum 48 × 48 CSS-pixel target. Keep Send separately labeled and independently tappable. On narrow phones, wrap footer actions instead of squeezing out labels. Open the existing sheet, move focus to its title, and restore focus to Send later on dismissal.

**Acceptance:** At 360 and 412 pixels, users can find Send later without a tooltip or long press; Send, Send later, and Discard remain visible without horizontal scrolling. TalkBack names the trigger “Send later,” announces that it opens a dialog, and returns to it after Close or Android Back. Opening and dismissing scheduling preserves the draft and sends nothing.

## 2. Make the scheduled instant readable before a tap

**Change:** Keep every preset a full-width, minimum 56-pixel row. Stack its human label above the complete localized date, time, and timezone, for example “Tomorrow morning” / “Sat, Nov 21 · 9:00 AM · America/Chicago.” Allow wrapping; remove competing marketing subtext and compact right-side date chips on phones. Label the sheet **Send later**. Explain immediately before its choices: **“Keep SuiteMail open and connected to send at the selected time. If the app is closed, sending waits until you reopen it.”** Apply this qualification to repeated sends too.

**Acceptance:** At 360 pixels and enlarged text, all three presets expose their complete date/time/timezone without ellipsis; the whole row activates its displayed timestamp once. Tomorrow reflects the next calendar day, including weekends, and Monday reflects the next Monday. The foreground limitation is readable before either a preset or custom submission, and no success copy claims that the email has already been delivered.

## 3. Finish custom scheduling and confirm it honestly

**Change:** Keep the native date/time picker with a persistent visible label and explicit timezone; give quick-time controls minimum 48-pixel touch targets. Keep the sheet scrollable above the keyboard/native picker, with Close and **Schedule send** reachable. Reject empty, invalid, and past instants inline with “Choose a future date and time”; revalidate on submission. After saving, show a wrapping confirmation containing the full date/time/timezone, the open-and-connected reminder, and a separate row of 48-pixel actions **View in Drafts**, **Undo**, and dismiss. Use Drafts because that is the existing destination. Keep success conditional on a successful save and preserve the draft on failure.

**Acceptance:** With the Android keyboard or picker open, users can change date and time, read the selected timezone, reach Schedule send by scrolling, and dismiss the keyboard without losing values. A past time never closes the sheet or creates a scheduled item. A future time creates one item and a complete readable confirmation above navigation at 360 pixels. View in Drafts opens Drafts; successful Undo removes the scheduled item and restores the draft. Failed saving or cancellation produces a visible error, not a false success. Closing the app before the due time does not imply background delivery; reopening allows the existing checker to attempt pending delivery.
