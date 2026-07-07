Tighten role visibility so Admin, Owner, and Location Owner see only what they're allowed to.

## Changes

### 1. Admin no longer sees mutation-only admin pages
The rule is "Admin cannot add/refresh APIs or mutate." Every current admin page except Clients and Users exists purely to configure or trigger changes, so gate them to Super Admin only:

| Sidebar / Route | Now |
|---|---|
| Clients (`/admin/properties`) | Super Admin + Admin (read) |
| Users (`/admin/users`) | Super Admin only (unchanged) |
| Pipeline Mapping | Super Admin only |
| SLA Settings | Super Admin only |
| Data Sources | Super Admin only |
| Settings | Super Admin only |
| Performance Reports | Super Admin + Admin (unchanged) |

Sidebar hides items the user can't access; routes are guarded so a typed URL 404s / redirects.

### 2. Owner nav restricted to Command + Budget Pacing
Owner keeps all-properties visibility (still sees every location's spend and metrics) but the sidebar drops Monitor, Deliver, Jarvis, and Admin groups. Nav becomes:
- Command
- Budget Pacing

Route guard: `/dashboard`, `/calls`, `/lead-performance`, `/reports`, `/assistant`, `/keywords`, `/admin/*` all redirect to `/command` for Owner.

### 3. Location Owner single-location assignment
`viewer_property_access` is already the assignment table. Change the semantics for `location_owner` users:
- **Admin > Users**: replace the checkbox grid with a single-choice dropdown labeled "Assigned location" for every Location Owner row. Picking a property replaces the current assignment (delete existing rows for that user, insert the new one).
- **DB guard**: add a partial unique index / trigger enforcing at most one `viewer_property_access` row per `location_owner` user, and require exactly one for them.
- **Scoping**: `PropertyContext` already scopes to their assigned property list; because that list is now length 1, they see only that one location on Command and Budget Pacing. Confirm the Command page and Budget Pacing page filter their queries by `currentProperty.id` (they do — same code path as Super Admin previewing as Bob).

### 4. Super Admin preview dropdown unchanged
The Viewing-as dropdown continues to flip `effectiveRole`. All the gates above key off `effectiveRole`, so previewing as Admin/Owner/Location Owner produces the exact experience each role gets in production.

## Technical

**`src/components/layout/Sidebar.tsx`**
- Introduce `showBudgetOnlyNav = effectiveRole === "owner" || isLocationOwner`. When true, render only Command + Budget Pacing (skip Monitor/Deliver/Jarvis/Admin groups).
- Add `superAdminOnly?: boolean` to `NavItem`. Mark Pipeline Mapping, SLA Settings, Data Sources, Settings as `superAdminOnly`. Update `filterVisible` to drop `superAdminOnly` items unless `isSuperAdmin` (from `effectiveRole`).

**`src/App.tsx`**
- Add `requireSuperAdmin` guards to `/admin/pipeline-mapping`, `/admin/sla-settings`, `/admin/data-sources`, `/admin/settings`.
- Wrap `/dashboard`, `/calls`, `/keywords`, `/lead-performance`, `/reports`, `/assistant` in a new `BlockForOwner` (or extend `ViewerBlock`) that redirects `owner` / `location_owner` to `/command`. Location Owner is already redirected; add Owner to the same guard.

**`src/components/RequireAuth.tsx`**
- Confirm `requireSuperAdmin` uses `effectiveRole` so preview works.

**`src/pages/admin/AdminUsers.tsx`**
- Location Owner section: swap the checkbox grid for a `Select` bound to a single property. On change, delete all `viewer_property_access` rows for that user, then insert the chosen one.
- Show "Not assigned" state with a warning badge when a Location Owner has no property yet.

**Migration**
- Add `CREATE UNIQUE INDEX viewer_property_access_one_per_location_owner ON viewer_property_access(user_id) WHERE user_id IN (SELECT user_id FROM user_roles WHERE role = 'location_owner')` — Postgres doesn't allow subqueries in partial indexes, so instead use a `BEFORE INSERT/UPDATE` trigger that raises when the inserting user's role is `location_owner` and another row for them already exists.
- Backfill: if any Location Owner currently has >1 access row, keep the earliest and delete the rest (logged for the Super Admin to review).

No changes to RLS beyond the trigger — existing policies already scope reads by `viewer_property_access`, so restricting the list to one row automatically restricts what a Location Owner sees.
