
## Root cause of the Winchester GHL failure

`supabase/functions/sync-ghl/index.ts` line 342 calls `POST /contacts/search`. GHL periodically returns `400 { message: "Error occurred while searching for contact" }` under load — it is not a payload problem (identical body succeeded 4 minutes later). The current `safe()` wrapper catches the error, writes it to `sync_runs`, and moves on. There is no retry, so a single blip surfaces as "Blocked" in the health panel and stays that way until the next 12h `scheduled-sync-all` tick.

Nothing about Winchester's config is wrong. Fix = make transient failures self-heal.

## Changes

### 1 — In-function retry for the flaky GHL search call

`supabase/functions/sync-ghl/index.ts`

Wrap the two `/contacts/search` calls (contacts pagination + tag refresh) in a small retry helper: up to 3 attempts, 500 ms → 1500 ms → 4500 ms backoff, retry only on HTTP `400/429/5xx`. On the final failure, throw the same error string so the existing `safe()` still records it. No behavior change on success.

```ts
async function ghlFetchRetry(method, path, token, body, tries = 3) {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await ghlFetch(method, path, token, body); }
    catch (e) {
      last = e;
      const msg = String(e);
      if (!/\b(400|408|429|5\d\d)\b/.test(msg)) throw e;
      await new Promise(r => setTimeout(r, 500 * 3 ** i));
    }
  }
  throw last;
}
```

### 2 — Per-source retry in the orchestrator

`supabase/functions/scheduled-sync-all/index.ts`

Today each `(property, source)` is invoked once. Change it to: on `status === "failure"`, sleep 30 s then invoke a second time; if still failing, sleep 2 min and try a third time. Only write **one** row to `sync_runs` per attempt — the last attempt determines the visible status, but each attempt still logs so we can see the pattern. Attempts share a `run_group_id` (uuid) recorded in `sync_runs.stats` so the UI can collapse them.

Cap total wall time per property-source at 5 minutes so one stuck integration can't starve the rest of the cron run.

### 3 — Between-cron auto-recovery pass — new function `resync-failed`

New file `supabase/functions/resync-failed/index.ts`. Runs every 15 minutes via `pg_cron` (`net.http_post` to its URL with the existing `CRON_SECRET` bearer already used by `scheduled-sync-all`). Logic:

1. Read `property_data_sources` where `status = 'connected'`.
2. For each `(property_id, source)`, find the most recent row in `sync_runs`. If it's a `failure` **and** no successful run for that pair has landed since it, and the failure is between 5 minutes and 6 hours old, invoke the matching sync function (same map as `scheduled-sync-all`).
3. Apply the same 3-attempt retry as in change #2.
4. Ignore pairs that have already been retried ≥ 3 times within the last 6 hours — new column below tracks this. That prevents a persistently broken integration (bad token, revoked GHL access) from hammering the API forever; those keep showing "Blocked" until the next 12h cron or a manual sync.

### 4 — Schema addition — one migration

- Add `sync_runs.attempt` `int not null default 1`
- Add `sync_runs.run_group_id` `uuid` (nullable — old rows keep `null`)
- Add `sync_runs.trigger_source` `text` (values: `cron`, `resync_failed`, `manual`, `unknown`; default `unknown`)
- Index: `sync_runs(property_id, source, started_at desc)` — already exists implicitly through queries but confirm and add if missing so the recovery reader is fast.

RLS/grants: `sync_runs` already has policies; only new columns are added so no policy changes needed. Grants already cover authenticated/service_role.

### 5 — Cron schedule

Insert (not migrate — contains the anon key) a new `cron.schedule` entry:

```
'resync-failed-every-15m'   */15 * * * *   POST /functions/v1/resync-failed
```

with the same `Authorization: Bearer <CRON_SECRET>` header used by `scheduled-sync-all`.

### 6 — UI: surface retry state (small)

`src/components/layout/SourceHealthPanel.tsx` — when `last_run_status === "failure"` but `last_failure_at` is within the last 15 minutes, show label `"Retrying"` (amber, not red) with tooltip `"Auto-retry in progress"`. Purely presentational; uses fields already returned by `get_api_health_summary`.

## Files touched

- edit `supabase/functions/sync-ghl/index.ts` (retry helper + call sites)
- edit `supabase/functions/scheduled-sync-all/index.ts` (per-source retry loop)
- new `supabase/functions/resync-failed/index.ts`
- new migration: add `attempt`, `run_group_id`, `trigger_source` to `sync_runs`
- insert-only SQL: `cron.schedule('resync-failed-every-15m', …)`
- edit `src/components/layout/SourceHealthPanel.tsx` (Retrying state)

## Not doing

- No auto-disable of a connection on repeated failure — user should see it and decide.
- No email/notification on failure — separate ask.
- No change to CTM/Google Ads/GA4 sync internals; the orchestrator-level retry (change #2) plus recovery pass (change #3) already covers them without touching each function's body.
