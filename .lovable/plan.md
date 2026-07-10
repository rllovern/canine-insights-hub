## Goal

Replace the straight-line daily-pace forecast in Revenue Runway with a pipeline-backed forecast driven by currently available good leads, an assumed close rate (default 30%, org-configurable), and a trailing 90-day average deal value.

## Data reality (what's actually available)

- `daily_metrics.good_leads` is an aggregated daily count (from call scoring), not per-opportunity records. There is no per-lead `expectedDealValue` in this system today.
- `ghl_opportunities` gives us won deals with `monetary_value` and `won_at` — that's what powers `useRevenueRunRate` today.
- There is no existing "open opportunity" concept keyed to the good-lead count.

Consequences:
- **Tier 1 (per-lead opportunity value)**: not available yet. Ship the fallback path.
- **Tier 3 (org-wide average deal value)**: use trailing 90-day won revenue ÷ won deal count.
- **Service-specific averages (Tier 2)**: out of scope for v1.
- **Eligible good leads**: sum of `good_leads` over the eligibility window, minus wins already counted as closed revenue in the same period (dedup so a good lead that already closed isn't double-counted).

The plan documents this limitation clearly in the UI ("based on aggregated good-lead counts; per-opportunity values coming later").

## New forecast formula (v1)

```
availableGoodLeads   = sum(daily_metrics.good_leads over eligibility window, scoped by filters)
                       − wonDealsInPeriod   (dedup against closedRevenue)
avgDealValue         = trailing90dWonRevenue / trailing90dWonCount
closeRate            = org setting (default 0.30)

projectedAdditionalWins    = availableGoodLeads × closeRate
expectedAdditionalRevenue  = projectedAdditionalWins × avgDealValue
projectedFinish            = closedRevenueToDate + expectedAdditionalRevenue
```

Eligibility window (v1):
- Good leads counted in `daily_metrics` between `periodStart` and `min(today, periodEnd)`.
- No lead-age cutoff in v1 (the daily aggregate has no per-lead activity signal). Documented as a v2 refinement.

Deduplication:
- Subtract won deals in the same period from `availableGoodLeads` so closed-won good leads don't inflate the open forecast.

## Configurable close rate

New `property_settings` (existing table) key: `good_lead_close_rate` (numeric 0–1, default 0.30). One row per property; scope aggregate uses the min/avg across selected properties (v1: simple average, weighted by good-lead volume).

- Migration: no new table. Read via a small helper `useGoodLeadCloseRate(propertyIds)` that pulls `property_settings` rows and defaults missing ones to `0.30`.
- Admin UI to edit the rate is out of scope for this task (call out as follow-up).

## Files to change

**`src/lib/verified-sales.ts`**
- Add `useAvgDealValue(propertyIds)` — trailing 90d won revenue / won count from `ghl_opportunities`.
- Add `useAvailableGoodLeads(propertyIds, from, to)` — sums `daily_metrics.good_leads` filtered by scope, then subtracts wins in the same range.
- Add `useGoodLeadCloseRate(propertyIds)` — reads `property_settings`, defaults 0.30.

**`src/components/sales/RevenueRunway.tsx` (rewrite the forecast section)**
- New props: `availableGoodLeads`, `avgDealValue`, `closeRate`.
- Compute `expectedAdditionalRevenue`, `projectedFinish`, `projectedAdditionalWins` from those inputs (not from `currentDailyPace`).
- `currentDailyPace` stays only as an informational metric — never used to draw the projected line or the projected-finish KPI.
- Chart:
  - `actual` series unchanged.
  - `target pace` unchanged.
  - `projected` series: starts at the last actual point, ends exactly at `projectedFinish` on `periodEnd`, evenly distributed across remaining days (v1). Endpoint label reads `Projected {projectedFinish}`.
- KPI row:
  - Closed revenue
  - Target pace today
  - Ahead/Behind pace
  - Projected finish — with an info icon whose tooltip explains the formula
- New compact "forecast inputs" row below the chart:
  `{N} available good leads · {rate}% assumed close rate · {wins} projected wins · {avgDeal} average deal value`
- Extend `RunwayMetrics` to include: `availableGoodLeads`, `projectedAdditionalWins`, `expectedAdditionalRevenue`, `avgDealValue`, `closeRate`.

**`src/components/sales/RunwayStatus.tsx`**
- Rewrite the status sentence to use the pipeline-backed projection:
  > "Revenue is $461 behind pace. Based on 40 available good leads, a 30% assumed close rate, and a $3,800 average deal value, revenue is projected to finish at $83,960 — $36,385 below the $120,345 target."
- Remove any language claiming the current daily pace will produce the forecast.

**`src/pages/SaleRecords.tsx`**
- Wire the new hooks (`useAvailableGoodLeads`, `useAvgDealValue`, `useGoodLeadCloseRate`) and pass results into `<RevenueRunway />`.

## Tooltip / methodology copy

Info icon next to "Projected Finish":
> Projected finish = revenue already closed + (available good leads × close rate × average deal value). Available good leads exclude deals already won in this period. Average deal value is the trailing 90-day won-revenue average. The close rate defaults to 30% and can be adjusted per organization.

Projected endpoint tooltip:
```
Projected finish: $83,960
Closed revenue:   $38,360
Available good leads: 40
Assumed close rate:   30%
Projected additional wins: 12
Average deal value:   $3,800
Expected additional revenue: $45,600
```

## Out of scope (call out as follow-ups)

- Per-opportunity expected value (Tier 1) and service-specific averages (Tier 2) — require schema for open pipeline value.
- Lead-age exclusion / probability decay — needs per-lead activity, not the daily aggregate.
- Admin UI to edit `good_lead_close_rate`.
- Trailing actual close-rate comparison ("Forecast 30% · Actual 27%").
- Filters beyond property scope (owner/team/salesperson) — the app's current scope is property-based; extending to owner/team requires new context.

## Acceptance

- Projected Finish equals `closedRevenue + availableGoodLeads × closeRate × avgDealValue`.
- Chart's projected endpoint matches that number exactly.
- Won deals in the period are subtracted from `availableGoodLeads` so nothing is double-counted.
- Close rate reads from `property_settings.good_lead_close_rate` and defaults to 30%.
- Forecast inputs row and methodology tooltip render the exact numbers used.
- No UI copy claims daily-pace extrapolation is the forecast.