# Sales Cadence: paged month calendar

## What changes
Instead of stacking every month in the range vertically (which makes the card grow taller and taller), the heatmap shows **one month at a time** at a fixed height, with a small pager beside the month name.

- Header row inside the calendar: `‹  July 2026  ›` plus a subtle "1 of 2" indicator.
- Only months that overlap the selected date range are pageable. 30-day range = 1 or 2 months; 60-day range = 2 or 3 months; and so on.
- Opens on the most recent month in the range by default; pager arrows disable at the ends.
- Card height stays constant: the grid always renders 6 week-rows so a 5-row month doesn't shrink the card, keeping it aligned with the Revenue Runway chart beside it.
- Days outside the selected range stay dimmed/non-interactive exactly as today.
- Changing the date range or the Won/Revenue metric resets to the latest month.
- Light slide/fade transition when paging between months.

## Layout thresholds
The paged month calendar now covers ranges up to 120 days (it replaces the rolling-weeks layout, which was the other stacked-growth case). Ranges over 120 days keep the compact annual contribution grid.

## Technical notes
All work is in `src/components/sales/SalesHeatmap.tsx`:
- `MonthView` gains `activeIndex` state over the computed `months` array and renders a single `MonthGrid` plus prev/next controls; remove the vertical stack.
- `MonthGrid` always builds 6 rows from `startOfWeek(startOfMonth)` so row count is stable.
- Reset `activeIndex` via an effect keyed on `from`/`to`.
- Mode selection changes to `dayCount <= 120 ? "month" : "annual"`.
- Existing tooltip, threshold coloring, and day-drawer drill-down behavior unchanged.
