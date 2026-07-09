Findings:

- Winchester is close because its synced `won_at` date currently matches GHL’s status-change date for the last 30 days: 55 here vs about 57 in GHL.
- NoVA is inflated because the app is currently using the opportunity `updatedAt` timestamp as `won_at`.
- In GHL, an opportunity can remain `won` while still being updated later as it moves through stages like `In Training` or `Finished Training`.
- That means the app is counting some already-won opportunities again in the current window when they were merely updated, not newly marked won.
- In NoVA’s synced last-30-day data:
  - Current app logic: 174 won opportunities.
  - GHL-style status-change date: about 105–108, depending on exact timezone/window cutoff.
  - GHL UI reported by you: 109.
- The remaining small gap is likely date-window/timezone cutoff or a sync freshness difference, not the same stage inflation issue.

Plan:

1. Change the GHL sync mapping for sales dates.
   - For won opportunities, store `won_at` from GHL’s `lastStatusChangeAt` first.
   - Fall back to `lastStageChangeAt` or `updatedAt` only if GHL does not provide `lastStatusChangeAt`.
   - For lost opportunities, apply the same rule to `lost_at` so loss timing is consistent too.

2. Backfill existing synced opportunities.
   - Update existing won/lost opportunity rows from the raw GHL payload’s `lastStatusChangeAt` where available.
   - This will correct NoVA historical last-30-day counts without waiting for every opportunity to be resynced.

3. Keep Verified Sales source aligned to GHL status.
   - Continue counting opportunities where `status = won`.
   - Continue bucketing by corrected `won_at`.
   - Do not use stage-name filters globally, because Winchester and NoVA use different stage naming patterns.

4. Deploy the updated sync function.
   - Future GHL syncs will preserve the correct “marked won” date instead of replacing it with later update dates.

5. Run a reconciliation check for all active locations.
   - Compare each location’s Verified Sales count using corrected `won_at` for the selected last-30-day window.
   - Break discrepancies down by likely reason:
     - date/timezone cutoff,
     - data not synced yet,
     - missing `lastStatusChangeAt` fallback used,
     - duplicate opportunities/contact-level duplicates,
     - pagination/sync cap.

6. Report the post-fix counts.
   - Specifically recheck Winchester and NoVA.
   - If any location still does not match GHL after the corrected date source, we’ll have a clear discrepancy table showing why and what rule/data issue needs to be handled next.

Technical notes:

- Update `supabase/functions/sync-ghl/index.ts` opportunity mapping.
- Update existing opportunity rows in the backend database with a safe data update.
- No new table is required for this fix.
- If GHL UI uses a different date preset than the app’s “Last 30 days,” exact matches require both tools to use the same start/end dates and timezone.