# Fix: Winchester GHL shows "Off" in the sidebar Data Sources panel

## What's actually happening

- `property_data_sources` for Winchester / GHL:
  - `is_connected = true`
  - `status = 'error'` (last error: `GHL /contacts/search 400`)
  - `last_synced_at = 2026-06-17`
- **Properties page** reads the `is_connected` column → shows **Connected**.
- **Sidebar Data Sources panel** calls the `get_api_health_summary` RPC, which derives `is_connected` as `(pds.status = 'connected')`. Because Winchester's GHL row is in `status = 'error'`, the RPC returns `is_connected = false`, and `SourceHealthPanel.rowStatus` then returns `"not_connected"` → label **Off**.

Two surfaces, two different definitions of "connected." The connection is real — only one endpoint (contacts/search) is failing.

## Fix

1. **Update `get_api_health_summary` RPC** (migration): change the `conn` CTE to use the persisted boolean, not the status string:
   - From: `(pds.status = 'connected')::boolean AS is_connected`
   - To: `COALESCE(pds.is_connected, false) AS is_connected`
   
   This makes the RPC agree with the Properties page on whether a source is connected. With Winchester's GHL `is_connected = true` but a recent failure logged, `SourceHealthPanel.rowStatus` will return `"failing"` and the panel will render **GoHighLevel — Blocked** (red dot) instead of **Off**. That's the correct signal: connected, but the last sync errored.

2. **No frontend changes required.** `SourceHealthPanel` already handles the `failing` state correctly; it just was never reaching it for Winchester because the RPC was lying about `is_connected`.

## Out of scope (call out, don't fix here)

- The underlying GHL `/contacts/search 400` error on the Winchester location is a separate issue. Once #1 lands, the panel will surface it as **Blocked** so it's visible. If you want, I can open a follow-up to debug the 400 (likely a payload/contact-search filter issue against location `ZXJOays3Pd3x883GEtmK`).

## Verification

- After the migration, reload `/admin/data-sources` and any page that renders the sidebar; Winchester's GoHighLevel row should switch from **Off** to **Blocked**.
- Spot-check other properties: any source row with `is_connected = true` and `status != 'connected'` will now show **Blocked** or **Stale** instead of **Off** — that's intended.
