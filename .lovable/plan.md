# CRM sales data has stopped updating — diagnosis and fix

## What is actually happening

Sales are not down. The CRM mirror stopped ingesting deal updates days ago, so every location's recent "Won" count is truncated.

Last won deal recorded per location (today is Aug 16):

| Location | Last won deal stored | Last opportunity update from CRM |
|---|---|---|
| NoVA | Aug 9 | Aug 10 |
| Colorado Springs | Aug 8 | Aug 10 |
| Winchester | Aug 8 | Aug 9 |
| DFW | Aug 11 | Aug 13 |
| Ashtabula | Aug 13 | Aug 14 |
| Central IL | May 24 | Aug 14 |
| MoCo | n/a | CRM disconnected, 97 consecutive failures |

Contacts are still arriving normally (new contacts through Aug 15), which is why nothing looked broken. Only the deals/opportunities feed is stale. The health panel shows "Live" because the syncs report success.

## Root causes (confirmed)

1. **The conversations step eats the entire time budget.** In a normal sync all steps share one ~70s budget and run in order, with conversations before opportunities. On any location with message history, conversations consumes the whole budget, so the opportunities step pulls zero records — and the run still reports success.
2. **The opportunity walk always restarts from the oldest record.** It pages oldest-first with no saved position, so on large accounts it never reaches recent deals before the budget runs out.
3. **The scheduled runner starves later locations.** It processes locations one at a time with a 10-minute total budget; the conversations step for one large account (Winchester) burns all 8 allowed passes, so locations later in the queue get no CRM run at all that cycle.
4. **Failures are invisible.** A run that skipped a step entirely is still logged as "success", clears the last error, and shows green in both the admin API Health page and the sidebar Data Sources panel.

## The fix

**1. Recent-first deal refresh (removes the drop-off)**
Add an incremental pass that pulls the most recently updated deals first and stops once it reaches records older than the last confirmed sync point. This runs before anything else each cycle, so today's wins always land regardless of remaining budget.

**2. Save the backfill position between runs**
Persist the deep-history cursor per location and step, so the long oldest-first walk resumes where it stopped instead of restarting.

**3. Fair budget allocation**
Give each step a reserved slice of the run budget and move deals/appointments ahead of conversations. Conversations become the "leftover time" step, since they are history enrichment, not current results.

**4. Round-robin the scheduler**
Cap per-location time inside a scheduled cycle so every location gets its recent-first deal refresh before any location gets deep backfill time.

**5. Honest health reporting**
Track a per-step last-success timestamp. A run that skipped or truncated a step is reported as **Partial**, not healthy, in the admin API Health page and the sidebar panel, with the specific step and its age shown.

**6. One-time recovery**
Run a targeted recent-deal refresh for NoVA, Colorado Springs, Winchester, DFW and Ashtabula to recover Aug 8–16 wins, then rebuild lead facts and report corrected monthly totals.

MoCo stays as-is: its CRM connection is genuinely disconnected and correctly shows "No CRM connected".

**7. Staleness watchdog — so this can never go unnoticed again**
A watchdog runs every 2 minutes and judges on data freshness, not just on whether a run reported success, so a step that silently stops writing still gets caught.

- **Freshness limit per source and step.** Each pair gets a maximum allowed age: CRM deals and contacts 3 hours, calls and ad spend 6 hours, rankings 24 hours. If the last confirmed write for that pair is older than its limit, the watchdog triggers a refresh for that pair alone.
- **Escalating retry until it succeeds.** A failing or still-stale pair retries every 2 minutes for the first 30 minutes, then every 10 minutes, then hourly, and keeps going indefinitely until a run writes fresh data. On success it resets and returns to the normal 4-hour cadence.
- **Only the broken pair.** Retries are keyed on (location, source, step). Healthy pairs are never re-run, so one stuck location cannot slow down or rate-limit everything else.
- **Hard failures pause instead of looping.** Authentication or configuration errors (like MoCo's disconnected CRM) stop the retry loop and surface as "Action needed" rather than retrying forever against dead credentials.
- **Visibility.** Any pair past 2x its freshness limit shows as Stale/Partial in the admin API Health page and the sidebar Data Sources panel, naming the step and its age.

## Technical notes

- `supabase/functions/sync-ghl/index.ts`: new `opportunities_recent` incremental mode (updated-desc walk with a watermark), per-phase budget reservation, phase reorder, cursor persistence.
- New table for sync watermarks/cursors: `(property_id, source, phase, last_success_at, cursor_json)` with GRANTs and service-role-only policies.
- `supabase/functions/scheduled-sync-all/index.ts`: two-tier cycle (fast pass across all locations, then backfill with remaining time).
- `get_api_health_summary` extended with per-phase freshness; `ApiHealth.tsx` and `SourceHealthPanel.tsx` gain a "Partial" state.
- Watchdog state lives on the same watermark table (`next_attempt_at`, `consecutive_failures`, `paused_reason`); `resync-failed` is extended into the freshness-driven watchdog and its cron moves to every 2 minutes.

## Verification

After the recovery run: compare stored won counts for Aug 8–16 against the CRM's reported totals per location, and confirm each location's deal step shows a success timestamp within the last cycle.

Watchdog check: artificially age one pair's freshness marker and confirm it self-heals within one cycle without touching any other location or source.
