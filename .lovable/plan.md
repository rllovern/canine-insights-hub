# Restore external "Performance Report" tab (Super Admin only)

## Goal
Add a new Super Admin-only nav tab that opens the selected location's **external public report** (`/report/<token>` on the live site) in a new browser tab. The existing internal "Performance Reports" viewer (`/admin/client-reports`) stays exactly as it is for staff. No changes to billing, CRM, or any other feature.

## Changes

### 1. New nav item — `src/components/layout/navItems.ts`
- Add `EXTERNAL_REPORT_ITEM` to the DELIVER group: label "External Report", icon `ExternalLink`, `superAdminOnly: true`, marked external.
- Because the link depends on the currently selected location, give it a special key (e.g. `external-report`) that Sidebar/MobileNav resolve dynamically.

### 2. Dynamic link resolution — `src/components/layout/Sidebar.tsx` + `MobileNav.tsx`
- When rendering the item, look up the currently scoped property's `public_report_token`.
- Build the URL as `https://rsk9insights.com/report/<token>` (fall back to `window.location.origin` in preview) and open it with `target="_blank" rel="noopener"`.
- If no location is selected or it has no public token, hide the item (or disable it with a tooltip).

### 3. Nothing else
- No route changes, no database changes, no changes to the internal viewer, billing, or CRM.
- Visibility enforced client-side via `superAdminOnly` (read-only link, no data mutation).

## Technical notes
- `public_report_token` already exists on `properties` and is already fetched elsewhere; reuse the scope/property data rather than adding queries where possible (a lightweight lookup by scoped property id is acceptable).
- Works in both desktop sidebar and mobile nav, honoring the existing external-link rendering path.

## Verification
- Build passes; as Super Admin, the tab opens the external report for the selected location in a new tab.
- Preview as Owner/Admin: tab is not visible.
