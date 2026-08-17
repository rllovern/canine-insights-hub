# Fix: Bob invented numbers for Central IL

## What actually happened

The database is fine. For Ridgeside K9 Central IL, Aug 1–17, the real figures are **19 records, 17 scored calls, 14 good calls** — exactly what the cards show.

Bob said "47 records, 35 scored, 21 good, 60% quality." Those numbers exist nowhere: not for Central IL, not for any other location, not for the portfolio.

The transcript log shows why. The user asked "How is Central Illinois' performance this month?" at 05:03:49 and Bob answered at 05:03:52 — **three seconds later, with no tool call at all**. The last tool call in that session ran at 05:02:40 and was a lead-performance report for *Winchester*. Bob carried the earlier Winchester conversation forward, swapped in the new location name, and made up plausible-looking numbers to fill the sentence.

So this is not a reconciliation bug in a metric definition. It is Bob answering a data question without fetching data.

## The fix

Make it structurally impossible for Bob to state a number he did not just fetch.

1. **Hard tool gate.** In the `jarvis` edge function, track whether any data tool ran during the current turn. If the model produces a final answer containing digits/metric words with zero tool runs in that turn, do not return it — re-prompt the model once with an explicit instruction to call the tool first, and if it still returns nothing, reply with a plain "let me pull that up" failure rather than invented figures.

2. **Location-change invalidation.** When the resolved location for the current question differs from the location of the previous turn's tool runs, mark all prior tool results in context as stale and require a fresh fetch. Prior-turn tool output is currently visible to the model as ordinary conversation text with no location fence on it, which is how Winchester's shape leaked into a Central IL answer.

3. **Tool results become the only numeric source.** Strengthen the system prompt: every figure Bob states must be traceable to a tool result in the current turn; if a tool returned nothing or errored, say so plainly instead of estimating, rounding from memory, or inferring from a previous location.

4. **Self-consistency is not evidence.** Bob's fabricated set was internally consistent (21/35 = 60%), which is exactly why it read as credible. Add an instruction that internal arithmetic never substitutes for a fetch.

5. **Logging.** Record on each assistant message whether it was backed by a tool run, so the Bob Logs admin view can surface any answer that quoted numbers without one. This gives an ongoing check rather than relying on someone spotting a mismatch.

## Technical notes

- `supabase/functions/jarvis/index.ts` — per-turn tool-run counter, location fence on carried context, retry-then-refuse path, prompt hardening.
- `ai_agent_messages` — flag for tool-backed vs unbacked answers; surfaced in `src/pages/admin/BobLogs.tsx`.
- No metric definitions, views, or dashboard code change. `v_lead_counts_daily` and the card filters already agree.

## Not included

Per your note, the speed-to-lead / sales-team restriction is dropped — Bob keeps that access as-is.
