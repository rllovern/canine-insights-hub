# Internal Client Reports Browser

An internal-only page that lets you flip through every active client's report — visually identical to what the client sees at `/report/:token`, but gated to internal users and never exposed to viewers or the public.

## What you get

- New sidebar entry under **Admin → Client Reports** (only renders for internal users, just like the existing Clients/Users/Settings items).
- A new route `/admin/client-reports` protected by `RequireAuth requireRealRole="internal"`.
- A top toolbar with:
  - **Prev / Next arrows** to cycle through active properties (alphabetical by name).
  - **Property dropdown** to jump directly to any client.
  - The same **date range + compare** controls used in the public report.
  - A small "Internal preview" badge so it's obvious this is not what the client sees.
- The report body is the **exact same** `PublicShell + Dashboard + CallTracking` stack used by `/report/:token` — pixel-identical layout, header, branding, and footer.
- Scope: **all active properties** (`is_active = true`), regardless of whether a public report token has been generated.
- Selected property persists in `localStorage` so reopening the tab returns to the last one viewed.

## Why it's safe (not visible to clients)

- The route lives under `/admin/*` and uses `requireRealRole="internal"` — viewers and unauthenticated users are redirected to `/dashboard` / `/login`.
- The sidebar link is only rendered when `effectiveRole === "internal"`.
- Data is fetched using the normal authenticated Supabase client (internal users already have full read access via the existing `Internal full access` RLS policies on `daily_metrics`, `ctm_calls`, `properties`, etc.). **No public RPCs and no report tokens are used**, so nothing about this page can leak through a client-shared link.

## Technical details

New files:
- `src/pages/admin/AdminClientReports.tsx` — page component. Loads all active properties, manages a `currentIndex`, renders the toolbar (Prev / Select / Next + `PublicReportToolbar` controls) and the report body.
- `src/components/layout/ClientReportPreview.tsx` (small wrapper) — given a `Property`, mounts `DashboardProvider` (using the standard internal fetcher already used by `Dashboard`) and renders `PublicShell` + `Dashboard` + `CallTracking`, mirroring `PublicReport.tsx`.

Edited files:
- `src/App.tsx` — register the new route under the existing internal-guarded admin block:
  ```text
  <Route path="/admin/client-reports"
         element={<RequireAuth requireRealRole="internal"><AdminClientReports /></RequireAuth>} />
  ```
- `src/components/layout/Sidebar.tsx` — add a `FileSearch` (or similar) nav item labelled "Client Reports" inside the existing `effectiveRole === "internal"` Admin block.

Data fetching:
- Properties list: `supabase.from("properties").select("*").eq("is_active", true).order("name")`.
- Metrics + calls: reuse the default authenticated fetchers already wired into `DashboardContext` / `CallTracking` — no new edge functions, no schema changes, no RLS changes.

UX notes:
- Prev/Next wrap around (last → first).
- Keyboard shortcuts: `←` / `→` cycle properties while the page is focused.
- A subtle banner above the report reads: "Internal preview — clients do not see this page."

Out of scope (intentionally):
- No changes to the public `/report/:token` flow.
- No changes to viewer permissions or RLS.
- No new backend functions or migrations.