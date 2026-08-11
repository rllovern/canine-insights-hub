# Keep the Records by Source tooltip on the page

## Problem
After unclipping the tooltip, it can now float past the right edge of the viewport when the user hovers near the last date on the chart.

## Goal
Keep the full tooltip visible without letting it escape the page on the far right.

## Changes
1. **MultiLineChart / SingleLineChart** (`src/components/dashboard/MultiLineChart.tsx`)
   - Change `allowEscapeViewBox` from `{ x: true, y: true }` to `{ x: false, y: false }` so Recharts keeps the tooltip inside the chart's drawing area.
   - Keep the `wrapperStyle={{ zIndex: 50 }}` so the tooltip still layers above the card.

2. **ChartCard** (`src/components/dashboard/ChartCard.tsx`)
   - No change needed; the card already no longer clips the tooltip.

## Verification
- Hover the **Records by Source** chart near the far-right date (e.g., Aug 11) and confirm the tooltip shifts left and stays fully on screen.
- Check the left side of the chart to make sure the tooltip still renders normally.
