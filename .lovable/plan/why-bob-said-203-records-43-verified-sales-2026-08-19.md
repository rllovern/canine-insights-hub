# Why Bob said 203 records / 43 verified sales

## What the data says

For RidgesideK9 NoVA, Aug 1–19, the cards are right: **135 records, 96 good leads, 42 verified sales** ($44,960). Confirmed three ways — `v_lead_counts_daily`, `daily_metrics`, and the `ai_assistant_context` function Bob himself calls all return 135/96, and `ghl_opportunities` with status Won dated in-window returns 42.

So 203 and 43 are not a metric-definition disagreement. They came from somewhere else.

## Where the numbers came from

The conversation log shows it exactly:

```text
18:22:17  user       "Are the records coming in good quality?"
18:22:23  tool run   get_lead_performance_report (19 days)
18:22:26  tool run   get_ctm_performance
18:22:29  assistant  (tool-backed, correct)
18:22:47  user       "Should I fire my agency"
18:22:49  assistant  "203 records ... 43 verified sales"   <- 2 seconds, ZERO tool runs
```

The lead-performance payload from the *previous* turn contains `pipeline.stages.new = 203` (CRM contacts entering the pipeline over 19 days) and `showed = 42` / `appointment = 42`. Bob answered the follow-up with no fetch at all, reached back into the earlier turn's payload, and relabelled CRM pipeline counts as "records" and "verified sales".

Two defects, both already visible in the code:

1. **The tool gate only logs.** `jarvis` computes `unbacked = toolRuns === 0 && statesNumbers(text)` and writes `tool_backed: false` to the message row — the answer still ships. The "re-prompt then refuse" step from the earlier plan was never wired.
2. **The lookup trigger misses opinion questions.** `needsFreshData` matches metric words. "Should I fire my agency" contains none, so `toolChoice: "required"` was not applied, and the model was free to answer from conversation memory.

Plus a naming trap: `pipeline.stages.new` reads like "new records" and `showed` sits next to sale language, so stale pipeline counts are easy to mistake for card metrics.

## The fix

1. **Enforce the gate.** In `supabase/functions/jarvis/index.ts`, stop streaming a numeric answer that had zero tool runs in the current turn. If the draft states figures and `ctx.turn.toolRuns === 0`, re-run the model once with `toolChoice: "required"`; if it still returns no tool run, return a plain "let me pull that up" message instead of the figures. Keep persisting `tool_backed` for the Bob Logs view.

2. **Treat advice questions as data questions.** Any question that follows a numeric turn, or that asks for a judgement ("should I", "is it working", "worth it", "fire", "cut", "double down"), requires a fresh lookup. Broaden `DATA_QUESTION_RE` and add the follow-up rule so `toolChoice: "required"` fires.

3. **Fence prior-turn tool output.** Mark tool results from earlier turns as expired in the model context — usable as conversation history, never as a source of a figure in the current answer.

4. **Rename the pipeline stage keys reaching Bob.** `stages.new` becomes `crm_leads_entered_pipeline`, `showed` / `appointment` get an explicit note that they are pipeline positions, not records and not sales — same treatment already applied to `in_sold_type_stage`.

5. **Bind the card vocabulary to its source.** Prompt rule: "records" may only come from the summary context `totals.records`; "verified sales" only from the `verified_sales` block; pipeline stage counts may never be described with either word.

## Verification

Replay the same two-message sequence on NoVA: the follow-up must trigger a tool run and quote 135 records / 42 verified sales, and no assistant row in `ai_agent_messages` may carry `tool_backed = false` with digits in it.

## Technical notes

- All changes in `supabase/functions/jarvis/index.ts`: the `onFinish` gate becomes a pre-return check with one retry, `needsFreshData` broadens, prior-turn tool results get a staleness fence, pipeline keys are renamed, prompt rules tightened.
- No dashboard, view, or metric-definition changes — the cards are already correct.
