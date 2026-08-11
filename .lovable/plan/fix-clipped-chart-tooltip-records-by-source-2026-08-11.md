# Fix clipped chart tooltip ("Records by Source")

## Problem
The floating tooltip on the **Records by Source** multi-line chart is clipped by the `ChartCard` container, so the full record count and source list are hidden under the card edge/bottom.

## Goal
Keep the card visually unchanged, but let its tooltip render fully on top of the card when the user hovers.

## Changes
1. **ChartCard** (`src/components/dashboard/ChartCard.tsx`)
   - Remove `overflow-hidden` from the card wrapper so the Recharts tooltip is no longer clipped.
   - Keep `bg-card`, `border`, `rounded-xl`, `shadow-sm`, and padding exactly as they are.

2. **MultiLineChart / SingleLineChart** (`src/components/dashboard/MultiLineChart.tsx`)
   - Add `wrapperStyle={{ zIndex: 50 }}` to both `<Tooltip>` instances so the floating tooltip layers above sibling cards.
   - Add `allowEscapeViewBox={{ x: true, y: true }}` so the tooltip can render outside the chart's SVG bounds when needed.

## Verification
- Hover the **Records by Source** chart near the right edge and bottom; confirm the full tooltip is visible and not clipped.
- Check other `ChartCard` usages (Dashboard, SaleRecords) to ensure no visual regression.
