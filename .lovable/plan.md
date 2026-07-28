## Why the column shows zeros

`Verified Sale` in the Performance report reads `daily_metrics.verified_sale`. That field is written **only** by `sync-ctm`, from CTM's manual "converted" toggle on a call. Nobody sets that toggle for NoVA, so every NoVA row is 0 (across the whole account only Ashtabula has any — 89 total).

The real sales live in GHL: **588 won opportunities for NoVA**. There is a rollup function (`sync_verified_sales_daily_metrics`) that writes them into a single synthetic `GHL Won / Verified Won` row — but (a) those rows currently sit at `verified_sale = 0`, and (b) the Performance report deliberately filters `GHL Won` out because it isn't a media source. Net result: zeros everywhere.

## What source the wins can be mapped to

Each GHL opportunity carries an `attributions` array with the original session source and contact medium (form / call / calendar / manual). For NoVA's 588 wins:

```text
Paid Search   (form, all with gclid/gbraid)   147  -> Google PPC
Direct traffic (form 131 + calendar 19)       150  -> Direct
Organic Search (form 56 + calendar 2)          58  -> Organic
Social media   (form 11 + facebook 2)          13  -> Social
Referral       (form)                           7  -> Referral
Third Party    (zapier)                        65  -> Unattributed (imported)
CRM UI         (manual 44 + conversation 23)   67  -> Unattributed (manual entry)
Other / none                                   81  -> Unattributed
```

So ~375 of 588 (64%) map cleanly to a real media source using GHL's own data — far better than the ~14% that CTM phone matching gave. Medium also tells us the contact method (form vs phone conversation vs booked calendar vs manual CRM entry).

## The plan

**1. Attribution resolver (database)**

Add a security-definer function `ghl_won_attribution(_property_ids uuid[], _from date, _to date)` returning one row per won opportunity: `property_id`, `won_day` (property-timezone calendar day of `won_at`), `ad_source`, `contact_method`, `monetary_value`.

Source mapping, first matching rule wins:
- `utmGclid` / `gbraid` present, or session source `Paid Search` -> `Google PPC`
- `Organic Search` -> `Organic`
- `Direct traffic` -> `Direct`
- `Referral` -> `Referral`
- `Social media` -> `Social`
- everything else (`Third Party`, `CRM UI`, `Other`, missing) -> `Unattributed`

Contact method from `medium`: `form` -> Form, `conversation` -> Call/Message, `calendar` -> Booked appointment, `manual` -> Manual CRM, `zapier` -> Imported.

Falls back to `raw->>'source'` (e.g. "Google Ads", "Website Organic") when the attributions array is empty.

**2. Wire it into the Performance report**

- New hook `useWonAttribution(range, scope)` in `src/lib/verified-sales.ts`.
- In `SourceOutcomeTable` and `CampaignTable` (`src/pages/CallTracking.tsx`), the `Verified Sale` cell reads from this hook keyed by `ad_source`, instead of summing `daily_metrics.verified_sale`.
- Add an **Unattributed** row to the source table so the Grand Total always equals total GHL wins for the period. Campaign-level rows show wins only where the campaign is resolvable; the rest roll into the source's unattributed line.
- Counted on **won date** (property timezone), consistent with Sale Records and the revenue runway.
- Prior-period deltas use the same resolver over the comparison range.

**3. Make GHL the single source of truth everywhere**

Because you confirmed GHL is authoritative across the board:
- Command cards, campaign table, Jarvis rollups and public/token reports switch to the GHL-derived verified-sale count.
- `sync-ctm` stops writing `daily_metrics.verified_sale` from the CTM "converted" toggle (it stays as a call attribute but no longer drives the metric), so the two definitions can't diverge again.
- Fix `sync_verified_sales_daily_metrics` so the `GHL Won` rollup rows are no longer zero, and keep them as the reconciliation/audit trail.

**4. Verification**

- NoVA, last 30 days: source-table Verified Sale total must equal the row count on Sale Records for the same range.
- Grand Total (including Unattributed) must equal `count(*)` of won opportunities in range.
- Spot-check a Paid Search win: appears under Google PPC, not filtered out by the campaign-label rule.

## Technical notes

- The label rule currently drops PPC rows whose campaign isn't in `campaign_labels`. Verified sales attributed to `Google PPC` are attached at source level, so they bypass that filter and won't be silently zeroed on shared Google Ads accounts.
- Won-day bucketing reuses the existing local-day helper so heatmap, runway, list, and this column all agree.
- Attribution is computed in SQL (not client-side) to keep the payload small and RLS-scoped.
