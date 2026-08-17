# Why the app is stuck on "Loading…"

## What I confirmed

- The preview app itself loads fine (dev server returns 200, React mounts, router renders).
- The screen stops at "Loading…" because the auth gate waits on three backend calls that never come back:
  - user role lookup
  - user security / password-change flag
  - properties list
- In a live browser run those requests were issued and then hung with no response at all for 12+ seconds.
- Direct calls from the sandbox to the project's backend API hostname time out after 15–20s (no status code returned), while general internet access from the same machine works fine (google.com returns 200).
- The internal metrics endpoint for the database also timed out.
- The high-level Cloud status check reports the backend as up.

## Diagnosis

This is not an application-code bug and not something a code change can fix. The app is behaving correctly: it shows the loading state while waiting for auth and role data. The project's hosted backend API endpoint is not answering requests right now, so the loading state never resolves.

## Proposed steps (in order)

1. Re-check backend reachability a couple of times over a short interval to confirm it is a sustained outage rather than a brief blip.
2. If it is still unreachable, request your approval to restart the hosted backend, then re-check status until it reports healthy.
3. Re-run the authenticated browser check against /command and confirm the role, security and properties requests return and the dashboard renders.

## Optional resilience follow-up (only if you want it)

Right now any backend stall produces an indefinite full-screen "Loading…" with no explanation. If you'd like, after the outage is resolved I can add a timeout to the auth gate so that after ~10 seconds it shows a clear "Can't reach the backend — retry" screen instead of an infinite spinner. This is a separate, optional change.

## Technical notes

- Gate: `src/components/RequireAuth.tsx` blocks on `loading`, `securityLoading`, and `roleLoading` from `src/contexts/AuthContext.tsx`.
- Hanging requests observed: `user_roles`, `user_security`, `properties`.
- No JavaScript errors block rendering; the only console noise is a pre-existing React `forwardRef` warning, unrelated to this.
