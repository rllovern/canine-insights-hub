# Add Google Sheets as the Verified Sale data source

## Goal
Import sales data from a single Google Sheet (one tab per property) and use it as the source of truth for "Verified Sale" everywhere in the app **except** the Call Tracking report, which keeps its own CTM-based value.

## 1. Connect Google Sheets
- Use the Lovable **Google Sheets connector** (one workspace-owned Google account).
- Super admin picks the master spreadsheet by pasting its URL/ID once in **Admin → Data Sources → Google Sheets**.
- Spreadsheet ID is stored in a new settings row so it can be changed later.

## 2. Tab → Property mapping
- On sync, we list every tab in the sheet.
- For each property we try to auto-match by normalized property name (case/whitespace/punctuation-insensitive).
- Admin → Properties gets a new field **Google Sheet Tab** showing the auto-matched tab with a dropdown of all tabs to override or clear.

## 3. Sheet schema we read
Expected columns per tab (header row 1):
`Full Name`, `Email`, `Phone`, `City/State`, `1st Session`, `Deal Value`, `Creation Date`, `Sold Date`, `Notes`.

**Verified-sale rule:** a row counts as **1 verified sale** if it has a non-empty **Full Name** AND a parseable date. Date used = **Sold Date** if present, else **Creation Date**. Rows missing both are skipped.

## 4. Storage
New table `sheet_sales`:
- property_id, sale_date, full_name, email, phone, city_state, first_session, deal_value, creation_date, sold_date, notes, source_row_hash
- Unique on (property_id, source_row_hash) so re-syncs are idempotent.
- RLS: viewers can read rows for properties they can access; only service role writes.

New table `sheet_sync_config`:
- singleton row holding `spreadsheet_id`, `last_sync_at`, `last_sync_status`, `last_sync_error`.

`properties` gets a nullable `google_sheet_tab TEXT` column.

## 5. Sync
Edge function `sync-sheet-sales`:
- Reads spreadsheet metadata → all tabs.
- For each property with a mapped tab, fetches the tab range, parses rows, upserts into `sheet_sales`.
- Runs on a **daily cron** and via a **manual "Sync now" button** in Admin → Data Sources.

## 6. Where Verified Sale is read from
A single helper `fetchVerifiedSales(propertyIds, from, to)` counts rows in `sheet_sales`. It replaces `daily_metrics.verified_sale` reads in:
- **Dashboard** (Verified Sale tile + trend)
- **Command page** (Verified Sale card, chart, funnel copy)
- **Portfolio Verdict** and any portfolio rollup
- Any other view that currently reads `verified_sale` from `daily_metrics`

**Call Tracking report is untouched** — it keeps its own CTM source and existing `verified_sale` column.

`daily_metrics.verified_sale` is left in place (Call Tracking still uses it) but no longer surfaced elsewhere.

## 7. Admin UI additions
- **Admin → Data Sources → Google Sheets** panel: connect account, paste spreadsheet ID, show last sync time/status, "Sync now" button.
- **Admin → Properties → property detail**: "Google Sheet Tab" selector (auto-matched, editable).

## Technical notes
- Connector: `google_sheets` via Lovable connector gateway (workspace OAuth).
- Auto-match: normalize both sides (`lowercase`, strip non-alphanumerics) before comparing.
- Row hash: sha256 of `full_name|email|phone|sold_date|creation_date|deal_value` to detect duplicates on re-sync.
- Cron: `pg_cron` + `pg_net` calling the edge function daily at 06:00 UTC.
- Types regenerate after the migration; UI wiring is done after that.

## Out of scope
- Editing sheet rows from the app (read-only).
- Multi-sheet / multi-spreadsheet support.
- Revenue dollars ­— we're only counting rows as sales, per your call.
