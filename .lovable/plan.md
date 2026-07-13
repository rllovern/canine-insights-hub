
## Why the panel shows "Stale" for MoCo Google Ads

`SourceHealthPanel` labels a source **Stale** when its most recent successful sync is > 24 hours old. For MoCo, that's exactly what's happening:

- `sync_runs` for `property_id = a4faa96c… (Ridgeside K9 MoCo)`, `source = google_ads`:
  - Last success: **2026-07-11 06:00 UTC** (~60h ago).
  - Zero attempts of any kind since then — not one success, not one failure.
- Meanwhile the other four properties' Google Ads have run every 6 hours on schedule (7–12 attempts in the last 3 days). MoCo's Google Ads has only 2 attempts in that same window.
- MoCo's `property_data_sources` row for `google_ads` is `is_connected = true`, `status = connected`, external_account_id `7133441374`, MCC `2189989288`. Nothing looks disabled.

So the health panel is correct — the underlying problem is that the cron loop has silently stopped invoking `sync-google-ads` for MoCo, and no `sync_runs` row is being written for the attempts that should exist. `resync-failed` also can't help because its trigger condition is "last run is a failure" — a pair that never runs at all doesn't qualify.

The most likely mechanism: `admin.functions.invoke("sync-google-ads", { … })` for MoCo hangs (Google Ads API stall or Deno CPU/wall-time exhaustion inside the child function), the parent `scheduled-sync-all` invocation is killed at the platform wall-time limit before the `sync_runs.insert(...)` after the invoke runs, and the outer loop never advances. Because insertion happens *after* `invokeOnce` returns, a killed parent produces exactly what we're seeing: no success row, no failure row, no log.

## What this plan will do

1. **Diagnose the live cause for MoCo specifically.** Manually invoke `sync-google-ads` for MoCo's property_id from an edge-function test call and read the response body / status. This tells us whether it's an expired refresh token, revoked MCC linkage, an invalid customer ID, or a plain timeout. No app code changes yet — just capture the truth.

2. **Fix whatever step 1 surfaces.** Expected shapes:
   - Token/permission → prompt the internal user to reconnect MoCo Google Ads (record `status='error'` with `last_error` so it surfaces in the panel instead of going silent).
   - MCC access revoked → same, with the specific fix message.
   - Timeout / no data → keep connection, rely on step 3.

3. **Stop the silent-skip failure mode in `scheduled-sync-all`.** Wrap `admin.functions.invoke` with an `AbortController` + `Promise.race` timeout (e.g. 90s per attempt) and, critically, insert the `sync_runs` row *before* the invoke starts (as `pending`) and update it to `success`/`failure` after — so even a killed parent leaves a trail. Any pair whose latest row is `pending` older than N minutes is treated as a failure by the health panel and by `resync-failed`.

4. **Broaden `resync-failed` recovery.** Add a second candidate rule: any connected `(property, source)` whose most recent `sync_runs` success is older than 25 hours (or has no rows at all) is also eligible, subject to the same 3-cycles-per-6h rate limit. This catches the exact MoCo case even if a future silent skip slips through.

5. **Verify.** After deploy, wait one 6h cron cycle (or invoke `scheduled-sync-all` and `resync-failed` manually), confirm a new `sync_runs` row appears for MoCo Google Ads, and confirm the panel drops back to **Live**.

## Technical details

- Files to change: `supabase/functions/scheduled-sync-all/index.ts`, `supabase/functions/resync-failed/index.ts`. Possibly a small migration if we add a `pending` status convention to `sync_runs` (only if the current CHECK constraint rejects it).
- No frontend changes needed — `SourceHealthPanel` already handles `retrying`/`stale`/`failing` states correctly.
- The MoCo-specific fix in step 2 may be user-facing (reconnect prompt) rather than a code change; will report findings from step 1 before proceeding.
