# Sync all locations' Google Ads data and verify no double counting

## What will happen
1. **Check first (no changes):** Run a preview-only Google Ads sync for all 11 locations. It lists any newly renamed campaigns and any merges it would make, without changing anything.
2. **Full sync:** Run the normal sync for every location. It pulls fresh spend, clicks and conversions, and automatically merges any renamed campaigns' history under the campaign's current name.
3. **Duplicate checks on the stored data:**
   - No campaign shows two rows for the same day at any location.
   - No recent spend is recorded under a campaign name Google no longer reports.
   - Month-to-date spend per location matches what was synced, and is compared with the figures from the last audit (Colorado Springs, NoVA, Winchester, Ohio, Indy).
   - Leads, good leads and call records are unchanged before and after.
   - NoVA and Winchester stay correctly separated by their campaign labels.
4. **Page check:** Open the dashboard as super admin and confirm the spend figures match the stored totals and the pages load without errors.
5. **Report:** Spend per location, any renames merged, sync failures, and anything still open.

## What will not change
Marketing Ops, Bob, reports, the other data syncs (call tracking, CRM) and the GHL-to-CTM form tracking. No merges will be undone or redone unless the preview shows new renames.

## Known limits
- The Google Ads login available in chat can't see your manager account, so totals can't be checked directly against Google Ads. Figures come from the sync itself.
- The older April–May spend shared between NoVA and Winchester (recorded before labels existed) is left as is unless you ask for that cleanup.

## Technical details
- Call `sync-google-ads` per property with `reconcile_dry_run: true`, then normally; capture `reconcile_campaign_renames` output.
- SQL checks: `daily_metrics` grouped by (property_id, date, campaign_id) and (property_id, date, campaign) having count > 1; month-to-date cost per property before and after; spot-check `campaign_rename_log` for new entries.
- Playwright run on dashboard as super admin; check build and runtime logs.
