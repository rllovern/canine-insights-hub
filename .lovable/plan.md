# Stop the recurring loading-screen outage

## What is happening now

This is another backend database outage, not a browser, password, or rendering problem.

Confirmed at 23:42–23:48 UTC:

- Auth refresh requests repeatedly timed out with 504s, then failed because auth could not connect to the database.
- A direct database query failed with `Connection terminated due to connection timeout`.
- The database metrics endpoint also timed out.
- PostgreSQL logged repeated statement timeouts, lost client connections, and a scheduled-job startup timeout.
- The app remains on `Loading…` because `AuthContext` waits for the session request to finish before clearing its loading state.

## What changed and why it is recurring

The strongest confirmed trigger is the sync recovery system added on August 16:

- The `resync-failed` watchdog now treats stale freshness watermarks as retry candidates even when the latest sync run says success.
- It runs every two minutes.
- One tick can select 10 integrations, run them sequentially, retry each up to three times, wait 30 and 120 seconds inside the function, and allow up to five minutes per integration.
- A GHL retry can start database-heavy synchronization and lead-fact rebuilding.
- The database log shows the two-minute cron invoking `resync-failed`; one invocation query occupied about 47 seconds, and subsequent cron starts timed out.

This design permits overlapping recovery ticks and creates a feedback loop: a slow sync makes data look stale, the watchdog launches more syncs, database capacity is consumed, auth loses database access, and every signed-in user gets stuck on `Loading…`.

## Fix plan

1. **Recover access immediately**
   - Restart the Lovable Cloud backend.
   - Poll database, auth, and metrics until all three respond normally.
   - Verify the Command dashboard with an authenticated browser session.

2. **Contain the overload before it returns**
   - Disable the current every-two-minute `resync-failed` cron while the backend is recovering.
   - Confirm no overlapping recovery or scheduled-sync executions remain.
   - Inspect current sync runs, freshness rows, connection pressure, and the exact candidates that caused the retry storm.

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

6. **Validate the permanent fix**
   - Trigger one controlled failed integration and confirm only one retry worker runs.
   - Confirm backoff and recovery return the integration to the four-hour cadence after success.
   - Confirm database health remains stable and sign-in/dashboard requests continue to answer during recovery.
   - Check both desktop and mobile loading-error states.

## Technical scope

- Lovable Cloud restart and cron containment.
- Recovery scheduling migration and `resync-failed` refactor.
- Narrow GHL recovery behavior where needed.
- Auth loading timeout/error state in `AuthContext`, `RequireAuth`, and the root redirect.
- No changes to dashboard metrics or source data definitions.