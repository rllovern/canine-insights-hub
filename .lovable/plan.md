Replace the current "View as Location Owner" toggle in the TopBar with a role-preview dropdown, visible only to Super Admin.

## Behavior

Dropdown labeled "Viewing as" with four options:
- Super Admin (default — real role, no impersonation)
- Admin
- Owner
- Location Owner

Selecting an option sets the effective role in `PreviewModeContext`. All existing role-gated UI (sidebar nav, route guards, mutation buttons, cost/spam visibility, property scoping) already reads the effective role, so they respond automatically. Selecting Super Admin clears impersonation.

Location Owner preview keeps its current behavior (scoped to Bob's assigned property, limited nav). Admin preview shows full read across properties with mutation buttons disabled. Owner preview shows all locations read-only with no admin pages.

Persistence: remember selection in `localStorage` so a refresh keeps the chosen view (same as today's toggle).

## Technical

**`src/contexts/PreviewModeContext.tsx`**
- Replace boolean `isPreviewingAsLocationOwner` with `previewRole: 'super_admin' | 'admin' | 'owner' | 'location_owner'` (defaults to real role).
- Expose `effectiveRole`, `setPreviewRole`, `isPreviewing` (true when previewRole !== real role).
- Keep backward-compat getter `isPreviewingAsLocationOwner = previewRole === 'location_owner'` so untouched call sites keep working, then migrate them.

**`src/components/layout/TopBar.tsx`**
- Replace the toggle with a shadcn `Select` (or `DropdownMenu`) rendered only when real role is `super_admin`.
- Label "Viewing as", four items above.

**Consumers to update** (swap boolean checks for `effectiveRole` comparisons):
- `src/lib/scoping.ts` — `canSeeCost`, `canSeeSpam`, `canSeeBadLead`, property scoping.
- `src/contexts/ScopeContext.tsx` / `PropertyContext.tsx` — force Bob's property only when `effectiveRole === 'location_owner'`.
- `src/components/layout/Sidebar.tsx` — nav visibility by `effectiveRole`.
- `src/App.tsx` route guards — use `effectiveRole`.
- Mutation gates (`GHLConnectionDialog`, sync buttons, admin pages) — enable only when `effectiveRole === 'super_admin'`.

No database or RLS changes — RLS still keys off the real role so the super admin retains real DB permissions; the dropdown only affects client-side visibility (matching how the current toggle works).
