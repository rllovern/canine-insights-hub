# Bob's "10 verified sales" for Central IL — cause and fix

## What happened

Bob did not invent the number. He fetched it, then mislabeled it.

His one tool call (`get_client_summary_context`, 30 days, Central IL) returned a pipeline block containing `"won": 10`. He turned that into the sentence "10 verified sales move into the won column in your system during this window."

Those 10 records are real, but they are not sales:

- All 10 are opportunities whose **current pipeline stage** is "Sold (Waiting)" or "Sold (Ready)".
- In GoHighLevel, all 10 still have **status = open**, **$0 value**, and **no won date**.

So the pipeline tool counts "sitting in a Sold-named stage" as won. The dashboard cards count only what GHL itself marks Won. For Central IL in the last 30 days the cards are correct: **0 wons, $0**. The most recent real wons are 1 in May and 3 in April.

Bob is wrong. The cards are right.

## Why the two disagree

There are two independent definitions of "won" in the system:

```text
Cards / Sales pages ->  ghl_opportunities.status = 'won'   -> 0 in last 30 days
Bob's pipeline tool ->  stage mapped to canonical 'won'    -> 10
```

Central IL's stage mapping marks four stages as won (Sold, Sold (Send to Trainers), Sold (Waiting), Sold (Ready)), and none of those mappings has been confirmed by a human — the tool output even carries `needs_mapping: true`, which Bob ignored. The Central IL team appears to move the card to a Sold stage without ever marking the opportunity Won in GHL, so the two numbers will keep diverging.

## The fix

1. **Stop the word collision in the tool payload.** In the summary context Bob receives, the stage-based figure stops being called `won`. It is renamed to something that cannot be read as a sale (stage occupancy: "currently sitting in a Sold-type stage"), and is emitted alongside the count of those that GHL has *not* marked Won.

2. **Give Bob the card number in the same payload.** Add an authoritative `verified_sales` block sourced exactly as the cards source it — `status = 'won'` with `won_at` inside the window, plus realized revenue. This is the only field Bob may describe as a sale.

3. **Prompt rule.** Bob may state a sales/won/revenue figure only from the `verified_sales` block. Stage occupancy may be described as pipeline position ("ten people are sitting in a Sold stage") and never as sales, wins, revenue, or "moved into won." If the two disagree, he says so plainly rather than picking the bigger number.

4. **Surface the mapping caveat.** When `needs_mapping` is true or stage-won exceeds GHL-won, Bob must add one plain sentence: the stages say Sold but GHL has not marked them Won, so the sale is not confirmed in the system.

5. **Flag it as a real operational gap, not just a display bug.** Ten Central IL opportunities are in a Sold stage with status still open and $0 — that is why Central IL looks like it has no sales. Add these to the data-quality rail as "Sold in stage, not marked Won in GHL" so someone can correct them at the source. No numbers are changed on our side; we keep mirroring GHL.

## Technical notes

- `supabase/functions/jarvis/index.ts` — rename the pipeline `won` key in the tool response, add the `verified_sales` block (mirrors the card query on `ghl_opportunities`), tighten the system prompt with rules 3 and 4.
- `lead_perf_pipeline` keeps its existing stage semantics for the Lead Performance page; only the label reaching Bob changes, so no dashboard math moves.
- No change to card definitions — they already match GHL.

## Not included

Confirming Central IL's stage mapping or reclassifying "Sold (Waiting)" as not-won. That is a data decision for you; tell me if you want those stages to stop counting as canonical won on the Lead Performance page.
