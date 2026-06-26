## Goal

Two changes to the top bar and `/command`:

1. Retire the "Internal View" toggle. The owner allowlist (`rl.lovern@gmail.com`) only sees **View as Bob**.
2. Make `/command` render two distinct layouts:
   - **Owner view** (you, toggle OFF): the original Command page with the cards we removed earlier brought back — Call Handling, Missed Call Follow‑Up, Call Quality, and Top Opportunities — and **no** Performance Report block.
   - **Bob / everyone-else view** (toggle ON, or any non‑owner): the new merged layout (hero + funnel + verdict + Performance Report). No old cards.

## Files to change

- `src/components/layout/TopBar.tsx` — delete the Internal View switch entirely. Keep only the owner's "View as Bob" pill and the non‑owner viewer badge.
- `src/contexts/PreviewModeContext.tsx` — remove the `isPreviewing` / `togglePreview` / `setPreviewing` API and the internal‑previews‑as‑viewer code path. `effectiveRole` becomes: owner+impersonateBob → `viewer`; otherwise `realRole`. Update the stub value in `src/pages/admin/AdminClientReports.tsx` to drop the removed fields.
- `src/pages/Command.tsx` — branch on `usePreviewMode()`:
  - If `isOwner && !impersonateBob`: render the original three Performance Cards (`CallHandlingCard`, `MissedCallFollowUpCard`, `CallQualityCard`) and `TopOpportunities` (re‑import them and `useSpeed`). Do **not** render the Performance Report block.
  - Otherwise: render the Performance Report block (`<Dashboard /> + <CallTracking />`) we added last turn. Do **not** render the old cards.
  - The hero (KPI row, funnel, Location Verdict) stays visible in both views.

## Out of scope

- Sidebar scoping (already correct: viewers see Command + Budget Pacing; internals see everything else gated by `ViewerBlock`).
- The Bob seed / `viewer_property_access` plumbing (already deployed).
- Any data‑model or backend changes.

## Technical notes

- `Command.tsx` will re‑add these imports it had before the merge: `CallHandlingCard, MissedCallFollowUpCard, CallQualityCard` from `@/components/command/PerformanceCards`, `TopOpportunities` from `@/components/command/TopOpportunities`, and `useSpeed` from `@/components/lead-perf/hooks`. The `speed` query should only run in the owner branch to avoid a wasted fetch for viewers.
- After removing `isPreviewing` from the context, search for any remaining consumers (`rg "isPreviewing|togglePreview|setPreviewing"`) and clean them up so the typecheck passes.
- `effectiveRole` semantics stay the same for the rest of the app: `viewer` when Bob is active, otherwise the user's real role. The `ViewerBlock` route guard keeps working unchanged.
