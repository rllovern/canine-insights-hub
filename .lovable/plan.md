# Fix Colorado Springs double-counted spend

## What's actually wrong

Colorado Springs is counting the same campaign twice under two names.

On 21 Sep the campaign "Haydn Conversions" was renamed to "Generic Conversions" in Google Ads. Our spend history is stored by campaign *name*, so the rename created a brand-new history line and backfilled it — while the old "Haydn Conversions" line was left in place with exactly the same daily numbers.

Verified: every day from 22 Aug to 21 Sep has two rows with identical spend (e.g. 11 Sep, $284.54 twice). Month-to-date that duplicate is $3,297.27. The report shows $7,329.61; remove the duplicate and it is $4,032.34 — exactly the Google Ads figure.

Rows before 22 Aug under the old name are genuine history for the same campaign, not duplicates.

This is the only affected campaign in the whole portfolio — I checked every location for spend recorded under a campaign name Google no longer reports, and Colorado Springs' "Haydn Conversions" is the single hit.

## The fix

1. **Merge the duplicate history.** For 22 Aug - 21 Sep, move the lead counts sitting on the old-name rows (22 records, 5 leads, 1 good lead) onto the matching new-name rows, then delete the old-name duplicate rows. Spend is identical on both sides, so nothing is added or lost.
2. **Keep the earlier history.** Rename the pre-22 Aug rows (28 Apr - 21 Aug: $17,245.94, 41 records, 33 leads) to "Generic Conversions" so the campaign reads as one continuous line instead of splitting at the rename date. No numbers change.
3. **Show the exact before/after row counts and totals before running anything**, and re-check the Colorado Springs month-to-date figure afterwards — it should read $4,032.34.

## Stop it happening again

Renames will keep happening, so add a standing check rather than relying on someone noticing:

- Budget Pacing gets a small warning on any location where spend in the selected period is recorded under a campaign name that Google no longer returns for that account. It names the campaign and the amount, so a rename is caught the day after it happens instead of months later.
- The same orphan list is surfaced on the admin data sources page so it can be reviewed and merged.

## Technical notes

- Root cause: `daily_metrics` is keyed on `(property_id, date, ad_source, campaign)` — campaign *name* — while `campaign_budgets` is refreshed as a full snapshot each sync, so a rename orphans the old metric rows but not the budget rows. Campaign identity is `campaign.id`; names are not stable, and not unique across the portfolio.
- Data fix is a one-off migration: an `UPDATE` merging lead columns into the new-name rows over the overlap window, a `DELETE` of the old-name rows in that window, then an `UPDATE ... SET campaign = 'Generic Conversions'` for dates before it, scoped to that one property and `ad_source = 'Google PPC'`.
- Orphan detection: campaign names present in `daily_metrics` for the period with non-zero cost but absent from that property's current `campaign_budgets` snapshot. Read-only, computed in the page from data already loaded — no schema change, no sync change.
- Out of scope: storing `campaign.id` on `daily_metrics`. That is the real long-term fix and is a bigger migration; I would raise it separately.
