# Make Admin Client Reports Match the Token Report

The internal Client Reports tab should open a standalone browser tab that is the same report experience as `/report/:token`. The only internal-only difference is a client navigation control in the report header.

## What will change

- Keep **Admin → Client Reports** opening in a new tab.
- Keep `/admin/client-reports` outside the dashboard shell, with no sidebar or app top bar.
- Refactor the public token report into a shared report body used by both:
  - `/report/:token`
  - `/admin/client-reports`
- Make the internal page fetch report data through the same token-based report path as the public report:
  - selected property must have a `public_report_token`
  - metrics use `get_daily_metrics_by_report_token`
  - the report renders with viewer permissions, just like the client link
- Remove the separate internal preview banner/bar that makes the page feel different from the public report.
- Add the internal-only client switcher inside the existing public report header toolbar area:
  - property dropdown
  - previous / next arrows
  - optional compact/hamburger-style menu on narrow screens if needed
- Preserve the existing public report date range and compare controls exactly.
- Persist the last selected client in `localStorage`.
- Keep keyboard left/right navigation for cycling clients.

## Result

```text
Admin sidebar link opens new tab
        ↓
/admin/client-reports
        ↓
Same header, layout, dashboard sections, data fetching, and viewer-only visibility as /report/:token
        ↓
Only extra UI: internal client navigation in the top toolbar
```

## Technical details

Edits:
- `src/pages/PublicReport.tsx` — extract/reuse the token-report rendering logic so the public and internal versions cannot drift apart.
- `src/pages/admin/AdminClientReports.tsx` — make it a thin internal wrapper that selects an active client token and renders the shared token report with an added navigation toolbar.
- `src/components/layout/PublicReportToolbar.tsx` — allow an optional leading/trailing internal control slot while keeping the public toolbar unchanged for clients.
- `src/App.tsx` and `src/components/layout/Sidebar.tsx` — keep the route standalone and the sidebar link opening in a new tab.

No backend changes. No RLS changes. No new dependencies.