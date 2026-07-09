Why Winchester only shows 1:

- The current Verified Sale logic was tightened to count only opportunities in stages named exactly `Sold`.
- Winchester has only 1 July won opportunity currently in an exact `Sold` stage.
- Most Winchester wins are in stages named `SOLD ->` and `Sold to HQ`, so they are excluded by the exact-stage filter.
- In the backend data for Winchester July, I see 17 won opportunities: 12 in `SOLD ->`, 4 in `Sold to HQ`, and 1 in `Sold`. That explains why the app shows 1 while GHL shows the broader Won/Sold total.

Plan to fix:

1. Update Verified Sales logic so it matches GHL’s Won total instead of exact stage names.
   - Count opportunities where `status = won`.
   - Bucket by `won_at` date.
   - Remove the exact `Sold` stage-name filter that is excluding Winchester’s won opportunities.

2. Keep Call Tracking unchanged.
   - Call Tracking will continue using its existing metric source, per the previous scope decision.

3. Verify the affected properties after the change.
   - Winchester should no longer show only 1; it should reflect the GHL Won/Sold count available in the synced data.
   - NoVA should be rechecked because this reverts the stage-name restriction that reduced its inflated count. If NoVA still needs a different interpretation than GHL Won, we should handle that with property-specific sale-stage rules instead of one global exact-name filter.

Technical notes:

- File to update: `src/lib/verified-sales.ts`.
- No database schema change is required for the simple GHL-Won matching fix.
- If different locations need different definitions of “Verified Sale,” the durable follow-up would be a property-level sale-stage mapping table/admin setting, but the immediate fix is to match GHL’s Won status as the source of truth.