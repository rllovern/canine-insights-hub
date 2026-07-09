## Problem

`fetchVerifiedSalesByDate` currently counts every `ghl_opportunities` row where `status='won'`. In GHL, multiple downstream stages (e.g. "In Training", "Finished Training") are configured as won stages, so an opportunity that was sold months ago and progressed through training this month inflates the current-month count.

NoVA July 2026: app shows 57, GHL shows 29. Breakdown by stage:

```text
Trainers / Sold                27   ← real sales
Trainers / In Training         15   ← already sold earlier
Trainers / Finished Training    8   ← already sold earlier
Sales    / Sold to Winchester   5   ← exclude per user
Sales    / Sold                 1   ← real sale
Sales    / Jotform Submitted    1   ← misconfigured stage
```

Expected after fix: 28 (matches GHL's ~29).

## Fix

Change `fetchVerifiedSalesByDate` in `src/lib/verified-sales.ts` to additionally filter by stage name. A sale is any won opportunity whose **stage name = 'Sold'** (case-insensitive, exact match — excludes "Sold to Winchester" and any non-'Sold' won stages like "In Training").

### Implementation

1. Fetch the set of `ghl_stage_id`s where `name ILIKE 'sold'` (exact) from `ghl_pipeline_stages`, scoped to the requested `propertyIds` (or all if null).
2. Query `ghl_opportunities` with `status='won'`, `won_at` in range, `property_id` in scope, **and** `stage_id IN (soldStageIds)`.
3. Bucket by `won_at::date` as today.

Both `fetchVerifiedSalesByDate` callers (`useVerifiedSalesTotal`, `useVerifiedSalesByDate`, and `useCommandData` via Command page) inherit the fix automatically. Call Tracking is unaffected (still reads `daily_metrics.verified_sale`).

### Edge cases

- If a property has no stage named exactly "Sold", it returns 0 sales — surface this later if it becomes an issue (NoVA and current known properties have "Sold" stages).
- No schema change required.

## Verification

- Re-run the NoVA July window: expect 28 (27 + 1).
- Spot check one other property/month against GHL.
- Confirm Call Tracking totals unchanged.

## Follow-ups (not in this change)

- Admin UI to map "which stage(s) count as a sale" per pipeline, for properties where "Sold" isn't the exact stage name or where multiple sale stages exist.
