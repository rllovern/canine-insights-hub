# Sales Performance — Verified Sale only, sourced from CTM "converted"

Two-part change. Part 1 is presentation (the page the user is looking at). Part 2 rewires where `verified_sale` actually comes from, because today it's populated from GHL won opportunities — not from CTM's converted toggle as the user specified.

## Scope confirmation

"Sales performance page" = `src/pages/CallTracking.tsx` — the client-facing performance report with the Source Performance and Campaign Breakdown cards we just edited. (Not the Command page; not Lead Performance.) If you meant a different page, say so and I'll re-plan.

## Part 1 — Page changes (`src/pages/CallTracking.tsx`)

Remove every AI-Projected Sale surface:

- Delete the "Total {Projected}" + "{Projected} by Source" chart pair (the conditional block around line 128–137).
- Drop `projected_sale` / `cost_per_projected_sale` from the `series` builder and from `buildSourceSeries`.
- Remove `projected_sale` from Source Performance + Campaign Breakdown column arrays and label maps.
- Remove the `PROJECTED_LABEL` import and unused `calc.costPerProjectedSale` references.

Keep `verified_sale` exactly where it already renders in those two tables. No other column changes (the Quality column was already removed last turn; the GHL Won source filter stays).

Note: `Total Leads = bad + good + AI-projected` (canonical lead model) is unaffected — that math lives in `leadModel.ts` and isn't tied to the displayed column.

## Part 2 — Re-source `verified_sale` from CTM "converted"

Today `daily_metrics.verified_sale` is written by `sync_verified_sales_daily_metrics` from GHL won opportunities, called inside `sync-ghl`. The user wants it to mean "CTM call where `converted` toggle is on." That requires:

1. **Sync** — update `supabase/functions/sync-ctm/index.ts` to read each call's `converted` flag from the CTM API (CTM exposes it on the call object) and count it per `date × property × ad_source × campaign` alongside the existing buckets. Write the count into `daily_metrics.verified_sale` in the same upsert that writes `record_count`, `good_leads`, etc.
2. **Stop the GHL writer from clobbering it** — remove the `sync_verified_sales_daily_metrics` call from `supabase/functions/sync-ghl/index.ts` so GHL no longer overwrites the CTM-sourced number. Leave the SQL function in place (harmless, unused) to avoid a destructive migration this turn.
3. **Backfill** — trigger a fresh CTM sync for the active date range so historical `verified_sale` reflects CTM converted toggles instead of stale GHL values.

No schema change needed: `daily_metrics.verified_sale` already exists and is the right shape.

## Out of scope

- Command page funnel / verdict / KPI tiles.
- Lead Performance page.
- Jarvis + ai-assistant prompts (they read `v_lead_counts_daily`, which doesn't surface verified_sale).
- Renaming the column or label — stays "Verified Sale".

## Verification

- Load the report on a property with known CTM converted calls; confirm Verified Sale column matches the CTM "converted" count for that range.
- Confirm the AI-Projected chart pair and table column are gone.
- Confirm a GHL re-sync no longer changes `verified_sale`.
