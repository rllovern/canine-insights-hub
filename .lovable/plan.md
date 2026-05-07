# Restore the Clients tab + property switcher (AlienX parity)

## What's actually wrong

The Clients sidebar item and the top‑bar property switcher are already built, but they're invisible right now for two reasons:

1. **Backend permission bug** — `public.has_role(uuid, app_role)` was created `SECURITY DEFINER` but never granted `EXECUTE` to the `authenticated` role. Every RLS policy on `properties` (and other tables) that calls `has_role()` therefore fails with `42501 permission denied for function has_role`. Console confirms this on every page load. Net effect: `PropertyContext` receives an empty list → the top‑bar `<Select>` is rendered conditionally on `properties.length > 0` and so it disappears.
2. **Empty `properties` table** — even with the grant fixed, `SELECT * FROM properties` currently returns 0 rows, so there's nothing to select. The UI needs to handle the empty state by showing the switcher anyway with an "Add a client" call‑to‑action that links to `/admin/properties` (matches the AlienX screenshot's behavior).

The Clients link itself is in `Sidebar.tsx` under the "ADMIN" section, gated on `effectiveRole === "internal"`. Once `has_role` works, your role loads and the link appears.

## Changes

### 1. Database migration
- `GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;`
- Same grant for `public.viewer_can_access(uuid, uuid)` (used by the viewer policy on `properties`).
- Verify with `supabase--linter` after.

### 2. `src/components/layout/TopBar.tsx`
- Render the property `<Select>` unconditionally for internal users.
- When `properties.length === 0`, replace the select with a small "+ Add client" button that routes to `/admin/properties`.
- Keep the existing avatar chip to the right of the selector (matches screenshot).

### 3. `src/components/layout/Sidebar.tsx`
- No structural change — the Clients/Users/Settings group already exists. Just confirm icon is `Users` and label is "Clients" (it is). Add a tiny safeguard so the Admin section also renders during the brief `role === null` loading window for users whose JWT has an internal role cached, to avoid a flash of missing nav.

### 4. `src/pages/admin/AdminProperties.tsx`
- Already functional. After the grant fix, "Add property" will succeed and newly created rows will appear in the top‑bar switcher immediately (PropertyContext.reload() is already wired).

## Out of scope
- No new pages, no schema changes beyond the two GRANTs.
- AlienX‑style "Import from MCC / Import from CTM" buttons on the Clients page are a separate task — the edge functions already exist (`list-mcc-customers`, `list-ctm-accounts`); wiring them into AdminProperties UI can follow once the basics are visible.

## Verification
1. Reload `/dashboard` — no `permission denied` errors in console.
2. Sidebar shows ANALYTICS group + ADMIN group with Clients / Users / Settings.
3. Top bar shows the property selector (empty state with "Add client" button).
4. Create a client at `/admin/properties` → it appears in the top‑bar selector and becomes the active property.
