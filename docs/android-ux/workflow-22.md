# Workflow 22: AI filter, preview, retroactive acceptance

## Evidence

- Recording PNG: `recordings/android/workflow-asks-ai-to-create-a-filter-previews-affected-emails-accepts-with-retroactive-filtering-and-syncs-changes-to-fake-server.png`. Its captured end state shows a desktop settings sidebar occupying nearly half the phone width; the created filter name wraps across three lines. It does not show the open assistant, so modal findings below come from source inspection.
- `src/components/settings/AiFilterSuggestModal.tsx`: an 88vh centered modal, compact header tabs, 10–12px supporting text, nested 176px preview scroller, and horizontally competing footer copy/buttons. Both initial and reset state enable whole-inbox application. Preview fetch is limited to 50 and acceptance applies only those preview thread IDs, although consent copy promises all matching inbox emails.

## Three scoped changes

1. **Make the mobile modal a readable two-stage wizard.** Below 640px use the available viewport height (`100dvh`), safe-area padding, a single scrolling body, and an always-visible footer. Show “1 of 2 · Describe filter” then “2 of 2 · Review filter.” Stack mode controls below the title; use 16px input/body text, at least 14px supporting text, and 48px touch targets. Use a full-width primary “Generate filter” / “Create filter”; move priority explanation into review content. Hide the desktop keyboard shortcut on touch layouts. Preserve desktop styling at larger widths.
   - Acceptance: at 360px and 390px wide, including an open keyboard, no horizontal scrolling or clipped labels; primary action remains reachable; progress/error text wraps; Back from review preserves the original prompt for revision.

2. **Make affected messages a clear review section.** Place a plain-language condition/action summary above “Matching existing emails.” Remove the nested mobile preview scroller and render message cards within the main scroll area; show sender, up to two subject lines, date, and readable action changes. Stack count and priority explanation. Keep “Checking existing emails…” until preview completes; distinguish a failed preview from a successful zero-match result.
   - Acceptance: long senders/subjects and action labels wrap without obscuring dates; preview errors cannot appear as “No existing emails match”; acceptance is disabled while matching is pending or failed; empty results explicitly explain future-message filtering still applies.

3. **Require explicit, accurate retroactive scope.** Default the existing-message option off on every fresh session. Use a full-row 48px checkbox target labeled “Also apply to matching existing emails,” followed by the affected count and named account. Checked primary copy becomes “Create & apply”; unchecked stays “Create filter.” Never promise “whole inbox” from a 50-result sample: label capped results “Showing up to 50 matches,” and either fetch the complete matching thread set before retroactive application or explicitly constrain consent/application to the displayed set. Do not silently expand application scope.
   - Acceptance: unchecked creation saves/syncs the rule without altering existing emails; checked creation changes only the scope explicitly shown; a fixture with more than 50 matches never claims a complete count from the preview; changing modes/resetting cannot inherit prior consent; repeated taps during saving cannot create duplicate filters.

## Validation

Replay the AI generation → matching preview → explicit opt-in → acceptance flow at 360×800 and 390×844. Include zero matches, >50 matches, long content, preview failure, and keyboard-open states. Verify both consent paths against existing filter tests and server-sync assertions; UI completion must not claim confirmed server sync merely because the fire-and-forget upload was started.
