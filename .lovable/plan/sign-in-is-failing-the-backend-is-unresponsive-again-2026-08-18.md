# Sign-in is failing: the backend is unresponsive again

## What is happening

This is not a password problem and not an app-code problem. Your sign-in request reaches the backend and then times out.

Evidence from the last few minutes:

- Sign-in request to `/auth/v1/token` returned **504 upstream request timeout**
- Auth logs: `error finding user: unable to fetch records: context deadline exceeded`, then a 500 `couldn't start a new transaction: context canceled`
- Direct database check right now: `Connection terminated due to connection timeout`
- Backend metrics endpoint: request timed out

So the auth service cannot read the users table because the database is not accepting connections. Every login will hang or 504 until that clears. This is the same failure mode as the earlier "stuck on Loading…" incident.

## Plan

1. Confirm the database is still unreachable (one health query).
2. Restart the hosted backend instance.
3. Poll until the database answers a trivial query and the auth endpoint returns a normal response instead of 504.
4. Verify a real sign-in end to end against the preview with a browser session, and confirm the dashboard renders after login.
5. If it goes down again after the restart, capture what is holding connections (long-running queries / connection count) before restarting a second time, so we fix the cause rather than repeatedly bouncing the service.

## Notes

- No source files change in this plan.
- Your credentials are fine; nothing was locked out.
- Recovery normally takes a couple of minutes, during which requests may briefly return 521/502 while the instance comes back.
