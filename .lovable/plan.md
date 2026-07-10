## Rebuild: Sales Cadence heatmap

Replace the current GitHub-style grid with a layout-adaptive, product-focused visualization that fills the card and reads as intentional at every date range.

### Data reality (scope guardrail)
The page's only source is `useSaleRecords` → `ghl_opportunities` (won) joined to `ghl_contacts`. Fields available per record: name, phone, email, `created_at`, `won_at`, `amount`. That means:
- **Metric switcher** ships with two real metrics: **Won deals** and **Closed revenue**. The other metrics listed (appointments booked, qualified leads, proposals sent) are not in the current dataset and are **not** included in this rebuild.
- **Drill-down** shows the actual won opportunities for that day (name, email, phone, amount, time won) — not salesperson/lead source/close time, since those aren't available.
- **"Missing/unsynced" state** is only rendered for days that fall before the earliest ingested `won_at` for the scope; otherwise a real day with no wins is a true zero.

### Layout mode by range length
`range.to − range.from + 1` in days drives the mode:
- **7–31 days → Month view** (7-col calendar, large cells with number + metric).
- **32–120 days → Rolling weeks view** (contribution grid, cells sized to fill width).
- **>120 days → Annual compact view** (contribution grid with month bands).
- **<7 days** (e.g. Today, Yesterday) → Month view of the containing calendar month, with only in-range days interactive; other days rendered as faint out-of-range.

Selection is a pure function of the date range; no user toggle.

### Metric switcher
Compact segmented control in the card header: **Won deals** (default) / **Closed revenue**. Selected metric drives cell intensity, primary cell text, legend thresholds, header summary, and insight copy.

### Month view (7–31 days)
- 7 columns (Sun→Sat), 4–6 rows, cells are large squares that fill card width (`cellSize = floor((cardWidth − padding) / 7)`, clamped 72–128px).
- Each in-range cell:
  - Top-left: date number (e.g. `14`).
  - Center/bottom: primary metric (`3 deals` or `$18.5K`).
  - Background intensity from the metric (see Intensity).
  - Rounded (`rounded-lg`), border for zero state, hover ring in `--primary`, visible focus ring, `role="button"`, `tabIndex=0`, `aria-label` per spec.
- Out-of-range calendar days (from the same month, before/after range): rendered faint and non-interactive so the week structure is preserved.
- Missing-data days: diagonal-hatch background + "unavailable" text.
- Card min-height 360px on desktop; grows to fit content.

### Rolling weeks view (32–120 days)
- Columns = weeks, rows = weekdays; weekday labels on the left, month labels above the first column of each new month.
- Cell size computed from container width, clamped **12–24px** so short-of-annual ranges render larger cells rather than a tiny grid.
- Vertically centered inside the card. Card height 240–300px.
- Hover/focus/click states identical to month view; primary text hidden inside cells (numbers would be illegible) — day + metric shown in tooltip/drawer.

### Annual compact view (>120 days)
- Standard contribution grid with 10–14px cells, month bands, weekday labels. Card height 260–320px.
- Same interaction model.

### Cell states (all views)
1. **In-range, has value** — filled with intensity bucket.
2. **In-range, zero** — neutral surface cell with a thin border and a visible `0`.
3. **Missing/unsynced** — diagonal-hatch (SVG pattern) with `Unavailable` label. Applied only when the day is before `min(won_at)` for the scope.
4. **Out of range** — very faint disabled cell, no interaction. In month view this happens for edge-of-month padding days; in the other views it doesn't occur.

### Intensity buckets
- **Won deals** — fixed business thresholds: `0`, `1`, `2`, `3–4`, `5+`.
- **Closed revenue** — quantiles over nonzero days in the current range: `0`, `>0–p25`, `p25–p50`, `p50–p75`, `>p75`. Fallback to fixed `<$5K / $5–10K / $10–20K / $20K+` when fewer than 4 nonzero days exist.
- Colors: 5-step ramp built from `--primary` opacities (`0.08 → 0.25 → 0.45 → 0.7 → 1.0`), semantic tokens only.
- Thresholds are computed once per render and passed to both the legend and tooltip so they always agree.

### Header summary (single inline row, inside the card)
Above the grid, one row of compact stats — no extra dashboard cards.

Won deals mode:
`24 won deals · 7 of 10 active days · Best: Jul 7 · 5 · Avg: 2.4/day`

Revenue mode:
`$146,500 closed · 7 of 10 revenue days · Best: Jul 7 · $32K · Avg: $14,650/day`

### Legend
Explicit thresholds derived from the intensity function, prefixed with the metric name:

`Won deals per day:  0  ·  1  ·  2  ·  3–4  ·  5+`
`Closed revenue per day:  $0  ·  <$5K  ·  $5–10K  ·  $10–20K  ·  $20K+` (or quantile edges when used)

### Tooltip
Radix `HoverCard` on cells. Selected metric first, then supporting data available from the dataset:

```
Tuesday, Jul 7
Won deals: 5
Closed revenue: $32,000
Average deal value: $6,400
```

No fake fields (no qualified-leads / appointments / close-rate lines, since we don't have the data).

### Day drill-down
Click (or Enter/Space) opens a right-side drawer (shadcn `Sheet`) containing:
- Date header + weekday
- Totals: won deals count, closed revenue, average deal value
- "% vs. same weekday average" over the visible range
- Table of the day's won opportunities: Name, Email, Phone, Time won, Amount
- Empty state when zero deals (with the same weekday-comparison line)

### Insight footer
One line under the legend, generated from the current data + metric:
- "42% of this period's won deals occurred on 3 days." (concentration)
- "Tuesday was the strongest closing day, averaging 3.8 wins."
- "4 of the last 10 days produced no won deals."
Pick the highest-signal one via a small ranker (concentration > best weekday > drought), single line only.

### Responsive
- **Desktop**: as specified above.
- **Tablet**: summary row wraps to 2 rows; keep 7 columns in month view; shrink font before shrinking cells.
- **Mobile**:
  - Month view keeps 7 columns; cells show date number + primary metric only, secondary details move to tooltip/drawer.
  - Rolling-weeks view collapses to a 4-week rolling window with a "See full range" affordance that opens the drawer-based full grid.
  - Annual view collapses to a monthly-totals bar strip (12 bars) — never a squeezed annual grid.

### Files touched
- `src/components/sales/SalesHeatmap.tsx` — full rewrite. Exports `SalesHeatmap` with props `{ from, to, rows, metric, onMetricChange }`. Internally selects Month / RollingWeeks / Annual sub-components, computes intensity thresholds, header stats, insight text.
- `src/components/sales/SalesHeatmapCell.tsx` — new. Shared cell primitive (states, tooltip trigger, focus/click handlers).
- `src/components/sales/SalesDayDrawer.tsx` — new. `Sheet`-based drill-down for a single day; consumes the day's `SaleRecord[]`.
- `src/pages/SaleRecords.tsx` — pass the raw `rows` and controlled `metric` state into `SalesHeatmap`; remove the fixed `Skeleton` height so the card can adapt. Keep the existing `ChartCard` wrapper but drop its fixed inner height.
- `src/components/dashboard/ChartCard.tsx` — no change; the min-height comes from the heatmap component itself.

### Out of scope (explicit)
- Appointments, qualified leads, proposals sent metrics (no data yet).
- Salesperson / lead source / close-time fields in the drawer (no data yet).
- Persisting the metric selection across sessions.
- Changes to Revenue Runway (unaffected by this rebuild).
