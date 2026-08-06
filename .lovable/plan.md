# Backfill DFW sales history

## Goal
DFW currently only has CRM data from Jul 6, 2026 onward (128 contacts, 35 won deals). Sale Records, the cadence heatmap, and the revenue runway therefore look empty before that date. Pull the older history in from the DFW CRM location so those views cover the full account history.

## What's already in place
The CRM sync function already accepts an explicit `date_from` / `date_to` window; it just defaults to the last 30 days, which is why only recent data exists. No schema changes are needed — the backfill is a matter of running that sync over older windows.

## Approach

1. Add a backfill mode to the CRM sync so a long historical range can be requested safely:
   - Accept an optional date window plus a `backfill` flag that skips the "recent activity" shortcuts used by the incremental path.
   - Process the range in monthly chunks so each invocation stays inside the function time limit, returning a cursor for the next chunk.
   - Never mark the property as errored during backfill; incremental syncs must keep running normally alongside it.

2. Add an admin-triggered backfill control (Admin → Data Sources) that:
   - lets an internal user pick a property and a start date,
   - kicks off the chunked run and shows progress (chunks done, contacts / opportunities imported),
   - is safe to re-run — all writes stay upsert-by-external-id so re-importing a month does not duplicate.

3. After the DFW backfill completes, rebuild derived data for the property (lead facts + verified-sales rollups) so the cadence heatmap, revenue runway, and Sale Records table all reflect the older wins.

4. Verify by comparing imported won-deal counts and earliest created date against the CRM for DFW, and spot-checking a pre-July month in Sale Records.

## Notes
- Backfill depth is limited by what the CRM's search API returns; if it caps out, the plan reports the earliest date actually reachable rather than silently stopping.
- The same control works for the other locations later, but only DFW will be run now.
