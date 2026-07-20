## Goal
After any sync failure, retry that (property, source) pair every 2 minutes until it succeeds. Once it succeeds, revert to the normal 4-hour cadence.

## Changes

### 1. `resync-failed` edge function
- Remove the `5m–6h` age window and the `MAX_RESYNC_CYCLES_PER_6H = 3` cap. A pair stays a candidate as long as its most recent run is a `failure` (or a stuck `running` older than 5 minutes) with no successful run since.
- Keep the "silently skipped" branch (last success older than 5h) and the `status IN ('connected','error')` filter added last turn.
- Keep the 3-attempt in-function retry, so each 2-minute tick still gets ~2.5 minutes of retries before the next tick.

### 2. Cron schedule
- Reschedule the `resync-failed` pg_cron job from every 15 minutes to every 2 minutes.
- Leave `scheduled-sync-all` at every 4 hours (the healthy-state cadence).

### 3. Safety rails so 2-minute retries don't stampede
- Skip a candidate if a run for the same pair is already `running` and started less than 5 minutes ago (prevents overlapping invocations).
- Cap total candidates processed per tick (e.g. 10) so one tick can't blow past the platform wall-time when many pairs fail at once; remaining pairs get picked up on the next 2-minute tick.
- Keep `trigger_source='resync_failed'` on every inserted row so the health panel and audits can distinguish auto-retries from scheduled runs.

## Technical details
- File edits: `supabase/functions/resync-failed/index.ts` only. Deploy after edit.
- Cron: update via `supabase--insert` on `cron.schedule` (project-specific URL + anon key), unscheduling the existing 15-minute job first.
- No schema changes.
- No UI changes — the existing "Retrying" pill in `SourceHealthPanel` already reflects a failing pair inside its recovery window.

## Out of scope
- Changing the 4-hour healthy cadence.
- Changing per-invocation retry counts inside individual sync functions.
- Any change to how `property_data_sources.status` is set (already fixed last turn).
