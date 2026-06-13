## Problem

The `Account Change History` card shows "Could not load change history: Failed to send a request to the Edge Function". The edge function is actually reachable, but the Google Ads GAQL query references fields that don't exist on `change_event`, so the API returns a 400 and our function returns 500. The browser surfaces it as a fetch error.

Direct test against the deployed function returns:

```
UNRECOGNIZED_FIELD: Unrecognized field in the query: 'change_event.feed'.
```

`change_event.feed` and `change_event.asset` are not valid selectable fields on `change_event` in Google Ads API v23.

## Fix

Update `supabase/functions/google-ads-change-history/index.ts`:

1. Remove the invalid `change_event.feed` and `change_event.asset` columns from the GAQL SELECT. Keep only validated fields: `change_date_time`, `user_email`, `client_type`, `change_resource_type`, `change_resource_name`, `resource_change_operation`, `changed_fields`, `campaign`, `ad_group`.
2. GAQL requires a date filter on `change_event.change_date_time` using `BETWEEN ... AND ...` (two-sided range) and a `LIMIT` (already present). Switch the WHERE clause to `BETWEEN '<since>' AND '<now>'` to satisfy the API contract.
3. Return a clearer error body when the upstream Google Ads call fails so the UI can show the underlying message instead of a generic fetch error.

## Frontend

No structural changes needed in `AccountChangeHistory.tsx`. Already handles `data.error` — once the function returns events, the list renders.

## Verification

- Re-invoke the edge function with the active Ashtabula/MoCo property and confirm a 200 with an `events` array.
- Reload the PPC Overview page and confirm the card renders the change feed (or a clean empty state).

## Files

- `supabase/functions/google-ads-change-history/index.ts` — fix GAQL query and error surface.