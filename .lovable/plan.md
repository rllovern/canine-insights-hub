## Goal

Extend ghost comparison lines to every trend chart on the Call Tracking page (matches what's already on Dashboard).

## Charts to update in `src/pages/CallTracking.tsx`

Single-line (add `prevKey` + `showCompare`):
- Total Calls (`record_count`)
- Total Good Leads (`good_leads`)
- Total Admissions (`admissions`)
- Total Spam (`spam`) — internal view

Multi-line by source (add merged `*_prev` per source + `showCompare`):
- Calls by Source
- Good Leads by Source
- Admissions by Source
- Spam by Source

## Implementation

1. Pull `compareMode` + `compareRange` from `useDashboard()`. Compute `showCompare = compareMode !== "off"`.

2. Build prior versions of the same datasets used today and merge into the current data by day-offset:
   - `series`: also build from `prior` via the same `groupByDate + calc` pipeline, fill across `compareRange`, then map index → current row, attaching `record_count_prev`, `good_leads_prev`, `admissions_prev`, `spam_prev`.
   - Each by-source dataset (`callsBySource`, `goodBySource`, `admBySource`, `spamBySource`): also run on `prior`, union sources from both periods, fill across each range, and merge so each row has `${source}` and `${source}_prev`. The component already iterates over `sources`; the existing `MultiLineChart.showCompare` prop renders the ghost lines using the `_prev` suffix.

3. Pass `prevKey` to each `SingleLineChart` and `showCompare` to every chart on the page.

No backend, query, or date-range changes. No styling changes beyond the existing ghost-line treatment (dashed, 35% opacity, same color, hidden from legend).

## Out of scope

- Source Performance and Campaign Breakdown tables (they already show prior-period deltas).
- Cost / Good Lead by Source on Call Tracking (was removed previously).
