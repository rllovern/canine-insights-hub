# Why Bob is slow — and how to fix it

## What the logs actually show

For your 03:39 question, Bob's backend did this:

- 2 model calls: 1.5s + 3.2s = ~4.7s
- 2 data lookups: `get_source_health` 80ms, `get_trend_windows` 350ms
- plus request setup: 7 separate permission checks, a session write and a message write

That turn was roughly 7-9 seconds end to end, and none of it showed on screen until the very end — you watched three grey dots the whole time. That is the main problem: not raw speed, but zero visible progress.

There is also a real blow-up risk that earlier runs already hit:

- `get_trend_windows` runs 7 lookups in parallel **plus 12 more one at a time**, one per month. It has measured up to 1.95s on its own.
- In "All locations" scope the instructions tell Bob to run the per-location tools **once per location** — 7 locations. That turns one 2-second tool into roughly 14 seconds of lookups plus an extra model round-trip per location. That is the "forever" case.

## The fix

### 1. Show progress instead of dots (biggest perceived win)

- Stream a live status line under Bob's name while he works: "Checking your call data…", "Comparing this month to last month…", driven by the tool calls that already stream back.
- Have Bob open with a one-line acknowledgement before he runs any lookups, so text appears in about a second instead of only after every lookup finishes.
- Show each lookup as a small collapsed chip as it starts, not only once it completes.

### 2. Make the slow tool fast

- Run the trailing-12-month lookups in parallel instead of one after another (12 sequential round-trips today).
- Trim what `get_trend_windows` returns: comparison windows plus monthly totals, not the full context payload for every month. Less data also means fewer input tokens, which shortens the model call itself.

### 3. Stop the all-locations fan-out

- For trend questions in "All locations" scope, run one roll-up pass instead of the full per-location tool set: fetch the per-location numbers in a single batched call and hand Bob one table.
- Cap how many locations Bob deep-dives in one turn (top movers only) and have him ask which location to dig into rather than sweeping all seven.

### 4. Shave the request setup

- Replace the 7 individual permission checks per request with one query returning the accessible locations.
- Write the session/message rows without blocking the start of the model call.

## Technical notes

- `supabase/functions/jarvis/index.ts`: parallelise the monthly loop in `get_trend_windows` and slim its return shape; replace the per-property `user_can_access_property` loop with a single accessible-properties query; add a roll-up tool (`get_portfolio_trend`) so all-locations questions are one call; update the scope rules in the system prompt to prefer it and to lead with a one-line acknowledgement before tool use.
- `src/components/bob/BobChat.tsx` and `BobDrawer.tsx`: derive a live status string from the streaming tool parts and show it in the header and in place of the plain typing dots.
- No schema changes and no change to any metric definition.