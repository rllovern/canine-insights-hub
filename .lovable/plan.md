## Goal

Make `/admin/properties` (Clients) read-only for Admin users. Only Super Admin can add, import, edit, sync, or reconnect properties.

## Changes

**`src/pages/admin/AdminProperties.tsx`**
- Pull `role` from `useAuth` and compute `isSuperAdmin`.
- Header actions row — render `Import from MCC`, `Import from CTM`, and `Add property` buttons only when `isSuperAdmin`.
- Row actions dropdown — Admins keep only the read-only entries (`Open public report`, `Copy share link`). Hide these entries for non-super-admins:
  - Regenerate share link
  - CTM connection
  - Go High Level connection
  - Sync now
  - Edit property
- When an Admin viewer would end up with no actions in the row menu, hide the dropdown trigger entirely so the column stays clean.
- Guard the callbacks (`handleDelete`, `syncNow`, regenerate, dialog openers) with an early `isSuperAdmin` check as a defensive stop, even though the UI won't expose them.

**`src/App.tsx`**
- No route change needed — `/admin/properties` stays behind `requireStaff` so Admins can still view the list, but the page itself now gates every mutation.

**Backend**
- No database or RLS changes in this pass. Mutation controls are being removed from the UI for Admin; existing RLS on `properties` and related tables already blocks non-privileged writes for the client, and Super Admin retains full access.

## Out of scope

- Sidebar visibility of the Admin section (already handled in a prior change).
- Role preview toggle behavior (already handled).
- Client Reports page (`/admin/client-reports`) — untouched unless you want the same lockdown there; say the word and I'll extend it.
