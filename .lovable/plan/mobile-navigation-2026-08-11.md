# Mobile navigation

The sidebar is hidden below the `md` breakpoint (`hidden md:flex`) and nothing replaces it, so on phones there is no way to change page, switch location scope, sign out, or see source health. Fix: add a slide-out mobile menu with the exact same items the desktop sidebar shows for the current role.

## What gets built

1. **Shared nav config** — move the nav item definitions and role-filtering logic out of `Sidebar.tsx` into a small shared module so desktop and mobile always render identical, role-correct menus (Executive View, Monitor, Deliver, Jarvis, Admin group).
2. **Hamburger in the top bar** — a menu button visible only below `md`, left of the title, opening a left-side drawer (shadcn `Sheet`).
3. **Drawer contents**, matching desktop top-to-bottom:
   - Brand mark
   - Location/scope selector
   - All nav groups and links the user's role allows, with active-route highlighting
   - Source health panel
   - Account row with email, role label, and sign out
   - Tapping any link closes the drawer
4. **Top bar fit on small screens** — keep the date range picker and role/preview controls reachable, wrapping rather than overflowing at 393px width.

## Notes

- Drag-to-reorder stays desktop-only; the mobile drawer renders the same (persisted) order read-only.
- No routing, permission, or data changes — presentation only.

## Technical detail

- New `src/components/layout/navItems.ts` exporting the item lists plus a `useVisibleNav()` helper wrapping the existing `superAdminOnly` / `staffOnly` / minimal-role rules.
- New `src/components/layout/MobileNav.tsx` using `Sheet`/`SheetContent side="left"`, styled with the sidebar tokens.
- `Sidebar.tsx` refactored to consume the shared config; `TopBar.tsx` renders `<MobileNav />` inside a `md:hidden` wrapper.
