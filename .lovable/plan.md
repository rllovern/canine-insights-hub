## Goal

Add a compact "Data Sources" block to the bottom of the left sidebar (above the account row) showing each data source and whether it's healthy, scoped to the currently selected property/scope.

## Layout

Inserted in `src/components/layout/Sidebar.tsx` directly above the existing account card:

```text
DATA SOURCES
● Google Ads              Live
● CallTrackingMetrics     Live
● GoHighLevel             Live
● CTM / GHL match     Blocked
```

- Section label `DATA SOURCES` reuses the same uppercase muted style as the `Monitor` / `Deliver` group labels.
- Each row: small status dot + source label on the left, status word on the right, single line, truncates.
- Four rows, in this order: Google Ads, CallTrackingMetrics, GoHighLevel, CTM / GHL match.

## Status logic

Reuses the existing `get_api_health_summary` RPC already powering `src/pages/admin/ApiHealth.tsx` (so no new backend work).

New component `src/components/layout/SourceHealthPanel.tsx`:

- Fetches `get_api_health_summary` on mount and every 60s.
- Filters rows by the current scope from `PropertyContext` / `ScopeContext`:
  - Single property selected → only that property's rows.
  - "All properties" / portfolio scope → aggregate across all visible properties.
- For each of the three sync sources (`google_ads`, `ctm`, `ghl`) reduces rows to a single status using the same precedence already in `ApiHealth.tsx` (`failing > stale > never_run > healthy > not_connected`).
- "CTM / GHL match" is a derived row: `Live` when both `ctm` and `ghl` aggregate to `healthy`, otherwise `Blocked` (with tooltip naming which side is the problem). This matches the screenshot's fourth row, which is a reconciliation indicator, not a raw source.

Status → label/color mapping (Tailwind tokens, no hardcoded colors):

| Status        | Label    | Dot / text color   |
| ------------- | -------- | ------------------ |
| healthy       | Live     | `text-success`     |
| stale         | Stale    | `text-amber-600`   |
| failing       | Blocked  | `text-destructive` |
| never_run     | Off      | `text-muted-foreground` |
| not_connected | Off      | `text-muted-foreground` |

Each row has a `title` tooltip with the most recent `last_success_at` / `last_error_message` so hover gives context without expanding the sidebar.

## Files

- **edit** `src/components/layout/Sidebar.tsx` — render `<SourceHealthPanel />` inside the existing footer `div`, above the account card; add a thin `border-sidebar-border/60` divider above it.
- **add** `src/components/layout/SourceHealthPanel.tsx` — the component described above.

No backend, no schema, no route changes. Internal-only data is already gated by RLS on the RPC; viewers will simply see an empty panel if they have no access (the panel hides itself when the fetch returns zero rows).

## Out of scope

- No click-through to `/admin/api-health` (can be added later if wanted).
- No changes to the existing `ApiHealth` admin page.
- No changes to how sync runs or how health is computed server-side.
