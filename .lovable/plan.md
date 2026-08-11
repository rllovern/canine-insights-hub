# Fix mobile navigation interactivity

## What's wrong

Reproduced on a 393px touch viewport:

- Opening the hamburger drawer works, and tapping the location selector opens the location list visually — but the list cannot be tapped. The drawer is a modal dialog, and the location dropdown renders in a separate portal outside it, so the dialog's modal layer swallows every tap on the dropdown. The location never changes.
- The location list is also clipped to the drawer area, so lower entries (e.g. Winchester) are partly unreachable even before the tap problem.
- Nav links themselves do navigate in a clean browser, but they share the same modal-portal fragility, and any tap that lands on the dropdown's blocked layer feels like "nothing happens".

## The fix

- Render the location dropdown inside the drawer's own layer instead of a detached portal, so taps reach it. Same treatment for any other popover/tooltip surface placed inside the mobile drawer.
- Give the location list a taller, screen-aware max height with its own scroll, and size it to the viewport rather than a fixed 288px, so every location is reachable on a phone.
- Close the drawer automatically after a location is selected, so the user immediately sees the newly scoped page.
- Add a safety cleanup when the drawer closes so no leftover modal layer can block taps on the page behind it.
- Verify on a touch viewport: open drawer, switch location, confirm the header/scope updates; then tap each nav group entry and confirm navigation and re-render.

## Technical notes

- `src/components/layout/ScopeSelector.tsx`: accept an optional `container` (or `inDrawer`) prop and pass it to `PopoverPortal`/`PopoverContent` so the popper mounts within the `SheetContent` node; add `onOpenAutoFocus` handling for touch, `max-h-[60vh]` on `CommandList`, and `w-[min(18rem,calc(100vw-3rem))]`.
- `src/components/layout/MobileNav.tsx`: hold a `ref` to the `SheetContent` element, pass it to `ScopeSelector`, and pass an `onScopeChange` callback that calls `setOpen(false)`.
- `src/contexts/ScopeContext.tsx` stays unchanged — this is a UI/portal containment fix, no scope logic changes.
- On drawer close, clear any stray `pointer-events: none` left on `document.body` by the dialog primitive.
