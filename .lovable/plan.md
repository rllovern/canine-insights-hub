# Bob: location-aware prompts, no year-over-year, cheerleader tone

## 1. Rotating quick questions per location
Today the four chips under Bob are hardcoded and one of them is "How am I doing vs last year?".

Replace with a location-aware, rotating set:
- Chips are built from the currently selected location (or "all locations" in agency scope) and the active date range, so the wording names the place: e.g. "How is Winchester doing this month?".
- Draw from a pool of ~10 question templates grouped by theme (volume, quality, spend/budget, sales, what changed vs last month, what should I watch). Pick 4 per render, seeded by location + day so they rotate but stay stable while the drawer is open.
- Templates adapt to what the location actually has: skip CRM/sales questions for locations with no CRM connected, skip ad-spend questions if that location has no ads feed.
- Same treatment for the ⌘K command bar quick list (drop its "vs last year" entry, reuse the same pool).

## 2. Remove year-over-year everywhere
- Delete the "vs last year" chips.
- In Bob's backend instructions: comparisons are month-over-month (this month to date vs the same span last month) or the previous same-length window. Year-over-year is never offered, and if a user asks for it, Bob answers with the month-over-month view and says plainly that year-ago comparisons aren't a fair read for this business.
- Stop feeding the last-year window into Bob's diagnosis lookups so he can't quote it; keep prior-window and last-6-months trend.

## 3. Cheerleader with honesty
Add a tone section to Bob's instructions:
- Always on the client's and the team's side. Decisions already made get backed up, not second-guessed.
- Dips are stated plainly and first — never buried, never spun into a non-event.
- The explanation then points at demand-side causes he can actually see or reasonably attribute: buying behavior, longer decision windows, seasonal timing, softer intent this month, shoppers comparing more before calling, macro spending pressure on high-ticket services.
- The framing relieves pressure on the agency without ever contradicting a measured number: spend, clicks, impressions, and stale feeds are facts and are never explained away.
- Ends forward-looking: what to watch next month, and route to the admin team when it is a real problem.

## Technical notes
- `src/components/bob/BobChat.tsx` — replace `QUICK_PROMPTS` constant with a `useMemo` over a new `src/components/bob/quickPrompts.ts` helper taking scope/location/capabilities.
- `src/components/bob/BobCommandBar.tsx` — consume the same helper.
- `supabase/functions/jarvis/index.ts` — edit `SYSTEM_PROMPT` (diagnose step 1, comparison rules, new TONE section), and drop `last_year_same_period` from `diagnose_leads` / `get_trend_windows`; redeploy.
