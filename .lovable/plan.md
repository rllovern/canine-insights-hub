# External Report Location Switcher

## Goal
Add a hamburger location switcher to the external `/report/:token` performance report so a signed-in Super Admin can move directly between client-facing report pages.

## Current state
- `/report/:token` resolves one location from its public report token and renders `TokenReport`.
- The public report toolbar currently contains the date-range picker only.
- The internal `/admin/client-reports/:propertyId` viewer already has a left-side hamburger drawer for switching locations.
- The public route is accessible anonymously, so the switcher must not expose other location names or report links to public visitors.

## Implementation
1. Create a reusable external-report location switcher using the existing Sheet drawer pattern.
2. Show the floating hamburger only when:
   - a user is signed in, and
   - the effective role is Super Admin.
3. Hide it for anonymous visitors, Admins, Owners, Location Owners, and Super Admin role previews as another role.
4. Load active locations that have public report tokens, ordered by location name.
5. List locations in the drawer, mark the current location, and navigate in the same tab to `/report/<selected-token>`.
6. Reset/remount the report when the token changes so no metrics, calls, location name, or cached query state carry over from the previous location.
7. Leave the public report content, date controls, CRM/billing behavior, and the existing internal Performance Reports viewer unchanged.

## Verification
- Confirm a signed-in effective Super Admin sees the hamburger on an external report.
- Confirm switching locations loads the selected location's external report.
- Confirm anonymous public report visitors do not see the hamburger.
- Confirm Admin, Owner, and Location Owner effective views do not see the hamburger.
- Run the available build/type checks and a browser smoke test.

## Technical notes
- Files expected: `src/pages/PublicReport.tsx` plus a new focused component under `src/components/reports/` or `src/components/layout/`.
- Existing `properties.public_report_token` data and authenticated property read access are sufficient; no database migration is expected.
