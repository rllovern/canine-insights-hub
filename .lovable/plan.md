# Client-facing audit + protection against the "RSK9 | Location | ..." campaign renames

## What I found (read-only checks done today)

- **The new names haven't reached our data yet.** The last Google Ads sync finished around 00:15 UTC today for every location. Every stored campaign still has its old name (for example Colorado Springs: "Generic Conversions" and "Dog Training"). No stored campaign starts with "RSK9 |". So either the renames came after that sync, or they're still being rolled out. Either way, the next sync will be the first to see them.
- **I couldn't read Google Ads live from here.** The Google Ads connection available in this chat is signed in as a different Google account that can't see your manager account. The app's own sync still works, so this doesn't affect the dashboards.

## What the rename will break if nothing is done

1. **Double-counted spend at every location.** This is the same problem we fixed for Colorado Springs "Haydn Conversions" in September, but this time it hits every campaign at once. Our history is stored under each campaign's name. A renamed campaign starts a new history line, and the sync refills its recent days. Meanwhile the old line stays, with the same spend for those days. Spend, cost per lead and budget pacing would roughly double for that period.
2. **Shared account (NoVA / Winchester) loses history.** These two locations are separated by Google Ads labels, and the labels are matched by campaign name. After the rename, the label list will only contain the new names. Old-name history that has spend would then be treated as "the other location's campaign" and hidden from both locations.
3. **The call tracking campaign table cuts names short.** The campaign breakdown on the Call Tracking page uses "|" internally to join source and campaign. A name like "RSK9 | Colorado | Generic" would show as "RSK9" only. Different campaigns would also merge into one row.
4. **Things that are safe:**
   - Local Services exclusion (it matches "LocalServicesCampaign" at the start of the name)
   - The budget pacing label filter (it uses label data)
   - Bob's internal lookup keys
   - The monthly report
   - Call tracking sync (it uses a different separator)

## The fix

1. **Track campaigns by their Google Ads ID, not their name.** The sync will save each campaign's permanent ID next to its spend. Each day, a renamed campaign is recognised as the same campaign: its rows move to the new name, and the old-name rows for the same days are merged into them. Lead counts from call tracking are added in and spend is never added twice. Earlier history moves to the new name too, so each campaign reads as one continuous line.
2. **Fix the label match for the shared account in the same way.** Labels are stored with the campaign ID, so NoVA and Winchester keep their full history after any rename.
3. **Fix the Call Tracking campaign table** so names containing "|" display and group correctly.
4. **Keep the existing "Renamed or removed campaigns" warning** as a safety net. It should read empty after the first sync that follows the rename.

## Full client-facing audit (after the fix, and again after the first post-rename sync)

For every location, last 30 days and month to date:
- Spend per location and per campaign compared with Google Ads' own totals (read through the app's sync connection). Any difference over $1 gets flagged.
- No campaign recorded twice for the same day. No spend on a name Google no longer reports.
- NoVA and Winchester together equal the shared account total, with nothing missing and nothing counted twice.
- Records, leads and good leads unchanged before and after the merge.
- Pages checked as a location owner and as super admin: Executive Overview, Dashboard, Call Tracking, Budget Pacing, Sales, the public report link and the monthly report.
- Bob's period totals match the dashboard for one location.
- You get a short report with pass or fail for each location.

## What stays untouched

- The Marketing Ops section
- The GHL-to-CTM form tracking
- Bob's behaviour
- How Google Ads is connected

The only data changes are merging duplicate rename rows. I'll show you the before and after totals before running that.

## Technical notes

- Add a nullable `campaign_id text` column to `daily_metrics` (Google PPC rows) and to `campaign_labels`. The sync selects `campaign.id` (it already queries campaign rows) and writes it on upsert.
- Rename reconciliation runs in `sync-google-ads` after each upsert, scoped to one property and `ad_source = 'Google PPC'`. Old-name rows sharing a `campaign_id` (or matched by identical date and cost on rows from before the ID was stored) merge their lead/CTM columns into the new-name row, and the duplicate rows are deleted. Rows for dates with no new-name row are renamed.
- Backfill `campaign_id` for existing rows by matching name to ID from one campaign listing per account during the next sync.
- `campaignScope.ts` / Budget Pacing label matching prefer `campaign_id` and fall back to the name.
- `CallTracking.tsx`: group with a structured key (a separator that can't appear in names), not `split("|")`.
- Record in AGENTS.md: campaign identity is the Google Ads campaign ID, never the name.
