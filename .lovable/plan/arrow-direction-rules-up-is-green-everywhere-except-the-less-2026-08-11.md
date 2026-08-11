# Arrow direction rules: up is green everywhere except the "less is better" metrics

Confirmed rule for every directional arrow on the site:

- Upward movement is green for all normal metrics (Records, Total Leads, Good Leads, Qualified Calls, Verified Sales, Revenue, etc.) — no matter how small the move.
- Downward movement on those metrics is amber under 40% and red only at 40% or more.
- The only exceptions are the "less is better" metrics — Spam, Bad Leads, No Entry, and cost-type metrics (Ad Spend, CPL, CPGL, CPM, CPC). There the logic flips: down is green, up is amber under 40% and red at 40% or more.

## Changes

1. **Centralize the exception list.** Today each surface decides "invert" on its own (`bad_leads | no_entry | spam` hardcoded in the call-tracking table, `invertDelta` flags scattered across the dashboard and command pages). Move this to a single `isLessIsBetterMetric(key)` helper next to the delta-tone helper so no surface can drift.
2. **Repoint every delta site to that helper**, so any metric not on the exception list always renders green on an up arrow.
3. **Audit and correct any mismatches** found while repointing — any column or KPI currently flagged inverted that isn't a spam/bad-lead/no-entry/cost metric gets un-inverted.
4. Tooltip copy on the "less is better" columns notes that a decrease is the favorable direction, so the green-down arrow isn't confusing.

## Technical details

- Add `LESS_IS_BETTER` metric-key set and `isLessIsBetterMetric()` to `src/lib/metrics.ts`, alongside the existing `deltaTone` / `DELTA_TONE_CLASS` helpers.
- Update `CellOut` in `src/pages/CallTracking.tsx` to derive `invert` from the helper instead of the inline key comparison.
- Verify the `invertDelta` usages in `src/pages/Dashboard.tsx` (Cost, CPM, CPC), `src/pages/Command.tsx`, and the `SubKpi` cost tiles in `src/components/command/JourneyFunnel.tsx` all correspond to genuine cost metrics; leave them inverted, drop the flag anywhere it doesn't.
- Presentation only — no metric math changes.
