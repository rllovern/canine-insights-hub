# Fix Client Reports Opening to Dashboard

Clicking **Client Reports** should open the standalone internal report browser, not redirect to `/dashboard`.

## What will change

- Keep the existing **Client Reports** sidebar link opening in a new tab.
- Fix the route guard so `/admin/client-reports` waits for the user’s real role to finish loading before deciding whether to allow access.
- Prevent the current false redirect where the new tab briefly sees the role as empty/null and sends the user to `/dashboard`.
- Keep the current standalone report page experience:
  - collapsible client/property sidebar
  - property list only
  - selected property opens the same token-style report the client sees
  - back arrow returns to the internal dashboard

## Result

```text
Click Client Reports
        ↓
New tab opens /admin/client-reports
        ↓
Auth + role finish loading
        ↓
Internal users stay on the client report browser
        ↓
Non-internal users are still blocked safely
```

## Technical details

Edits:
- `src/contexts/AuthContext.tsx` — track role-loading state separately or keep auth loading active until the authenticated user’s role has resolved.
- `src/components/RequireAuth.tsx` — when `requireRealRole` is set, show the loading state until the real role is known instead of redirecting while it is still `null`.

No database changes. No sidebar redesign. No report layout changes.
