## Scope

Performance report (client-facing Dashboard → Call Tracking view, `src/pages/CallTracking.tsx`) only. Command, Lead Performance, Reports, Jarvis, edge functions, and the canonical lead model are not touched.

## Changes — `src/pages/CallTracking.tsx`

**1. `SourceOutcomeTable` (the "Source Performance" card)**
- Filter `groupBySource(current)` and `groupBySource(prior)` to drop rows where `ad_source === "GHL Won"`.
- Remove the `{ key: "quality_rate", label: "Quality" }` column.
- Drop the `quality_rate` computation in `withTotals` and the special-case totals math; totals reduce stays summing the remaining count columns.

**2. `CampaignTable` (the "Campaign Breakdown" card)**
- Filter the campaign rows for both current and prior to drop `ad_source === "GHL Won"`.
- Remove `"quality_rate"` from the `cols` array and its `labels` entry.
- Drop `quality_rate` from `withTotals` so no quality cell is rendered.

**3. Imports**
- Remove `rowQualityRate`, `qualityTier`, `formatQualityRate`, and `TIER_TEXT` from the `@/lib/leadModel` import (still used elsewhere in the app, just not on this page).
- Remove the now-unused `CellOut` branch that renders the quality tier cell.

## Out of scope (explicitly untouched)

- `src/lib/leadModel.ts` — canonical model stays.
- `src/components/command/*` — Command quality rate, verdict, funnel unchanged.
- `src/components/lead-perf/*` — Data Quality rail unchanged.
- Edge functions, RPCs, views — unchanged. GHL Won still flows into every other surface.
- The "Lead Quality" chart section heading at the top of Call Tracking stays (it's a chart section, not a card column).
