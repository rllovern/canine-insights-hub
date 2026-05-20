# Fix Client Reports Route + Add Drawer Shell

## Step 1 — Fix the redirect bug

Right now `/admin/client-reports` opens, auth finishes loading while the user's role is still `null`, and `RequireAuth` redirects to `/dashboard` before the role resolves.

- `src/contexts/AuthContext.tsx` — add a separate `roleLoading` flag. It starts `true` whenever there is a user and flips to `false` only after `user_roles` returns. While there is no user, `roleLoading` is `false`.
- `src/components/RequireAuth.tsx` — when `requireRealRole` is set, keep showing the loading state while `roleLoading` is true. Only redirect after the real role is known.

No other auth behavior changes.

## Step 2 — Build the navigation shell around the existing token report

The main report area renders the **existing** `TokenReport` component unchanged — same component, same data path (`get_daily_metrics_by_report_token`), same look the client sees at `/report/:token`. The client-facing report files are not edited.

New shell on top of it at `/admin/client-reports`:

- Top bar (overlaid above the report):
  - Hamburger button (left) — opens a left-side drawer
  - Back arrow (next to hamburger) — navigates to `/dashboard`
- Drawer (closed by default):
  - Lists all properties from `properties` where `is_active = true` and `public_report_token IS NOT NULL`, ordered by name
  - Clicking a property loads that property's token report in the main area and closes the drawer
- Default selection: first property in the list (or last selected, persisted in `localStorage`)
- Selected property is reflected in the URL: `/admin/client-reports/:propertyId`

```text
+-----------------------------------------------+
| [hamburger] [back to dashboard]               |
+-----------------------------------------------+
|                                               |
|         TokenReport (unchanged)               |
|                                               |
+-----------------------------------------------+

[hamburger click] ->
+----------------+
| Clients        |
|  Ridgeside …   |
|  Other client  |
+----------------+
```

## Technical details

Source of truth: `public.properties` (column `public_report_token`). Same query already in `AdminClientReports.tsx`.

Edits:
- `src/contexts/AuthContext.tsx` — add `roleLoading` to context value.
- `src/components/RequireAuth.tsx` — gate role-required redirects on `!roleLoading`.
- `src/pages/admin/AdminClientReports.tsx` — replace current shadcn `Sidebar` shell with: a small top bar (hamburger + back-arrow buttons) and a shadcn `Sheet` (left side) acting as the drawer with the property list. Keep the existing `TokenReport` render block (and the `PreviewModeContext` viewer override) exactly as it is. Keep the `/admin/client-reports/:propertyId` route + `localStorage` persistence.

No database changes. No edits to `TokenReport.tsx`, `PublicShell.tsx`, `PublicReportToolbar.tsx`, `Dashboard.tsx`, `CallTracking.tsx`, or any client-facing report code.
