# Tidy Property Actions + Add Sync Now, Delete, Cron Control

## Goals

1. Declutter the Actions column on the Properties table.
2. Add a "Sync now" action that triggers Google Ads (and CTM if connected) for that property on demand.
3. Allow deleting a property from the Edit dialog.
4. Expose the global sync cron schedule in Settings so it can be changed.

## Changes

### Properties table — collapse Actions into a dropdown

Replace the row of inline icon buttons with a single overflow menu (three-dot button) per row. The menu contains:

- Open public report (new tab)
- Copy share link
- Regenerate share link
- CTM connection
- Sync now (runs Google Ads + CTM for that property)
- Edit property
- Delete property (red, with confirmation)

The token preview (`/report/xxxxxxxx…`) stays under the cell so it's still scannable.

### Sync now (per property)

New handler: invoke `sync-google-ads` and, if CTM is connected, `sync-ctm` for the selected property over the last 30 days. Show a single toast summarising what was written. Spinner on the menu item while running.

### Edit dialog — delete property

Add a destructive "Delete property" button at the bottom-left of the Edit dialog footer. Confirmation step (type the property name to confirm). Deletes from `properties` (cascading rows are not changed here — same behavior as today's manual delete in the DB).

### Settings — cron schedule

Add a "Automatic sync schedule" card to `/admin/settings`:

- Read the current cron expression and active state from `cron.job` for the `scheduled-sync-all` job via a new SECURITY DEFINER RPC (`get_sync_cron_schedule`) restricted to `internal` role.
- Allow editing the expression with quick presets (Every hour, Every 3 hours, Every 6 hours — current, Every 12 hours, Every 24 hours, Custom) and an Active toggle.
- Save via a new SECURITY DEFINER RPC (`set_sync_cron_schedule(_schedule text, _active boolean)`) that calls `cron.alter_job` and is restricted to `internal` role.

No edit to the existing `scheduled-sync-all` function or to the cron command itself — only schedule/active flag are tunable from the UI.

## Technical details

Edits:
- `src/pages/admin/AdminProperties.tsx` — replace inline action icons with a `DropdownMenu` per row; add `syncNow` (Google Ads + CTM) and delete confirmation handling.
- `src/pages/admin/AdminSettings.tsx` — build the cron schedule card.
- New migration: two SECURITY DEFINER functions (`get_sync_cron_schedule`, `set_sync_cron_schedule`) gated on `has_role(auth.uid(), 'internal')`, plus the `cron.alter_job` call inside the setter.

No other backend or report-side changes.
