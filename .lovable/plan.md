# Fix Source Performance: the missing 38 records

## What's actually wrong

The 38-record gap is not a display bug — the Source Performance table is throwing away real paid calls.

Checked NoVA, Aug 1–17. The database holds 88 records:

```text
Google PPC   58    Organic 14    Direct 9    Referral 7
```

Inside Google PPC:

```text
NOVA - Training (Conversions)      9 records    (labeled NoVA)
Brand - Nova - Training            6 records    (labeled NoVA)
Pmax - Nova Dog Training           5 records    (labeled NoVA)
Google Ads                        36 records    (NOT labeled)  <-- dropped
Google Call Asset                  2 records    (NOT labeled)  <-- dropped
```

36 + 2 = the 38 missing records. The table shows Google PPC as 20 records / 7 good leads; the truth is 58 records / 42 good leads.

## Why they get dropped

Two locations (NoVA and Winchester) share one Google Ads account, so the source and campaign tables filter Google PPC rows through a per-location campaign allow-list, keeping only campaigns labeled for that location.

That allow-list is a Google Ads concept. But "Google Ads" and "Google Call Asset" are not Google Ads campaigns — they are call-tracking source names coming from CTM. Those rows carry zero cost, zero impressions and zero clicks, and only ever hold calls. They can never appear in the allow-list, so the filter silently deletes the majority of NoVA's paid phone calls from the table.

The KPI card at the top does not apply the filter at all (it reads the records view without any source or campaign restriction), which is why it correctly shows 88 while the table shows 50.

## The fix

Change the allow-list so it only applies to rows that actually came from the Google Ads account — rows carrying spend, impressions or clicks, or whose campaign is a known campaign in that shared account. Call-tracking rows always pass through.

Then apply that same corrected rule to the Records KPI, so the top card and the table are computed identically and reconcile by construction.

Expected result for NoVA, Aug 1–17 after the fix:

```text
Records KPI            88
Source table total     88   (Google PPC 58, Organic 14, Direct 9, Referral 7)
Google PPC good calls  42   (currently shown as 7)
```

Winchester is the other shared-account location and gets the same correction; every other location is unaffected because it has no allow-list.

## Technical detail

- `src/pages/CallTracking.tsx` — `useLabelRuleFilter`: only exclude a `Google PPC` row when the campaign belongs to the shared Google Ads account (spend/impressions/clicks present on that campaign anywhere in the window, or the campaign appears in `campaign_labels` for any property) and is not labeled for this property. Zero-spend call-tracking campaigns pass through.
- `src/components/command/useCommandData.ts` — `fetchWindow`: select `property_id, ad_source, campaign` from `v_lead_counts_daily`, exclude `GHL Won`, and apply the same corrected allow-list to the records sum. Extract the rule into a shared helper (`src/lib/campaignScope.ts`) used by both surfaces so they cannot drift again.
- `src/components/command/useCommandData.ts` — `fetchPpcWindow`: replace the hard `.in("campaign", allowed)` with the shared rule.
- Database: `ai_assistant_context` and `ai_assistant_context_multi` compute `records` from `v_lead_counts_daily` with no source or campaign filter while all other totals are filtered. Update both (and the public-token variant) to use the corrected rule so Bob quotes the same numbers as the cards.
- Add a unit test covering: labeled campaign kept, other location's labeled campaign dropped, zero-spend call-tracking campaign kept.

## Verification

Re-query NoVA and Winchester for the current month and confirm the KPI records, the source table grand total, and Bob's `records` all return the same figure, and that good calls per source match the raw table.
