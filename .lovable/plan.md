The $19,692 is coming from `daily_metrics.cost` where `ad_source = 'Google PPC'` for the selected NoVA property and date range. That table currently includes two Winchester campaigns under the NoVA property:

```text
NOVA - Training (Conversions)             $14,258.89
Brand - Nova - Training                    $1,350.49
Haydn - Pmax - Nova Dog Training           $1,217.06
Winchester - Training Conversions CPA $50  $2,689.48
Winchester - Boarding                        $176.35
Total shown                               $19,692.27

Excluding Winchester campaigns            $16,826.44
```

Plan to fix it and prevent recurrence:

1. Update Ads-mode data loading so Google PPC rows are filtered through `campaign_labels` for the selected property/location, not just `property_id + ad_source`.
   - For NoVA, only campaigns labeled `NoVA` count.
   - Winchester campaigns stored on the NoVA property will be excluded from Ads-mode spend, records, CPL, CPGL, and funnel PPC metrics.

2. Keep Business mode unchanged unless campaign-label filtering is already intended there.
   - This fix targets Ads mode only, because that is where PPC campaign attribution is visible and currently wrong.

3. Update the Ads tile source note to reflect the true source:
   - `daily_metrics.cost where ad_source = 'Google PPC' and campaign is labeled for this property/location`.

4. Add a small guard in the data hook so if a property has campaign labels, Ads mode uses only labeled campaigns; if no labels exist, it falls back to current Google PPC behavior so other locations do not go blank.

5. Verify the exact NoVA range `2026-05-18` through `2026-06-16` returns `$16,826.44` in Ads mode after the change.