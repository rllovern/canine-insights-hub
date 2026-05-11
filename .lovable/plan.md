## Why no data shows for Ridgeside K9 Ashtabula

The Test Connection succeeded and credentials were saved (the "Connected" badge comes from `is_connected = true`), but the actual data sync has never run for this property — and never will in its current state. Database confirms it:

- `property_data_sources` row: `is_connected = true`, but `status = 'disconnected'`, `last_synced_at = null`, `last_error = null` → sync was never attempted, or it failed silently.
- `ctm_calls`: 0 rows for this property.
- `daily_metrics`: 0 rows for this property.
- `sync_runs`: 0 rows for this property.

### Root cause

The `sync-ctm` edge function is written against an **old, no-longer-existing schema**. Every reference is wrong:

| sync-ctm uses | Actual current schema |
|---|---|
| table `client_data_sources` | `property_data_sources` |
| column `client_id` | `property_id` |
| `external_account_id` for the CTM sub-account | UI saves it under `config.account_id` |
| env secrets `CTM_API_ACCESS_KEY` / `CTM_API_SECRET_KEY` (agency-wide) | UI saves per-property `config.api_token` + `config.api_secret` |
| table `client_call_score_mappings` | `property_call_score_mappings` |
| writes `daily_metrics.client_id` | column is `property_id` |

On top of the schema mismatch, the dialog calls `sync-ctm` with `{ property_id, from_date, to_date }` while the function reads `{ client_id, date_from, date_to }`, so even a "Sync now" click would 400-out before reaching CTM.

Net effect: clicking "Sync now" silently fails, and the 12-hour scheduled orchestrator (`scheduled-sync-all`, which has the same schema problem) never produces rows either.

## Plan

Frontend stays as-is. All work is in `supabase/functions/sync-ctm/index.ts`.

### 1. Rewrite `sync-ctm` against current schema

- Accept `{ property_id, from_date, to_date, debug? }`.
- Look up the connection in `property_data_sources` (`property_id = ?`, `source = 'ctm'`).
- Read credentials from the row's `config` JSON: `account_id`, `api_token`, `api_secret`, optional `number_filter`. No env secrets — per-property creds, matching how Test Connection works.
- Build Basic auth from `api_token:api_secret` (matches `test-ctm`).
- Page through `…/accounts/{account_id}/calls/search.json?start_date=…&end_date=…`, identical pagination logic to today.
- Load score → bucket mapping from `property_call_score_mappings` (not `client_call_score_mappings`).
- Apply `number_filter` if present: drop calls whose tracking number isn't in the list (one CTM account can serve multiple Ridgeside locations).
- Insert raw call rows into `ctm_calls` (id from `ctm_call_id` upsert key) — this table is currently empty for every property and is what powers Call Tracking pages.
- Aggregate the same way it does today (date × channel × campaign), then upsert into `daily_metrics` with `property_id` (not `client_id`), preserving existing cost/impressions/clicks/sessions/users from other sources.
- On success: update the row with `status = 'connected'`, `last_synced_at = now()`, `last_error = null`. On failure: `status = 'error'`, `last_error = <message>`. Always insert a row into `sync_runs` so admin diagnostics work.

### 2. Trigger sync automatically after Connect/Update

Small UX fix in `CTMConnectionDialog.handleSave`: after a successful save, immediately call `sync-ctm` for the last 30 days (same as "Sync now") so a freshly-connected property doesn't sit empty until the user clicks again. Keep the manual "Sync now" button.

### 3. Out of scope (call out, don't fix here)

- `scheduled-sync-all` and the other sync functions (`sync-google-ads`, `sync-ga4`, `sync-keyword-com`) reference the same dead `client_data_sources` / `client_id` schema. They also need the same rewrite, but that's a separate task — this plan unblocks CTM only, which is what the user is asking about.
- No DB migrations. No new tables. No schema changes.

## Verification after implementing

1. Open the CTM dialog for Ashtabula → click Sync now (30d).
2. Toast should show "Synced N calls."
3. `select count(*) from ctm_calls where property_id = 'ea92c5ce-…'` > 0.
4. `select count(*), sum(record_count) from daily_metrics where property_id = 'ea92c5ce-…'` > 0.
5. `property_data_sources.status = 'connected'`, `last_synced_at` populated.
6. Dashboard for Ashtabula shows call volume in the chosen date range.
