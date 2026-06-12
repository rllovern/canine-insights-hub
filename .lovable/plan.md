
## 1. Go High Level integration

**Auth.** Agency-wide Private Integration token stored as a secret `GHL_PRIVATE_INTEGRATION_TOKEN` (requested via add_secret). One token, used across all locations.

**Per-property mapping.** Add `ghl` to `property_data_sources.source` enum (or use existing text column — TBD at build time). Each property's GHL config stores `{ location_id }`. A small Connect dialog on the property settings lets internal users pick which GHL location maps to the property (we list locations via the agency token).

**Data model — capture everything, surface what we need now.**

- `ghl_contacts` — typed columns for the fields we actively use (first_name, last_name, email, phone, source, assigned_to, created_at, first_response_at, speed_to_lead_seconds), plus a `raw jsonb` column holding the full untouched contact payload from GHL. New fields tomorrow = no schema change.
- `ghl_events_raw` — append-only archive of every conversation/message/opportunity/appointment/note payload we pull, keyed by `(property_id, ghl_object_type, ghl_object_id, occurred_at)` with a `raw jsonb` body. This is the "house every conceivable data point" bucket; we can derive new metrics later without re-pulling.
- All tables: RLS scoped via internal role + viewer access through existing `viewer_can_access`, plus the standard GRANT block.

**Speed-to-lead computation.** For each new contact, find the earliest outbound message/call timestamp in the conversations endpoint and store the delta on `ghl_contacts.speed_to_lead_seconds`. Re-evaluated on every sync until a value is set.

**Edge function `sync-ghl`.** Same shape as the existing `sync-google-ads` / `sync-ctm` / `sync-ga4`:
- Input: `{ property_id, date_from, date_to }`.
- Pulls contacts (paginated), conversations, opportunities, appointments, notes for the date window.
- Upserts typed rows into `ghl_contacts`; inserts raw payloads into `ghl_events_raw`.
- Returns `{ written }`.

**Scheduler hookup.** Add `ghl` to `scheduled-sync-all`'s `SOURCE_TO_FN` map so the existing every-N-hours cron picks it up.

**No new dashboard surfaces in this plan.** Speed-to-lead, lead counts, etc. will land as a follow-up once the data is flowing. (Confirm if you want a quick KPI added now.)

## 2. API Health page

**Route.** `/admin/settings/api-health` (also reachable as a tab inside `AdminSettings` so it lives under Settings as requested). Internal-only via `RequireAuth requireRealRole="internal"`.

**Layout.** Grouped by integration:

```text
Google Ads            ● Healthy        Last success: 2h ago    Last issue: —
  ▸ expand → table of properties, status pill, last_success_at, last_failure_at, last error message
CallTrackingMetrics   ● Degraded       Last success: 6h ago    Last issue: 32m ago
GA4                   ● Healthy        ...
Keyword.com           ● Healthy        ...
Go High Level         ● Not connected  ...
```

**Status rules per (integration, property):**
- `healthy` — most recent `sync_runs` row is `success` and `started_at` is within `2 × cron interval`.
- `failing` — most recent run is `failure`.
- `stale` — last success older than `2 × cron interval`.
- `not_connected` — no `property_data_sources` row with `status='connected'`.

**Aggregate status per integration:** worst status across its connected properties.

**Data source.** Reuses the existing `sync_runs` table (already populated by `scheduled-sync-all`). We add an index on `(source, started_at desc)` if one isn't already present, and a SECURITY DEFINER RPC `get_api_health_summary()` that returns one row per (source, property) with `status`, `last_success_at`, `last_failure_at`, `last_error_message`. Internal-only via `has_role` check.

**Drilldown row shows:**
- Property name + link to the property page
- Status pill
- Last successful run (date/time, relative)
- Last issue (date/time, relative, with error excerpt; click to view full message in a popover)
- "Sync now" button (calls the matching `sync-<source>` edge function for that property)

**Auto-refresh.** Page refetches the RPC every 30s.

## 3. Sidebar / navigation

No new top-level nav item — API Health lives under Settings. Settings page becomes tabbed: `Schedule | API Health`.

## 4. Files touched

- New migration: `ghl_contacts`, `ghl_events_raw`, GHL added to `property_data_sources` source values, `get_api_health_summary()` RPC, index on `sync_runs`.
- New secret: `GHL_PRIVATE_INTEGRATION_TOKEN` (via add_secret prompt).
- New edge function: `supabase/functions/sync-ghl/index.ts`.
- New edge function: `supabase/functions/list-ghl-locations/index.ts` (for the connect dialog).
- Update `supabase/functions/scheduled-sync-all/index.ts` — add `ghl` to source map.
- New component: `src/components/data/GHLConnectionDialog.tsx`.
- Update `src/pages/admin/AdminSettings.tsx` — wrap content in tabs.
- New: `src/pages/admin/ApiHealth.tsx` (rendered inside the Settings tab).
- Update `src/pages/admin/AdminProperties.tsx` — add GHL row in the data sources area.

## 5. Out of scope (for this iteration)

- GHL-driven dashboard KPIs and charts (speed-to-lead, lead volume) — added once data is flowing.
- Per-property GHL OAuth installs (we're using the agency token).
- Alerting/notifications when a sync goes red.

Confirm and I'll switch to build mode and implement.
