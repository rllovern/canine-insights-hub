## Goal

When the user has a comparison period active (Previous period or Custom), every trend chart on the performance report should overlay a faint "ghost" line for the same metric in the comparison range, so the current period can be read against it visually.

## Where ghost lines appear

All daily trend charts driven by `DashboardContext` on the Dashboard / Public performance report:

- Cost vs CPM (dual-axis)
- Clicks vs CTR (dual-axis)
- Impressions vs Calls (dual-axis)
- Cost / Good Lead (single line)
- Cost / Good Lead by Source (multi-line, one ghost per source)

If `compareMode === "off"` or there is no prior data, no ghost lines render and behavior is unchanged.

## How it will look

- Ghost lines use the same color as their "live" counterpart but at ~35% opacity, thinner (1.5px), and dashed (`strokeDasharray="4 4"`).
- No dots, no active dots, hidden from the legend (or labeled with a "(prev)" suffix only inside the tooltip).
- Tooltip shows both current and prior values for the hovered date, with prior values labeled e.g. `Cost (prev)`.
- X-axis stays the current period's dates. Prior-period points are aligned by day-offset (day 1 of prior maps to day 1 of current, etc.) so the two lines overlay on the same axis.

## Technical changes

1. `src/contexts/DashboardContext.tsx`
   - Already exposes `prior`. No API change needed.

2. New helper in `src/lib/metrics.ts`
   - `alignPriorToCurrent(priorSeries, currentRange, priorRange)` — returns prior rows keyed by the matching current-range ISO date, so the two series can be merged into one dataset row like `{ date, cost, cost_prev, cpm, cpm_prev, ... }`.

3. `src/pages/Dashboard.tsx`
   - Build a `prior`-side series the same way `series` is built (groupByDate + calc fields), then merge into the main `series` rows as `*_prev` fields, plus a `sourceSeriesPrev` for the by-source chart.
   - Pass `showCompare` + prior keys to each chart component.

4. `src/components/dashboard/DualAxisChart.tsx`
   - Accept optional `leftPrevKey`, `rightPrevKey`, `showCompare` props.
   - When set, render two extra `<Line>`s with `strokeOpacity={0.35}`, `strokeDasharray="4 4"`, `strokeWidth={1.5}`, `dot={false}`, `legendType="none"`.
   - Tooltip formatter labels them `${label} (prev)`.

5. `src/components/dashboard/MultiLineChart.tsx`
   - `SingleLineChart`: add optional `prevKey` + `showCompare`, render ghost line.
   - `MultiLineChart`: accept optional `prevData` (or merged `*_prev` keys) + `showCompare`; for each source render a ghost line in the same color, dashed/faded, hidden from legend.

6. No backend, query, or date-range logic changes. No new fetches — uses the prior data already in `DashboardContext`.

## Out of scope

- KPI cards (already show delta %).
- Source / campaign breakdown bar tables.
- Changing the comparison date math or the default range behavior.
