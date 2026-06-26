## Why Verified Sale shows 0

The performance report filters out the legacy `ad_source = 'GHL Won'` rows (correctly — per the earlier cleanup), so the only verified-sale data that exists is hidden. CTM is supposed to be the source of truth now, but the CTM sync is reading the wrong field, so `verified_sale` is `0` on every CTM-sourced row.

CTM's API returns the "converted" toggle nested as `sale.conversion` (boolean). The sync function reads `call.converted` at the top level, which CTM never sends — so `isConverted` always returns false. I confirmed against `ctm_calls.raw_payload`:

- `sale.conversion = true`: 4 calls (e.g. 2026-06-23 Sale $1040, 2026-06-14 Sale $1800)
- `sale.conversion = false`: 607
- `sale` missing: 591

So there are real verified sales in the raw payload — the aggregator just isn't counting them.

## Fix

1. `supabase/functions/sync-ctm/index.ts` — rewrite `isConverted(call)` to read the correct location:
   - primary: `call?.sale?.conversion === true`
   - tolerate the string/number/`yes` variants we already handle
   - keep the existing `call?.converted` fallback in case CTM ever surfaces it top-level
2. Redeploy `sync-ctm`, then trigger a resync for the 5 CTM-connected properties over the last ~90 days so `daily_metrics.verified_sale` is rewritten from the corrected aggregation.
3. Verify in SQL that `verified_sale` is now populated on real `ad_source` rows (Google PPC, Organic, Direct, etc.) and that the `GHL Won` row stays at the legacy values (we no longer surface that source).
4. Reload `/calls` (Source Performance + Campaign Breakdown) — Verified Sale column should show non-zero values for the 4 confirmed conversions and any others in range.

No UI/code changes to the report itself — column already binds to `verified_sale`; the bug is purely upstream in the sync.

## Out of scope

- Not touching Command, Lead Performance, canonical lead model, or any other surface.
- Not re-enabling GHL → `verified_sale`; CTM remains the sole writer.
- Not changing the report's filtering of `GHL Won`.