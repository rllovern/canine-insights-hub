## Sale Records: add two charts above the table

Add a visually striking chart row above the existing sale records table on `/sales`. Both charts derive from the same `useSaleRecords` data already fetched on the page, so no new queries or backend work.

### 1. Calendar heatmap — "Sales Cadence"
- Grid of day cells covering the active `useDateRange()` window (respects the top date toggle and scope).
- Cell color intensity = number of sales on that day, using a single-hue ramp built from `--primary` (5 buckets: 0, 1, 2, 3, 4+). Empty days rendered as muted surface cells so the grid stays legible.
- Weeks laid out as columns (GitHub-style) with weekday row labels (S M T W T F S) and month labels above the first cell of each month.
- Hover tooltip: date + "N sales · $X revenue".
- Legend row: "Less → More" swatch strip.
- Motion: cells fade + scale in on mount with a staggered diagonal sweep (framer-motion, ~250ms total, `delay = (col+row) * 8ms`). Hover: subtle scale-105 + ring in primary.
- Auto-adjusts cell size to fit width; caps at ~14px on wide viewports, shrinks on narrow.

### 2. Revenue trajectory with target runway — "Revenue Runway"
- Line/area chart of cumulative revenue by day across the selected range (Recharts, matching the existing `ChartCard` / chart styling in `src/components/dashboard/MultiLineChart.tsx`).
- Two series:
  - **Actual cumulative revenue** — bold gradient area under a 2.4px primary line, animated stroke draw on mount.
  - **Target runway** — dashed reference line from $0 on the first day to the target on the last day (linear pace).
- Target logic (no backend change): pace target = the run-rate needed to hit a monthly goal derived from the trailing 90-day average monthly won revenue for the current scope. Computed client-side from `fetchSaleRecords` for `[today-90d, today]` (new small helper `useRevenueTarget(propertyIds)`), then scaled to the selected range length. If the trailing window returns zero, hide the target line and show "Set a target" affordance (non-interactive placeholder for now — no settings UI in this task).
- Header stat strip inside the card: Actual $ · Target $ · Delta (green/red) · % to pace.
- Motion: area path uses Recharts' built-in animation (900ms ease-out); the stat strip numbers count up with a short tween on mount / range change.

### Layout
- New row above the table: two columns on `lg+` (heatmap left, runway right), stacked on smaller screens. Both use the existing `ChartCard` wrapper for consistent chrome, titles, and subtitles that echo the header's range/scope text.
- Loading: skeletons sized to each chart's height.
- Empty range (0 sales): heatmap still renders (all empty cells); runway shows a muted "No revenue in range" state instead of an empty chart.

### Files touched
- `src/pages/SaleRecords.tsx` — add chart row above the table; derive per-day counts + cumulative revenue from `rows`.
- `src/components/sales/SalesHeatmap.tsx` — new component (framer-motion cells, tooltip via Radix `HoverCard` or lightweight title).
- `src/components/sales/RevenueRunway.tsx` — new component (Recharts area + reference line, stat strip).
- `src/lib/verified-sales.ts` — add `useRevenueTarget(propertyIds)` helper (reuses `fetchSaleRecords` over trailing 90d).

No schema changes, no new routes, no navigation changes.
