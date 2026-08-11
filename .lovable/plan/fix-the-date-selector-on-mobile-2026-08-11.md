# Fix the date selector on mobile

The date range picker opens as a fixed-width desktop popover (a 224px preset column beside a 560px calendar column, with two months side by side). On a 393px-wide phone this is roughly twice the screen width, so the calendar and inputs render off-page and can only be reached by horizontal scrolling.

## What changes

Make the picker render in a mobile-friendly container while leaving the desktop experience untouched.

On phones (viewport < 768px):
- Open the picker in a bottom sheet that spans the full screen width and up to ~90% of screen height, instead of a floating popover.
- Stack the layout vertically: presets first (as a compact wrapped chip grid rather than a tall 224px column), then start/end date fields, then the calendar, then compare controls.
- Show one month at a time instead of two, sized to fit the screen width.
- Make the body scrollable with the Cancel / Apply buttons pinned to the bottom so Apply is always reachable.
- Let the trigger button truncate its label instead of forcing the toolbar wider than the screen.

On tablet/desktop: unchanged popover, two-month calendar, side-by-side layout.

## Technical notes

- `src/components/layout/DateRangePicker.tsx`: extract the current inner content into a shared `PickerBody` that takes a `compact` flag, then branch on `useIsMobile()` (`src/hooks/use-mobile.tsx`) to wrap it in either the existing `Popover` or a `Drawer` (`src/components/ui/drawer.tsx`) on mobile.
- Compact mode: `numberOfMonths={1}`, vertical flex instead of `flex` row, presets as a `grid grid-cols-2` of buttons, drop the fixed `w-56` / `w-[560px]` widths in favor of `w-full`.
- Popover content gets `max-w-[calc(100vw-1rem)]` as a safety net so it can never exceed the viewport at any breakpoint.
- All state, preset logic, compare handling and `applySelection` behavior stay exactly as they are — this is a layout/containment change only.
