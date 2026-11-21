# Storyboard 02 — Compose and send new email

Design review only; no shared code changed.

## Evidence

The PNG shows the inbox/Compose entry point. Inspected MP4 frames at 2s (loading), 5s (empty composer), and 8s (recipient, subject, message, Android keyboard); duration is 9.346s. At 8s **Send is above the keyboard**: preserve this working behavior. The always-visible formatting strip, tall recipient area, Attach/Start Contract row, and footer leave roughly 180 capture pixels for message text. Screenshot pixels are not CSS pixels. The recording does not establish delivery success.

## 1. P0 — Keep Send reachable and restore editing space

Sources: `src/components/composer/Composer.tsx:569–580,695–858,869,953–1037`.

- Make mobile layout a nonshrinking safe-area header, one `min-height:0; overflow-y:auto` content region containing addresses/subject/editor/file list, and a nonshrinking 56–64px action bar. Currently only the editor scrolls; other sections can consume the viewport with many recipients or large text.
- Keep the bar to Attach, Format, More, and labeled Send; use 48px minimum targets. Move Schedule send, Discard, signatures, templates, and Start contract to labeled More actions. Put save status beneath the title. Desktop retains its richer layout.
- Fit to the actual keyboard-resized viewport. Verify host resize behavior before adding a scoped `visualViewport` fallback; never double-subtract keyboard height. Keep caret visible during resize and preserve selection/scroll. Remove fixed editor `pb-32` once real footer space is reserved.
- Collapse committed recipients while editing the body into an explicit summary with Edit, including Cc and Bcc counts. Do not collapse during entry/errors. Use `Write your message…` without the desktop snippet shortcut hint. Remove the decorative drag handle unless it has a working gesture.

Acceptance: At 320/360/393/412 CSS px, portrait and short landscape, keyboard open/closed, ten recipients, several attachments, and 200% font size, Send remains fully visible without horizontal page scroll. Content scrolls independently. At normal portrait text size the body provides at least three typing lines; caret remains above the bar and keyboard dismissal preserves position.

## 2. P0 — Commit recipients without stealing focus or accepting invalid addresses

Sources: `AddressInput.tsx:64–82,110–150` and its input `onBlur`; `Composer.tsx:704–725,1015` and `handleSend`.

- Separate commitment from focus: blur currently calls `addAddress`, which refocuses To. Commit on blur without refocusing; focus only during intentional recipient entry. Replace repeated autofocus timers with one entry focus.
- Validate recipient tokens, parse pasted comma/semicolon/newline lists, and deduplicate case-insensitively. Keep invalid/incomplete text editable with an inline announced error. Before Send/schedule, flush and validate pending input; `to.length > 0` alone is insufficient. Focus invalid entry and retain the draft.
- Provide full address inspection and 48px removal/disclosure targets; current remove target is 28px and Cc/Bcc 36px. Backspace selects a chip before deleting it. Summary counts include Bcc (currently omitted).
- Add combobox/listbox state, active descendant, named options showing name/address, result announcements, and stale-result protection. Constrain suggestions to visible space. Allow hardware Tab to advance when no token is pending.

Acceptance: Tap Subject/body once after typing an address: it commits and destination retains focus. Invalid or pending text cannot silently disappear or send. Mixed pasted addresses show individual errors. TalkBack reads complete identities, suggestions, removal actions, and disclosure state.

## 3. P1 — Disclose tools and show reliable outcomes

Sources: `EditorToolbar.tsx:60–100`; `AttachmentPicker.tsx:20–38,53–108`; `Composer.tsx` send flow, modal wrapper, subject input, and editor attributes.

- Hide the long mobile formatting strip until Format opens a wrapping panel with Bold, Italic, lists, Link, and More formatting. Preserve selection; provide 48px targets, toolbar naming, and `aria-pressed` toggle states.
- Keep Attach discoverable. Put file cards in scrollable content with filename/size/progress/error and 48px removal. Show size-limit errors visibly; fix the captured `totalSize` calculation so a multi-file batch respects the cumulative 24MB limit. Block sending while files are being read.
- Name the modal dialog, contain focus/background interaction, label Subject and multiline Message body, and return focus to Compose on close. Android Back dismisses keyboard first, then saves/closes. Close should announce its actual save behavior.
- Keep Undo reachable through the existing send delay. Announce queued/sending/sent accurately, prevent duplicates, and show visible Retry on transport failure while restoring the exact draft and attachments. The existing send catch only logs errors after closing.

Acceptance: Plain composition needs no toolbar scrolling; formatting preserves selection. Oversized file batches show actionable feedback. Success/Undo/offline/Retry produce no duplicates, silent loss, or premature success. TalkBack stays in the composer, follows the logical field/action order, and announces validation/save/send states.

Coordinate shared composer work with storyboards 14 (schedule), 15 (draft), and 16 (attachments).

## Implementation handoff

Implemented: Android-only full-height keyboard viewport, one scrollable content region and stable Send footer; named Save & close with awaited serialized autosave flush and visible failure status; Android Escape uses the same path and skips nested dialogs; explicit discard confirmation and waiting for in-flight create before deleting its resulting draft ID; no deletion of the original reply thread. Formatting starts hidden on Android with larger wrapping controls. Recipient blur no longer refocuses, invalid entries remain editable, empty Tab advances, Cc/Bcc remain visible when populated, and removal targets are larger. Send blurs IME focus, checks ActionResult success, retains an Undo recovery callback, and offers failed-message draft recovery. Autosave now includes Cc/Bcc, selected From, quote/signature, and threading fields; later edits invalidate Saved status immediately. Android inline activation uses the full composer for consistent save/keyboard behavior.

Validation: TypeScript passes. Targeted suites are `AddressInput.test.tsx`, `UndoSendToast.test.tsx`, `draftAutoSave.test.ts`, and `composerStore.test.ts`. Emulator keyboard/landscape/touch verification remains with the primary coordinator.

Deferred: advanced recipient paste parsing/combobox semantics and full-address inspection; compact audience auto-collapse; attachment picker progress/cumulative-size fix (outside owned files); complete modal focus containment and originating-control focus restoration; original forward attachment retrieval (existing forwarded placeholder content still needs integration); provider-specific draft resume identity resolution; replacing the single global pending-send slot with a multiple-message queue. Schedule persistence remains with its owner. The toolbar is progressively disclosed but still exposes the existing complete tool set once expanded. Send later remains separately labeled on Android.
