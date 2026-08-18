# Stop the recurring loading-screen outage

## Short answer: yes, the 100% storage warning is almost certainly the cause

A database disk at 100% is not a side effect of this outage — it is the classic cause of exactly this failure pattern. When the data disk fills, PostgreSQL can no longer write, in-flight statements stall, connections are never released, and every new connection attempt times out. Auth is just another database client, so sign-in and session refresh start returning 504s and the app hangs on `Loading…`.

That also explains why this keeps coming back after each restart: a restart frees temporary space and buys some hours, but the disk fills again and the same wall is hit.

## What is confirmed right now

- Direct database queries fail with `Connection terminated due to connection timeout`.
- The database metrics endpoint times out, so detailed health cannot be read.
- The high-level Cloud status check still reports the backend as up, which is consistent with a saturated database rather than a downed service.
- Auth requests time out with 504s and log failures to reach the users table.
- PostgreSQL logged statement timeouts, lost client connections, and a scheduled-job startup timeout.
- The app shows `Loading…` because the auth gate waits on the session, role, and security requests that never return.

## Why the disk filled

Two contributors, both worth fixing:

1. **Storage growth.** The GHL mirror keeps raw contact, opportunity, and message payloads plus lead-fact and sync-log history. Backfills of thousands of opportunities per location, repeated lead-fact rebuilds, and write-ahead log growth all consume disk quickly.
2. **The two-minute recovery job amplifies it.** The `resync-failed` watchdog treats stale freshness watermarks as retry candidates, runs every two minutes, can take up to 10 integrations per tick, retries each up to three times with in-function waits, and can trigger heavy GHL sync and lead-fact rebuild work. When the database is already struggling, this keeps generating more writes and log volume, which makes a full disk fill faster and stay full.

## Fix plan

0. **Get the disk out of the red first**
   - Increase the Lovable Cloud database disk size so the backend can write again.
   - Confirm the database accepts connections and metrics respond before doing anything else.
   - Note for later: disk size and instance compute are separate controls; this step is about disk, not CPU/memory.
   - Once reachable, measure actual usage: largest tables and indexes, sync/log table sizes, raw payload columns, and write-ahead log size, so we know what is really consuming space.

## Fix plan

1. **Recover access**
   - Restart the backend only if it is still unresponsive after the disk has headroom.
   - Poll database, auth, and metrics until all three respond normally.
   - Verify the Command dashboard with an authenticated browser session.

2. **Contain the write amplification before it returns**
   - Disable the current every-two-minute `resync-failed` cron while the backend is recovering.
   - Confirm no overlapping recovery or scheduled-sync executions remain.
   - Inspect current sync runs, freshness rows, connection pressure, and the exact candidates that caused the retry storm.

2b. **Reclaim and cap storage growth**
   - Add retention to high-churn history: sync run logs, Bob conversation logs, raw webhook/payload records, and superseded lead-fact rows.
   - Stop storing full raw API payloads where only mapped fields are used, or truncate them.
   - Reclaim space on the biggest offenders after cleanup and confirm disk usage drops.
   - Keep a recurring cleanup job so the disk cannot silently refill.

3. **Replace the recovery job with bounded, non-overlapping work**
   - Add a database-backed lease so only one recovery invocation can run at a time.
   - Process at most one integration per tick rather than up to ten sequentially.
   - Remove in-function 30/120-second sleeps; persist `next_attempt_at` and let a later cron tick perform the next attempt.
   - Give each child sync a strict short timeout and release the lease in all success/failure paths.
   - Keep hard failures paused and apply capped backoff to transient failures.
   - Prevent the recovery path from launching broad GHL backfills or repeated full lead-fact rebuilds; recovery should run only the stale incremental phase.

4. **Restore safe scheduling**
   - Re-enable the watchdog only after its bounded behavior is deployed and tested.
   - Keep the normal four-hour full-sync cadence.
   - Use a slower watchdog cadence if the database is under pressure, while preserving automatic recovery.

5. **Make the app fail clearly instead of spinning forever**
   - Put a timeout around initial session/auth-dependent loading.
   - Replace the indefinite `Loading…` state with a clear backend-unavailable screen and Retry action.
   - Do not log users out or discard their session during a temporary backend outage.

6. **Add an early warning**
   - Surface database disk usage on the internal admin health surface.
   - Warn well before saturation rather than discovering it as a full outage.

7. **Validate the permanent fix**
   - Trigger one controlled failed integration and confirm only one retry worker runs.
   - Confirm backoff and recovery return the integration to the four-hour cadence after success.
   - Confirm disk usage stays flat over a full sync cycle instead of climbing.
   - Confirm sign-in and dashboard requests keep answering during recovery work.
   - Check both desktop and mobile loading-error states.

## Technical scope

- Lovable Cloud database disk increase, plus restart and cron containment.
- Storage retention/cleanup migrations and a recurring cleanup job.
- Recovery scheduling migration and `resync-failed` refactor.
- Narrow GHL recovery behavior where needed.
- Auth loading timeout/error state in `AuthContext`, `RequireAuth`, and the root redirect.
- No changes to dashboard metrics or source data definitions.