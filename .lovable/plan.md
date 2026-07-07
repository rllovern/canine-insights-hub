## Make "Sales" everywhere read from the Google Sheet

Right now "Sales (count)" on Command is still `daily_metrics.projected_sale` (the old CTM AI-projected count). After the rename, "Sales" should mean the Google Sheet import, matching Verified Sale on the Dashboard.

### 1. Swap the data source on the Command "Sales" tile
- `src/pages/Command.tsx` — the owner-view "Sales (count)" / "PPC Sales" tile currently reads `active.appointments` (= `projected_sale`). Replace with the sheet-based count using `useVerifiedSalesTotal(propertyIds, from, to)` for the current and prior windows.
- Sparkline `series("projected_sale")` → build a per-day series from `useVerifiedSalesByDate` and pass that in.
- Update `sourceTable` label to `sheet_sales (Google Sheets import)`.
- PPC variant: same source (sheet sales are not ad-attributed, so PPC and Business show the same number — note this in the tooltip).

### 2. Feed the same number into the funnel and top-opportunities
- `useCommandData` returns totals where `appointments = projected_sale`. Add a `sheetSales` field populated from `sheet_sales` for the window, and route the "Sales" stage of the funnel (`JourneyFunnel`) and `TopOpportunities` "projection rate" logic to use it instead of `projected_sale`.
- Keep `projected_sale` in the internal aggregation for now (used by tooltips/formulas that reference the raw CTM signal), but no visible tile reads it.

### 3. Diagnose the empty sync
- `sheet_sync_config.last_sync_at` is null and `sheet_sales` has 0 rows across all properties. Trigger a manual sync via the edge function and surface any error from `last_sync_error` in the Admin → Google Sheets page prominently (currently likely swallowed).
- Verify the tab name `Winchester 2026` resolves against the spreadsheet's actual tab list; if the sync errors with a bad range, show the tab-name mismatch inline in Admin → Properties.

### Out of scope
- Changing what Call Tracking reads (still `daily_metrics.verified_sale`).
- Renaming the DB column `projected_sale`.
- Reworking the AI-projected quality-rate math — Quality Rate still uses `(good + projected_sale) ÷ total_leads` because that's the CTM-derived quality signal, not the sheet-derived business outcome.

### Question before I build
Do you want the Command "Sales" tile to count **all sheet rows in the range** (using `sale_date` as we do today — coalesce of Sold Date then Creation Date), or do you want it to count strictly by **Sold Date only** (rows without a Sold Date wouldn't count until they close)?