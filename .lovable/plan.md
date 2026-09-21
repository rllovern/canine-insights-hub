# Data Source Alerting

## Step 0 — The email path (answered now)

There is a working email path, and it is not Resend.

- `RESEND_API_KEY` is referenced in one place (the onboarding invite sender) but is **not** in the secret store, so that path is dead today.
- The working path is Lovable's built-in email: the sender domain `notify.rsk9insights.com` is verified and active, and auth emails already go out through it. App emails send from an edge function using the same managed service — no new key, no third party.
- Resend cannot be used on this domain anyway while it is delegated to Lovable's nameservers.

First action on approval: send one test email to rory@ridgesidek9.com with subject "RSK9 alert test" from a small send helper, then stop and wait for your confirmation before building anything else.

## Step 1 — Tables

`alert_recipients`, `alert_runbook`, `data_source_incidents` exactly as specified, each with row-level security allowing super admins only (the same pattern as other super-admin tables), plus grants. Two new columns on the data source connections table: `alerts_muted` (default false) and `alerts_mute_reason`.

## Step 2 — Runbook seed

All eleven entries seeded verbatim, including the catch-all "Unrecognized sync error" row and the `ghl / "stuck run reaped"` row (title and fix text supplied: "GoHighLevel sync run reaped" / "A run exceeded its time budget and was cleared. Usually recovers on the next pass.").

## Step 3 — Evaluator

New scheduled job `data-source-alerts`, running every 5 minutes, authenticated with the existing cron secret like the other jobs.

- Rule A: the connection's most recent sync error matches a runbook entry with `self_heals = false` → alert immediately.
- Rule B: `last_success_at` older than 6h (Google Ads, CTM) or 8h (GoHighLevel), or null on a connection older than 24 hours.
- `last_success_at` only. Never `status` or `is_connected`.
- Self-healing classes (timeout, upstream, quota) alert only if they persist into rule B.
- One incident per (source + runbook entry), listing every affected location. Ten identical Google Ads failures = one incident, one email.
- Muted connections are skipped entirely.

## Step 4 — Emails

Plain text, no styling. Opened / still-down (6h, then every 24h) / resolved / daily 8:00 AM Eastern all-clear, with the exact subjects and body fields you specified, Eastern timestamps, raw error truncated to 500 characters, and a link to `/admin/data-sources`. State is tracked on the incident row so each state change emails exactly once.

## Step 5 — Mute MoCo GoHighLevel

Set muted with reason "Awaiting data, connection built ahead of availability". It still appears in the daily email's muted list.

## Step 6 — Page

An Open Incidents panel on `/admin/data-sources` showing each incident, affected locations, the fix text, and mute/unmute with a required reason. Super admin only.

## Step 7 — Test

Force a fake auth-class error on one test row, confirm the opened email and its fix text; clear it and confirm the resolved email; fire the daily summary manually and confirm it; then remove the test data.

## What today's data means for the first run

Current connection state, read just now:

- GoHighLevel at NoVA last succeeded 18 August with 192 consecutive failures and no stored error text — rule B opens a real incident under the catch-all runbook entry on the first run.
- GoHighLevel at MoCo is the "Missing GHL location_id or token" row you're muting in Step 5.
- Several Google Ads connections are still 13-16 hours behind from this morning's 2-Step Verification block and are catching up; anything still behind 6 hours at first run opens a stale-data incident that should resolve itself as the backfill lands.

So expect real alerts on the first run, not silence. That is correct behaviour.

## Technical notes

- Error text is read from the connection's `last_error` and the most recent `sync_runs` entry for that property and source; matching is a case-insensitive regex against the runbook `match_pattern`, with the `source = 'any'` entries checked after source-specific ones and the unknown catch-all last.
- Incident identity: open incident with matching `source` + `runbook_id`; affected property list is updated in place as locations join or recover. Resolved when every affected property has a `last_success_at` newer than `opened_at`.
- The daily 8:00 AM Eastern summary is driven by the same 5-minute job (it sends on the first tick past 8:00 Eastern each day), so there is only one new cron entry.
- No `agent_` tables, no jarvis / ai-assistant / Bob code touched. No AI model calls.
- Nothing in the existing sync functions changes.
