# Make the lead numbers say what they mean

## What is actually happening

Nothing is miscalculated. NoVA, Aug 1–16, verified against the database:

```text
Records            88   every call + form that came in
  ├─ no score      35   never scored by call tracking (no entry / not yet processed)
  ├─ spam           8   scored as spam, excluded from quality math
  └─ scored        45   the calls that got a quality outcome
       ├─ bad      15
       ├─ good     25   <- the "Qualified Calls" KPI card
       └─ projected 5
Qualified          30   good + projected  <- the funnel's last stage
Quality rate     66.7%  30 ÷ 45
```

So 88, 45, 30 and 25 are four different populations, each shown with a label that does not say which population it is. "Lead Mix 45 total" reads like 45 leads; "Qualified Leads 30" and "Qualified Calls 25" read like the same thing. And Bob said "45 total leads" — technically the scored base, but the user reasonably heard "you only got 45 leads."

## What changes

1. Funnel loses the invisible drop. Add a fourth, explicit stage between Records and Qualified so the 88 → 45 shrink is on screen instead of hidden:
   `Ad Spend → Records (88) → Scored calls (45) → Qualified (30)`.
   The Scored stage shows "45 of 88 scored" with a hover that breaks out 35 not scored and 8 spam.

2. Rename to end the collisions.
   - KPI card "Qualified Calls" (25) becomes **Good Calls**, subtitle "scored good by call tracking".
   - Funnel stage "Qualified Leads" (30) becomes **Qualified (good + projected)** and shows "30 of 45 scored" instead of the bare "67% quality", with the rate kept in the tooltip.
   - "Lead Mix · 45 total" becomes **Scored mix · 45 scored calls**, with "of 88 records" underneath.
   - Quality Rate tile gets a "30 of 45 scored calls" subline so the denominator is never a guess.

3. Tooltips state the denominator. Every one of the four tiles names its population in the first line: records, scored calls, good, or good + projected.

4. Bob speaks the same words. His instructions get the exact vocabulary and are told to always pair a number with its base — "45 of your 88 records were scored, and 30 of those were qualified" — and never to say "total leads" for the scored base. He gets the records count in the same breath whenever he quotes the scored base or quality rate.

## Technical notes

- No metric math changes and no database changes. `useCommandData` already returns `calls` (records), `totalLeads` (scored base), `good`, `projected`, `bad`, and the RPC already returns `spam`, so the only new value the funnel needs is spam/unscored, which comes through the same totals object.
- Files: `src/components/command/JourneyFunnel.tsx` (new stage, renames, sublines), `src/pages/Command.tsx` (KPI label), `src/components/command/tooltips.ts` (denominator copy), `src/lib/leadModel.ts` (shared label constants so every page uses one vocabulary), `supabase/functions/jarvis/index.ts` (Bob's vocabulary + records-with-scored-base rule).
- The same vocabulary constants get reused by the Call Tracking and source tables so a later page cannot drift back to "leads".
