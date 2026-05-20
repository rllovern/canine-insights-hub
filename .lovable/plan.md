# Open Client Reports in a Standalone Window

Move the internal Client Reports view out of the app shell so it opens in its own browser tab — same standalone chrome as the public `/report/:token` view — with a built-in property switcher at the top.

## What changes

- The **Admin → Client Reports** sidebar item becomes a link that opens `/admin/client-reports` in a **new tab** (`target="_blank"`).
- `/admin/client-reports` is moved **out of `AppShell`** and rendered standalone (no Sidebar, no TopBar) — matching how `/report/:token` works today.
- The page is still gated by `RequireAuth requireRealRole="internal"`. Anyone without an internal role lands on `/dashboard` or `/login`.
- At the very top of the standalone window: a compact bar with
  - **Property selector** (dropdown listing every active property, with the current one selected).
  - **Prev / Next arrows** for quick cycling.
  - The existing date range + compare controls.
  - A small "Internal preview" label so it's obvious this isn't the client's view.
- Below the bar: the exact `PublicShell + Dashboard + CallTracking` stack the client sees, with the inner subtree forced into viewer mode so it's pixel-identical to `/report/:token`.
- Selected property persists in `localStorage` so reopening the window returns to the last one viewed.
- Keyboard `←` / `→` continues to cycle.

## Why this matches the public-report behavior

The public report at `/report/:token` is registered outside `AppShell` in `App.tsx`, which is why it renders without the dashboard sidebar/topbar. The internal version will be registered the same way so it gets the same full-window look when opened in a new tab.

## Technical details

Edits:
- `src/App.tsx` — move the `/admin/client-reports` route out of the `<RequireAuth><AppShell /></RequireAuth>` block and register it as a top-level standalone route (still wrapped in `RequireAuth requireRealRole="internal"`), next to `/report/:token`.
- `src/components/layout/Sidebar.tsx` — change the "Client Reports" nav entry from a `NavLink` to a plain `<a href="/admin/client-reports" target="_blank" rel="noopener">` so it opens in a new window.
- `src/pages/admin/AdminClientReports.tsx` — minor layout tweaks so the page works as full-window content (remove the rounded inner border that made sense inside the app shell; let `PublicShell` fill the viewport).

No backend changes. No RLS changes. No new dependencies.