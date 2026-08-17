# Bob: silent no-answer + hide the tool cards

## What I found

Your "Why are my leads down?" turn did run — the gateway shows six successful model calls between 03:45:42 and 03:46:26, all HTTP 200, the last one returning 174 tokens. The AI itself was fine.

What went wrong is on our side:

- The backend worker restarted **three times** during that single question (03:45:39, 03:45:56, 03:46:22), and the final POST never completed — only the preflight is recorded as finished. The stream was cut before Bob's answer reached the screen, so the UI just stopped with no message and no error.
- The restarts happen because one question fans out into many heavy lookups. Bob's instructions tell him to check the current window, the prior window, last year, the trailing twelve months, ad spend, click-through rate, call volume, lead quality and feed freshness — that became six model round-trips and five separate data tools in a row, and the worker gets recycled before the last step lands.
- Separately, the browser is stuck in a render loop (the session-history popover in Bob's header keeps re-rendering), which adds to the stall.

## The fix

**1. One lookup instead of five for the common questions**

Add a single `diagnose_leads` lookup that gathers, in one parallel batch, everything the "why are my leads down" answer needs: current window, prior window, same period last year, trailing months, ad spend and click-through, call volume, quality mix and feed freshness. Bob calls it once and answers. Same idea for "is my ad spend working" (one spend-and-pacing lookup). That takes the turn from six model round-trips to two, well inside the worker's budget.

Update Bob's instructions to use these single lookups first and to stop chaining a long list of separate checks.

**2. Never end a turn silently**

If the stream closes with no answer text, the chat shows a clear "That one got cut off — tap to retry" bubble with a retry button, instead of nothing. Same treatment when the worker dies mid-lookup.

**3. Hide the tool cards**

Bob's messages will show only the answer. No `get_source_health` / `compare_periods` / `get_ctm_performance` cards. While he's working, all you see is the typing dots plus a single "thinking" line in the header — no per-lookup labels either, since you asked for thinking and that's it.

**4. Fix the render loop**

Move the session-history popover out of the header's re-rendering path so the "Maximum update depth exceeded" loop stops.

## Technical notes

- `supabase/functions/jarvis/index.ts`: new `diagnose_leads` and `diagnose_ad_spend` tools that `Promise.all` the RPCs already used by `compare_periods`, `get_trend_windows`, `get_google_ads_performance`, `get_ctm_performance` and `get_source_health`, returning totals-only payloads; system prompt updated to prefer them; `stopWhen` lowered to `stepCountIs(8)` with a final-step nudge so the model always closes with prose.
- `src/components/bob/BobChat.tsx`: drop the `Tool`/`ToolHeader`/`ToolContent` rendering from the message map; revert the header line to the plain thinking status; add an empty-response guard that renders a retry bubble when a finished assistant message has no text part; stabilise the history `Popover` so it no longer sets state during render.