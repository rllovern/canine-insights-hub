## Rebuild: Revenue Runway

Turn the current chart into an actual runway — actual to date, target pace across the full period, projected finish extending into the future — with plain-language KPIs and no dead whitespace.

### Assumption (target period)
There is no configured revenue goal in the database, and the selected date range already clips `to` at today for presets like "This month". So the runway derives its own **target period** from the active preset instead of reusing `range.to` verbatim:

| Selected preset | Runway target period |
|---|---|
| Today / Yesterday / thisWeek / lastWeek | The full 7-day week containing the range |
| last7 / last14 / last30 | Rolling window of that length ending on `range.to` |
| thisMonth | 1st → last day of the current calendar month |
| lastMonth | Full prior month (period entirely in the past) |
| allTime / custom | Uses `range.from` → `range.to` as-is |

`currentDate` = min(today, `periodEnd`). Everything to the left of it is actual; everything to the right is projected.

**Goal amount**: trailing-90-day daily revenue run-rate (already fetched by `useRevenueRunRate`) × days in the target period. Labeled explicitly as a 90-day pace goal so it doesn't look like a hand-set target.

### Sync with Sales Cadence (fixes #1, #9, #10)
- Actual series starts at the first day of the target period (Jul 1) and ends at `currentDate` (Jul 10). No Jun 30 phantom baseline — the y-axis just starts at 0.
- All KPI numbers on both cards use the same day-set as the Cadence heatmap for the shared window.
- Timezone: keep the current `won_at.slice(0,10)` day bucketing; no change.

### Chart series (fixes #4, #5, #11)
Three explicit series, plotted on one axis (Recharts `ComposedChart`):
1. **Actual cumulative revenue** — solid 2.4px `--primary` line, subtle 15% gradient fill only under the actual segment (not extended into the future). Highest emphasis.
2. **Target pace** — dashed 1.5px `--muted-foreground` line spanning the full period, linear from $0 to full-period goal.
3. **Projected finish** — dotted 2px `--primary` line at 60% opacity, starts exactly at the final actual point, ends at `actual + currentDailyPace × remainingDays`. Rendered only when `today < periodEnd`.

**Endpoint labels** (direct, not a legend) — small chips anchored to the right end of each visible series inside the chart body: `Actual $38,360`, `Target pace $37,608`, `Projected $115K`. If two labels would overlap within ~14px, stack them vertically.

**Reference marks**:
- Vertical dashed marker at `currentDate` with a small "Today" tag on top.
- Vertical tick at `periodEnd` labeled with the period-end date.

### KPI row (fixes #3, #6, #7, #8)
Replace the four current tiles with plain-language labels:

`Closed revenue $38,360` · `Target pace today $37,608` · `Ahead of pace +$752` (green ▲ / red ▼) · `Projected finish $115,080`

Secondary line under the row (small, muted): `102% of target pace · 90-day target: $115,000 · Day 10 of 31`.

### Runway status block (fixes #7, #12)
New compact block below the chart, replacing the current empty whitespace:

`$76,640 remaining · 21 days left · $3,650/day required · $3,836/day current pace`

Followed by one dynamically-composed status sentence, e.g.:
- Ahead + projected above goal: *"Revenue is $752 ahead of pace and is projected to finish 2.1% above the 90-day target."*
- Ahead + projected below goal: *"Revenue is currently ahead of pace, but the projected finish falls short of the 90-day target by 4%."*
- Behind + catchable: *"Revenue is $2,180 behind pace; hitting the target requires $4,050/day for the remaining 21 days."*
- Period fully in past: *"Closed 96% of the trailing-90d pace target for this period."*

Sentence generator lives inside `RevenueRunway.tsx`.

### Card height & layout (fixes #3, #4, #14)
Per the user's recommended composition, split the right column into two stacked cards so nothing is padded to match the calendar:

```
┌──────────────────────────┬──────────────────────────┐
│                          │ Revenue Runway           │
│ Sales Cadence            │ (chart + KPIs)           │
│                          ├──────────────────────────┤
│ Monthly calendar         │ Runway status            │
│                          │ (remaining / req / proj) │
└──────────────────────────┴──────────────────────────┘
```

- **Revenue Runway card** — height determined by content (~440–500px on desktop). Chart body reserved height **260px** (up from 180). KPI row above, endpoint-labeled chart middle, status block below.
- **Runway Status card** — a shorter sibling under it with the operational metrics and forecast sentence. Renders even when there's no revenue yet (shows "Waiting on first sale of the period").
- No forced equal-height with the left card. `ChartCard` doesn't enforce a height, so the change is entirely in `SaleRecords.tsx` layout (`grid-cols-2` with `lg:items-start` and stacking on the right).

### Tooltip (fixes #13)
- Past dates: `Revenue closed that day · Cumulative revenue · Target pace · Variance to pace`.
- Future dates: header prefixed with `Projected` and only projected + target-pace lines shown.
- Actual and projected never appear on the same tooltip line without their labels.

### Data model (calculated once, memoized)
```
fullPeriodTarget        = runRate90d * periodDays
elapsedDays             = min(today, periodEnd) - periodStart + 1
remainingDays           = max(0, periodEnd - today)
actualRevenueToDate     = sum(byDay from start to currentDate)
targetPaceToDate        = fullPeriodTarget * elapsedDays / periodDays
varianceToPace          = actualRevenueToDate - targetPaceToDate
currentDailyPace        = actualRevenueToDate / elapsedDays
projectedPeriodFinish   = actualRevenueToDate + currentDailyPace * remainingDays
remainingRevenue        = max(0, fullPeriodTarget - actualRevenueToDate)
requiredDailyPace       = remainingDays > 0 ? remainingRevenue / remainingDays : 0
```

### Files touched
- `src/components/sales/RevenueRunway.tsx` — full rewrite. Accepts `periodStart`, `periodEnd`, `byDayRevenue: Record<string,number>`, `fullPeriodTarget`, and renders KPI row + chart + endpoint labels + reference lines. Internally handles projection series and status sentence.
- `src/components/sales/RunwayStatus.tsx` — new small component for the stacked "Runway Status" card (metrics grid + sentence).
- `src/lib/verified-sales.ts` — new helper `deriveTargetPeriod(range, preset)` that returns `{ periodStart, periodEnd }` per the table above; export from module.
- `src/pages/SaleRecords.tsx` — compute per-day revenue for the *target period* window (fetch is already scoped by `useSaleRecords`; extend to the target period when it exceeds `range.to`, which only happens for `thisMonth`). Restructure grid so the right column stacks Runway + Runway Status; drop the fixed skeleton height on the runway card.
- `src/contexts/DateRangeContext` — no change (target period is derived, preset already available via `rangePreset`).

### Out of scope
- Configurable / user-editable revenue goals (still derived from trailing-90d run rate).
- Timezone controls, revenue-definition switcher, filter surface (already inherited from the page).
- Changes to Sales Cadence, table, or CSV export.
