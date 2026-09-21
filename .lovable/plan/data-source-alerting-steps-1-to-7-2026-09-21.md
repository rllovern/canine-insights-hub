# Data Source Alerting — Steps 1 to 7

Step 0 is done: the test email arrived via the built-in email service on notify.rsk9insights.com, sending from alerts@notify.rsk9insights.com. No third-party key needed.

## Step 1 — Tables

- `alert_recipients` (email, active), seeded with rory@ridgesidek9.com
- `alert_runbook` (source, match_pattern, error_class, self_heals, title, fix_steps)
- `data_source_incidents` (source, error_class, runbook reference, affected locations, first error, opened_at, last_notified_at, reminder_count, resolved_at, muted, mute_reason)

All three super-admin only, same access pattern as the other admin tables, with grants. Two new columns on the data source connections table: `alerts_muted` (default false) and `alerts_mute_reason`.

## Step 2 — Runbook seed

All eleven entries seeded verbatim as specified, including the catch-all "Unrecognized sync error" and the GoHighLevel "stuck run reaped" row ("GoHighLevel sync run reaped" / "A run exceeded its time budget and was cleared. Usually recovers on the next pass.").

## Step 3 — Evaluator

The `data-source-alerts` function gains the evaluator, run every 5 minutes by a new scheduled job using the existing cron secret.

- Rule A: the connection's most recent error matches a runbook entry with `self_heals = false` → alert immediately.
- Rule B: last successful sync older than 6h (Google Ads, CTM) or 8h (GoHighLevel), or never on a connection older than 24 hours.
- Last-success timestamp only. Never the connection's status flags.
- Self-healing classes (timeout, upstream, quota) alert only if they persist into rule B.
- One incident per source + runbook entry, listing every affected location. Ten identical Google Ads failures = one incident, one email.
- Muted connections skipped entirely.

## Step 4 — Emails

Plain text, no styling: opened / still-down (6h, then every 24h) / resolved / daily 8:00 AM Eastern all-clear, with the exact subjects and body fields specified, Eastern timestamps, raw error truncated to 500 characters, and a link to `/admin/data-sources`. State tracked on the incident row so each state change emails exactly once. The daily summary is driven by the same 5-minute job, so only one new scheduled entry.

## Step 5 — Mute MoCo GoHighLevel

Muted with reason "Awaiting data, connection built ahead of availability". Still listed in the daily email's muted section.

## Step 6 — Page

An Open Incidents panel on `/admin/data-sources`: each incident, affected locations, the fix text, and mute/unmute with a required reason. Super admin only.

## Step 7 — Test

Force a fake auth-class error on one test row, confirm the opened email and its fix text; clear it and confirm the resolved email; fire the daily summary manually and confirm it; then remove the test data.

## What to expect on the first real run

- GoHighLevel at NoVA: last success 18 August, 192 consecutive failures, no stored error text — opens a real incident under the catch-all entry.
- GoHighLevel at MoCo: muted in Step 5.
- Any Google Ads connection still more than 6 hours behind from this morning's 2-Step Verification block opens a stale-data incident that resolves itself as the backfill lands.

Real alerts on the first run are correct behaviour, not a bug.

## Technical notes

- Error text is read from the connection's `last_error` and the most recent `sync_runs` row for that property and source; matching is a case-insensitive regex against `match_pattern`, with `source = 'any'` entries checked after source-specific ones and the unknown catch-all last.
- Incident identity: open incident with matching `source` + `runbook_id`; affected property list updated in place; resolved when every affected property has a success newer than `opened_at`.
- No `agent_` tables, no jarvis / ai-assistant / Bob code touched, no AI model calls, no changes to the existing sync functions.
