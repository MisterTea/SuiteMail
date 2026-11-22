# Android storyboard UX work

Each of the 20 email storyboards and four filter workflows was assigned to its own UX-design subagent. The numbered documents record that designer's screenshot/source evidence, proposed changes, and acceptance criteria. They distinguish what a final screenshot proves from behavior inferred from source. Three designers then implemented shared composer, filter, and supporting-flow changes; the primary agent integrated navigation, reading, selection, dialogs, and device validation.

The implementation is gated by `useAndroidMobile`: native Android at widths below 768 CSS pixels. Desktop layouts remain available. Native touch controls use at least 48 CSS pixels (WebView dp scale), following [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps). The four-destination navigation follows [Android compact navigation guidance](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns).

## Delivered behavior by storyboard

| Designer | Flow | Shared changes integrated |
|---|---|---|
| [01](storyboard-01.md) | Read & browse | Five fixed labeled message controls, More action sheet, reflowed sender/date metadata, 16px message body, simplified navigation. |
| [02](storyboard-02.md) | Compose/send | Full-screen keyboard-safe composer, single content scroll area, stable Send, recipient blur/validation fixes, optional formatting and More tools, visible save state. |
| [03](storyboard-03.md) | Reply | Explicit labeled Reply, Android inline replies open the full composer, retained original context, keyboard dismissal after send. |
| [04](storyboard-04.md) | Reply all | Stable explicit Reply all choice, clearer recipient editing, sender-only choice remains available, full-screen editor. |
| [05](storyboard-05.md) | Forward | Explicit labeled Forward, recipient validation, expandable original context, reachable Send. |
| [06](storyboard-06.md) | Archive | Always-visible Archive, vertical-scroll discrimination before swipe, longer swipe threshold, readable Undo feedback. |
| [07](storyboard-07.md) | Trash | Labeled Trash, confirmation for permanent deletion, destructive swipes disabled in Trash and Drafts. |
| [08](storyboard-08.md) | Star | Independent 48px Star control with pressed state; direct Starred destination retained. |
| [09](storyboard-09.md) | Pin | Labeled Pin to top in More, separate from Star; redundant row-level Pin toggle removed on Android. Existing Pinned section preserved. |
| [10](storyboard-10.md) | Search | Short mobile placeholder, semantic Search field, keyboard dismisses on submit, stale results ignored, visible search errors. |
| [11](storyboard-11.md) | Move | Labeled Move in More, full-width touch sheet, no automatic keyboard on opening, larger destination rows. |
| [12](storyboard-12.md) | Mark unread | Explicit read/unread action, state feedback, pending automatic read respects explicit unread intent. |
| [13](storyboard-13.md) | Snooze | Full-width readable preset rows with exact date/time/timezone; custom time must be in the future. |
| [14](storyboard-14.md) | Send later | Labeled Send later entry, date/time/timezone presets, future validation, explicit open-and-connected requirement. |
| [15](storyboard-15.md) | Drafts | Save & close flushes pending edits; Android Back takes the save path; discard confirmation; Undo send and failed-send recovery retain the message. |
| [16](storyboard-16.md) | Attachments | Phone defaults to readable list rows; wrapped filenames, types/sizes and labeled file actions; visible loading/download errors. |
| [17](storyboard-17.md) | Calendar RSVP | Labeled touch responses, readable dated event time, pending feedback and correct needs-action state. |
| [18](storyboard-18.md) | Unsubscribe | Explicit Unsubscribe & archive action, pending/error feedback; browser fallback asks user to finish there and does not archive or claim completion; no silent sender filter on Android. |
| [19](storyboard-19.md) | Spam/safety | Readable warning, one Report spam action, separate confirmation before trusting sender. |
| [20](storyboard-20.md) | Bulk actions | Long press selects without opening; selection count, Select all and Cancel; labeled Archive/Trash/More panel; aggregate archive results. |
| [21](workflow-21.md) | Filter entry | Full-width Settings with labeled horizontal categories, clear Manual/AI entry choices. |
| [22](workflow-22.md) | AI filter + existing mail | Legible single-column review, complete match retrieval with a 50-row display sample, explicit opt-in for existing mail, preview-ready guard. |
| [23](workflow-23.md) | Future-only filter | Whole-row scope checkbox defaults off; future-only scope is explicit; separate Create filter/Create & apply labels. |
| [24](workflow-24.md) | Manual filter | Semantic field labels, touch-sized inputs, reachable staged footer, keyboard viewport and duplicate-save guards. |

Shared dialogs have named dialog semantics, Android focus containment/restoration, sticky headers, and native Back dismissal of the top surface. Bottom navigation is hidden while the keyboard is open. Selection and search can be dismissed before navigating away. Prior APK and recording bundle are preserved with `before-ux` filenames in `dist-android/`.

## Validation and remaining work

The updated APK is tested in the Android emulator using the existing 24 user workflows plus the native backend check. The recorder captures the installed application's display. It uses controlled mail/SQL/AI services for the workflows and the real JNI backend for its native check; these are not live-account usability studies.

The designer documents are a backlog as well as a specification. Not every suggestion is implemented. Deferred work includes faithful Undo restoration from non-Inbox folders, advanced recipient combobox semantics and parsing, a complete composer focus trap, fetching forwarded attachment payloads, persistent per-file progress/cancellation, consolidated attachment filters, progressive disclosure of all manual-filter conditions, persistent sync retry and partial-save recovery, and formal TalkBack/device-hardware usability testing. Reliable background delivery, native document sharing, Google sign-in and the other preview limitations in [Android build notes](../android.md) remain outside this UX change.
