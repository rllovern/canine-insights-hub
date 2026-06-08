## Diagnosis

The label-filter column is set correctly (`Winchester` / `NoVA`), but the sync still wrote every campaign — both NOVA-named and Winchester-named campaigns landed in both properties. That tells us the GAQL `label.name = '<filter>'` lookup is not narrowing the campaign list. Most likely root cause: the Google Ads labels in customer `9627559898` are not literally spelled `Winchester` / `NoVA`. GAQL label-name matching is exact and case-sensitive, so a label spelled `WIN`, `Win-Property`, `RSK9 Winchester`, `nova`, etc. won't match.

We need to (1) see what labels actually exist on that account, (2) set the correct filter strings, and (3) make the sync fail loudly when a filter matches zero campaigns so this can't silently fall back to pulling everything.

## Step 1 — Add a labels lookup edge function

New function `supabase/functions/list-google-ads-labels/index.ts` (internal-only, JWT-validated like `list-mcc-customers`). Takes `{ property_id }`, uses that connection's refresh token + customer id, runs:

```
SELECT label.id, label.name, label.resource_name
FROM label
```

and

```
SELECT label.name, campaign.id, campaign.name
FROM campaign_label
```

Returns a JSON list of labels and the campaigns each one is attached to. This is read-only.

## Step 2 — Surface the result so you can pick

Call the new function from the Admin → Properties page for the two RidgesideK9 connections (a small "View labels" button next to the Google Ads row, internal-only). It opens a dialog showing every label name and the campaigns under it so you can confirm the exact spelling.

## Step 3 — Update the stored filter values

Once we know the exact label names, update `property_data_sources.campaign_label_filter` for both properties.

## Step 4 — Harden the sync to never silently pull everything

In `sync-google-ads/index.ts`:

- If `campaign_label_filter` is set but the label query returns zero campaigns, mark the connection `status='error'` with `last_error='label "<x>" matched 0 campaigns'`, write nothing, and return 400. (Today it returns 200 with 0 rows, which looks like success.)
- Also write `last_error='label filter active: <n> campaigns'` (as info) on success so we can confirm the filter applied. Or log the matched IDs to function logs so they're visible in `edge_function_logs`.
- Defensive: trim whitespace on the filter before sending to GAQL.

## Step 5 — Re-run the backfill

Delete the bad Google PPC rows for the two properties from `2026-05-28` onward, then re-trigger `sync-google-ads` for each over that date range with the corrected filter. The merge-upsert preserves CTM/GA4 columns.

## Out of scope
- No schema changes; the column already exists.
- No changes to other sync functions, dashboards, or report views.
