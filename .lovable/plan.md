# Role & Visibility Model

Today the app has only two DB roles (`internal`, `viewer`) plus an email-allowlist hack that lets you toggle "View as Bob." We'll replace that with four real roles enforced in both the database (RLS) and the UI.

## The four roles

| Role | Who | Sees | Can change |
|---|---|---|---|
| **Super Admin** | You (`rl.lovern@gmail.com`) | Everything, every property. Keeps the "View as Location Owner" toggle (renamed from "View as Bob"). | Everything: sync APIs, connect/disconnect data sources, sync/edit budgets, edit pipeline mappings, manage users & roles, seed data, edit property settings. |
| **Admin** | Internal associates | Everything Super Admin sees across every property — Command, Call Tracking, Lead Performance, Budget Pacing, Reports, and all Admin pages (read-only). No "View as" toggle. | Nothing that hits an external API or is normally automated. No sync buttons, no add/remove APIs, no budget sync, no connection edits. |
| **Owner** | Business partner / agency owner | All locations, all metrics including cost/spend, across Command, Call Tracking, Lead Performance, Budget Pacing, Reports. Same visibility Bob has today, but scoped to *all* properties (Bob is currently a single-property viewer stand-in). | Nothing. Pure read. No admin pages. |
| **Location Owner** (client label) | The client contact at each K9 location | Only their one assigned property, only on **Command** and **Budget Pacing** (matches what you called out; we can add more pages later). Cost visibility follows the per-property toggle you already have. | Nothing. |

Mutations that were "anyone internal" today (sync APIs, refresh connections, sync budgets, edit budget rows, edit pipeline mappings, seed Bob, etc.) become **Super Admin only** everywhere they appear.

## Database changes

- Extend the `app_role` enum with `super_admin`, `admin`, `owner`, `location_owner`. Keep `internal` and `viewer` temporarily so nothing breaks during migration.
- Migrate existing rows in `user_roles`:
  - `rl.lovern@gmail.com` → `super_admin`
  - Every other `internal` → `admin`
  - Every current `viewer` → `location_owner` (they already have `viewer_property_access` rows scoping them to a single property; that carries over unchanged)
  - Bob's user (`76ee5d03-…`) → `owner`, and give Bob `viewer_property_access` rows for every active property so the impersonation view mirrors what a real Owner sees
- Add SECURITY DEFINER helpers used everywhere:
  - `is_super_admin(uid)` — `has_role(uid,'super_admin')`
  - `is_staff(uid)` — super_admin OR admin
  - `is_all_properties_reader(uid)` — super_admin OR admin OR owner
  - `can_access_property(uid, pid)` — true for the above three, or a `viewer_property_access` match for location_owner
- Rewrite every RLS `SELECT` policy currently using `has_role(uid,'internal') OR viewer_property_access(...)` to use `can_access_property`. Rewrite every `INSERT/UPDATE/DELETE` policy currently gated on `internal` to gate on `is_super_admin` instead — this is the enforcement point that stops Admin/Owner/Location Owner from mutating.
- Update the two functions that already inline `has_role(_uid,'internal')` (`lead_perf_check_access`, `get_api_health_summary`) to accept the wider read set (`is_all_properties_reader` for agency-wide calls; `can_access_property` for scoped ones).
- Once code is switched over, drop `internal` and `viewer` from the enum.

## Frontend changes

- Replace `OWNER_EMAILS` allowlist and `BOB_USER_ID` in `src/lib/owners.ts` with role checks:
  - `isSuperAdmin` from `realRole === 'super_admin'`
  - The "View as Bob" toggle is only rendered for Super Admin and becomes "View as Location Owner." When on, `effectiveRole = 'location_owner'` and scope is pinned to a demo property.
- Update `src/lib/scoping.ts`:
  - `canSeeCost`: true for super_admin, admin, owner; for location_owner uses the existing per-property `viewer_can_see_cost` flag.
  - `canSeeSpam` / `canSeeBadLead`: super_admin, admin, owner. Hidden for location_owner (unless a per-property toggle later lifts it).
- Gate every mutation UI to Super Admin only. This covers the sync buttons in `ApiHealth`, all "Sync now / Test / Save / Disconnect" actions in `GHLConnectionDialog`, `CTMConnectionDialog`, `MCCImportDialog`, `CTMImportDialog`; the row-edit and "sync budgets" actions in `BudgetPacing`; the pipeline-mapping edits in `AdminPipelineMapping`; property/user/settings/report edits in the `pages/admin/*` tree; the "seed Bob" and manual sync buttons.
- `ScopeContext`: for `location_owner`, force `mode = 'property'` and pin `activeProperty` to their single `viewer_property_access` row. Hide the property switcher and the agency toggle for that role.
- Sidebar (`src/components/layout/Sidebar.tsx`): visible nav per role
  - Super Admin & Admin: full nav (Command, Call Tracking, Lead Performance, Keywords, Budget Pacing, Reports, Admin section)
  - Owner: same minus Admin section
  - Location Owner: Command and Budget Pacing only
- Route guards in `App.tsx` / `RequireAuth`: block Location Owner from any route outside `/command` and `/budget-pacing`. Block Owner from `/admin/*`. Block Admin from mutation-only admin sub-pages if any exist.

## Migration & rollout order

1. DB migration: add new enum values, add helper functions, rewrite policies, remap `user_roles` rows.
2. Frontend switch to new role names (dual-read `internal`/`super_admin` briefly so no one gets locked out mid-deploy).
3. Verify each role by using your "View as" toggle across a few pages.
4. Cleanup migration: drop `internal` and `viewer` from the enum, delete dual-read code.

## Open items to confirm before build

- Location Owner pages: you said Command + Budget Pacing for now. Confirm we hide Call Tracking, Lead Performance, and Reports from them (we can add them later per-property).
- Admin viewing Admin pages: I have them read-only (they can navigate `AdminProperties`, `AdminUsers`, `AdminSettings`, etc., but every save/sync button is disabled). Say the word if Admin shouldn't see those pages at all.
- Owner and Admin seeing Location Owner's per-property "hide cost" flag: I assume they override it (they always see cost). Confirm.
