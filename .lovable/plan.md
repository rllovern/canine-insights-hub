# Fix `no_entry` over-counting in CTM sync

## Problem

`supabase/functions/sync-ctm/index.ts` → `classifyCall()` returns `"no_entry"` in two distinct cases:

1. The call has **no score label at all** → genuinely unscored.
2. The call **has a score label** but it isn't in `property_call_score_mappings` → "scored, but unmapped" (e.g., "Wrong Number" after we removed it from the spam mapping).

The aggregator then increments both `no_entry` and `leads` for each. Result: today's Source Performance card shows `no_entry = 4` when it should be `2`, because the two "Wrong Number" calls are being miscounted.

## Fix

Change classification + aggregation so unmapped/scored calls are tracked separately from truly unscored calls.

### 1. `supabase/functions/sync-ctm/index.ts`

- Add a new bucket value `"unmapped"` to the `Bucket` union.
- In `classifyCall`:
  - Return `"no_entry"` only when there are zero score labels.
  - Return `"unmapped"` when labels exist but none match a mapping.
- In the aggregation loop:
  - Continue to count `"unmapped"` toward `record_count` (so the records total stays at 7).
  - Do **not** increment `leads`, `no_entry`, or any quality bucket for `"unmapped"`.
  - `"no_entry"` keeps its current behavior (counts toward `record_count`, `leads`, and `no_entry`) — but only fires for actually unscored calls.

### 2. Resync

Trigger `sync-ctm` for Ridgeside K9 Ashtabula (30 days) so existing `daily_metrics` rows are recomputed. Expected outcome for May 11–13: total `record_count` unchanged (7), `no_entry` drops from 4 → 2.

## Out of scope

- No UI changes — the Source Performance card already reads `no_entry` from `daily_metrics`, so once the underlying number is correct the card is correct.
- No new column/metric for "unmapped" surfaced in the UI; it's effectively absorbed into "records − sum of categorized buckets". If you later want a visible "uncategorized" tile we can add it as a follow-up.
