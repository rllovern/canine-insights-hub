## Problem

RidgesideK9 Winchester and RidgesideK9 NoVA both connect to the same Google Ads customer ID (`9627559898`). Today `sync-google-ads` pulls every campaign's cost into both properties, so cost is duplicated and incorrect. Campaigns in that account are tagged with Google Ads **labels** (e.g. "Winchester", "NoVA") that already identify which property each campaign belongs to.

## Goal

Each property's Google Ads sync should only ingest cost/impressions/clicks from campaigns whose Google Ads labels match a configured value for that property.

- Winchester property → campaigns labeled `Winchester`
- NoVA property → campaigns labeled `NoVA`
- Properties without a label filter keep current behavior (pull all campaigns).

## Changes

### 1. Store the label filter per connection
Add a `campaign_label_filter text` column to `public.property_data_sources` (nullable). Backfill the two RidgesideK9 rows:

- Winchester (`property_data_sources.id` where property = RidgesideK9 Winchester) → `Winchester`
- NoVA (property = RidgesideK9 - NoVA) → `NoVA`

### 2. Update `supabase/functions/sync-google-ads/index.ts`

- Read `conn.campaign_label_filter`.
- If set, fetch the matching campaign IDs first via GAQL on the `campaign_label` resource:

  ```
  SELECT campaign.id, label.name
  FROM campaign_label
  WHERE label.name = '<filter>'
  ```

  Build an allowlist of campaign IDs.
- Modify the existing metrics GAQL to add `AND campaign.id IN (<ids>)` when an allowlist exists. If the allowlist is empty, skip the metrics call and write zero rows (and log a warning into `last_error` so it's visible in Settings).
- Aggregation/upsert logic stays the same. The non-destructive merge with CTM/GA4 columns is unchanged.

### 3. Admin UI (Settings → property data sources)
Add an optional "Campaign label filter" text input to the Google Ads connection row so internal users can set/change the value without a DB edit. Saving updates `property_data_sources.campaign_label_filter`. Empty = no filter (current behavior).

### 4. Backfill historical data
After deploy, trigger a manual re-sync for both Winchester and NoVA over the affected date range (May 28 → today). The merge-upsert path will overwrite the bad cost values with the label-scoped totals while preserving call/lead columns.

## Out of scope
- No changes to GA4, CTM, or Keyword.com syncs.
- No schema change to `daily_metrics`.

## Technical notes
- GAQL label filter uses the `campaign_label` resource, not a `WHERE label.name` clause on `campaign` (Google Ads API rejects that). Two-query approach (labels → ids → metrics) is the standard pattern.
- `campaign.id` values are returned as strings; cast/serialize as quoted list in the `IN (...)` clause.
