# Workflow 23 — Save a filter for future mail only

## Evidence

- Recording: `recordings/android/workflow-accepting-a-filter-with-retroactive-checkbox-unchecked-saves-filter-and-syncs-without-altering-existing-inbox-emails.png`. The captured final screen shows an enabled “Tech Weekly Newsletters” filter in Mail Rules. The narrow content column wraps the filter title and creation controls. This final frame does not itself prove the unchecked state, synchronization, or unchanged inbox messages.
- `src/components/settings/AiFilterSuggestModal.tsx`: review uses a small native checkbox with a text label and detached helper copy. “Affected Emails” remains visible even when existing mail will be untouched. The footer says “Add Filter (Highest Priority)” and saving says “Applying...”, obscuring the future-only outcome.
- `handleAddFilter` always inserts the enabled rule and requests sidecar upload; existing thread actions run only when `applyToWholeInbox` is true. Preserve this distinction. Preview is capped at 50 entries; do not describe that sample as all existing matches. Upload is asynchronous, so successful local save does not establish completed sync.

## Three mobile-touch improvements

1. **Make the scope selector one large tap target.** Keep the native checkbox and its checked semantics inside a full-width label with `min-height: 48px`, 12px padding, and a 12px gap. Put both its title and description inside that label; use a visible focus outline. Title: “Also apply to existing matching emails”. Description: “Off: only new incoming emails will be filtered.” Do not make the preview itself toggle scope.
   - Acceptance: tapping the checkbox, title, helper text, or row padding toggles exactly once; keyboard Space works; TalkBack announces the name and checked state; the row is at least 48 CSS px tall at 360px viewport width.

2. **Repeat the selected scope beside the save action.** When unchecked, show “Future emails only” and “Existing emails will stay unchanged.” Use “Save filter” and loading text “Saving filter…”. When checked, show “New and existing matching emails” with “The listed existing emails will be updated when you save.” Keep priority as secondary explanatory text, rather than lengthening the action label. Make the save and discard targets at least 48px high and stack controls on narrow screens.
   - Acceptance: unchecked scope and its unchanged-existing-mail promise remain readable above the footer before saving at 360px width and with enlarged text; the save label never implies retroactive application; saving unchecked creates the enabled rule and requests sync without calling existing-thread actions.

3. **Describe the preview and announce the result accessibly.** For unchecked scope, rename the section “Existing matches — preview only” and add “These emails will not change.” State “Showing up to 50 matches” when capped. Associate the scope explanation with the checkbox using `aria-describedby`; announce scope changes in a polite status region. On save, return focus to the invoking control and announce “Filter saved. Future incoming emails will be filtered. Existing emails unchanged.” Announce sync completion separately only when verified, and surface upload failures as retryable status.
   - Acceptance: TalkBack reads the future-only consequence without requiring exploration of the message list; preview count never claims a total beyond the loaded sample; successful unchecked save produces one audible confirmation and predictable focus; no UI says “synced” merely because upload was requested.
