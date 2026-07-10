## Revenue Runway — implementation safeguards added

All prior decisions stand (CTM-only source, prior-30-day fixed target, 30% benchmark, prior-90/180 avg deal value, separate target/forecast statuses, coverage-aware zero-vs-missing, explicit target-period triple, inclusive-day indexing, tests). This revision only bolts on the four safeguards.

### Safeguard 1 — % to target never divides by zero

`RevenueRunway.tsx` computes:

```ts
const percentToTarget =
  target == null || target === 0
    ? null
    : actual / target;
```

Tile rendering:

```
target == null  → value "—",  caption "Target unavailable"
target === 0    → value "N/A", caption "No prior-period Good Leads"
otherwise       → value `${Math.round(percentToTarget * 100)}%`
```

Never render `Infinity`, `0%` (as if it were a real ratio), or a huge percentage when `target === 0`.

### Safeguard 2 — coverage measured over property-date pairs

Both coverage hooks are updated. Note: `daily_metrics` has multiple rows per `(property_id, date)` (ad_source/campaign dimensions) and legitimately writes zero-activity days (verified in DB: rows exist for 2026-07-08/09/10 with `good_leads = 0, leads = 0, cost = 0`). So distinct `(property_id, date)` presence is a valid coverage proxy.

```ts
// Baseline window [targetPeriodStart - 30, targetPeriodStart - 1]
expectedPropertyDays = 30 * selectedPropertyIds.length
coveredPropertyDays  = SELECT count(DISTINCT (property_id, date))
                       FROM daily_metrics
                       WHERE property_id IN (...) AND date BETWEEN ... AND ...
total = SUM(good_leads)  -- across all rows in window & scope

status =
  covered === 0                       ? "missing_data"
  : covered <  expected               ? "partial_coverage"
  : total   === 0                     ? "confirmed_zero"
                                      : "ok"
```

Return shape:

```ts
{
  total, dailyAvg,
  coveredDays,             // DISTINCT date count (informational)
  expectedDays,            // 30 (baseline) or elapsedDays (current)
  coveredPropertyDays,     // DISTINCT (property_id, date)
  expectedPropertyDays,    // expectedDays * selectedPropertyIds.length
  status
}
```

Same shape for `useCtmGoodLeadsToDate` over `[targetPeriodStart, asOfDate]`.

Single-property selections behave identically to the prior spec (expected = covered days when full).

If future data shows daily_metrics gaps for legitimate zero days (i.e. presence isn't guaranteed), we'll switch coverage to a dedicated ingestion marker; today it is guaranteed, so no schema change now.

### Safeguard 3 — future periods produce elapsedDays = 0, never negative

`resolveTargetPeriod` returns:

```ts
if (today < targetPeriodStart) {
  asOfDate      = null;
  elapsedDays   = 0;
  remainingDays = targetPeriodDays;
} else {
  asOfDate      = min(today, targetPeriodEnd);
  elapsedDays   = differenceInCalendarDays(asOfDate, targetPeriodStart) + 1;
  remainingDays = Math.max(differenceInCalendarDays(targetPeriodEnd, asOfDate), 0);
}
```

Hook behavior when `asOfDate == null` (future period):
- `useCtmGoodLeadsToDate` **is not called** — no query issued with `end < start`.
- `useRevenueForecast` returns `{ projectedFinish: null, forecastMethod: "unavailable", forecastDataStatus: "no_elapsed_period", ... }`.
- Actual series is empty (`actual[i] = null` for all `i`).
- Target line still renders when baseline + avg deal value are valid.
- Projection series and as-of `ReferenceLine` are hidden.

### Safeguard 4 — projection meets actual, invariant enforced

In the series builder we compute `closedRevenueToDate` and `actual[]` from the exact same source (`useSaleRecords` rows, filtered by `won_at` between `targetPeriodStart` and `asOfDate`, `status = 'won'`, `monetary_value` summed). Then:

```ts
const lastActualValue = actual[elapsedDays - 1];
console.assert(lastActualValue === closedRevenueToDate);
projection[elapsedDays - 1] = closedRevenueToDate; // shared boundary point
```

The projection's day-`elapsedDays-1` value is set to `closedRevenueToDate` (which equals `lastActualValue`) so the projection line begins exactly where the actual line ends — no discontinuity.

### Additional tests

Added to `src/lib/__tests__/revenueRunway.test.ts`:

9. **Confirmed-zero target** → `target === 0`, `percentToTarget === null`, tile renders `"N/A"` with caption `"No prior-period Good Leads"`.
10. **Multi-property partial coverage** → Property A full 30 days, Property B 10 days, 2 selected → `coveredPropertyDays = 40`, `expectedPropertyDays = 60`, `status = "partial_coverage"`, target unavailable.
11. **Future custom period** (target starts tomorrow) → `elapsedDays = 0`, `remainingDays = targetPeriodDays`, `actual` series all `null`, `forecastDataStatus = "no_elapsed_period"`, target still numeric when baseline valid, no CTM current-period query is issued (mock supabase; assert it wasn't called for the current-period window).
12. **Continuity invariant** → for a mid-period case, `series.actual[elapsedDays - 1] === closedRevenueToDate === series.projection[elapsedDays - 1]`.

### Files touched (unchanged from prior revision)

- `src/lib/verified-sales.ts`
- `src/lib/dateRange.ts` (adds `resolveTargetPeriod` with future-period branch)
- `src/lib/__tests__/revenueRunway.test.ts`
- `src/components/sales/RevenueRunway.tsx`
- `src/pages/SaleRecords.tsx`
- `src/components/sales/SalesHeatmap.tsx`
- `src/components/dashboard/ChartCard.tsx`

No schema, RLS, migration, or edge-function changes.
