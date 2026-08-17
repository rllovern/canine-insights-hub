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
       └─ projected 5   <- being retired (see below)
Qualified          30   good + projected  <- the funnel's last stage
Quality rate     66.7%  30 ÷ 45
```

88, 45, 30 and 25 are four different populations, each labeled in a way that does not say which population it is. "Lead Mix 45 total" reads like 45 leads; "Qualified Leads 30" and "Qualified Calls 25" read like the same thing. Bob said "45 total leads" — the scored base — and the user reasonably heard "you only got 45 leads."

## Retire projected-sale

Projected-sale was an AI guess standing in for sales we could not see. We have real CRM wins now, so the guess comes out of every number a user reads:

- Qualified becomes **good only** — 25 for this window, not 30. That alone removes one of the four competing values, because it now equals the KPI card.
- Quality rate becomes good ÷ scored calls: 25 ÷ 45 = 55.6%, down from 66.7%. This is a real, visible drop on every location. It is the honest number and the 30% target still applies.
- CPGL becomes spend ÷ good. Scored mix becomes two slices, bad and good.
- Verified Sale (CRM wins) is untouched — its own card, its own timestamp, never folded into quality.
- `daily_metrics.projected_sale` keeps syncing and stays in the database; no surface reads it. Nothing is deleted, so it can come back if ever wanted.

## What changes on screen

1. Funnel loses the invisible drop. Add a fourth, explicit stage between Records and Qualified so the 88 → 45 shrink is on screen instead of hidden:
   `Ad Spend → Records (88) → Scored calls (45) → Good (25)`.
   The Scored stage shows "45 of 88 scored" with a hover that breaks out 35 not scored and 8 spam.

2. Rename to end the collisions.
   - KPI card "Qualified Calls" becomes **Good Calls** (25), subtitle "scored good by call tracking".
   - Funnel stage "Qualified Leads" becomes **Good Calls** and shows "25 of 45 scored" instead of the bare "67% quality", with the rate kept in the tooltip.
   - "Lead Mix · 45 total" becomes **Scored mix · 45 scored calls**, with "of 88 records" underneath and a bad/good split.
   - Quality Rate tile gets a "25 of 45 scored calls" subline so the denominator is never a guess.

3. Tooltips state the denominator. Each tile names its population in the first line: records, scored calls, good, or CRM wins.

4. Bob speaks the same words. His instructions get the exact vocabulary, are told to always pair a number with its base ("45 of your 88 records were scored, and 25 of those were good"), never to say "total leads" for the scored base, and never to mention projected sales again — for anything about actual sales he cites Verified Sale.

## Technical notes

- `src/lib/leadModel.ts` is the single lever: `qualityNumerator` drops `projected`, and shared label constants replace the ad-hoc strings. Every page already routes through it, so quality rate, tiers and Wilson grading follow automatically.
- Surfaces to strip the projected column/slice from: `JourneyFunnel.tsx`, `Command.tsx`, `CallTracking.tsx`, `PortfolioVerdict.tsx`, `TopOpportunities.tsx`, `Dashboard.tsx`, `SaleRecords.tsx`, `tooltips.ts`, `property-labels.ts`, and the `jarvis` edge function.
- `src/lib/__tests__/qualityGrade.test.ts` gets updated to the good-only numerator.
- No database or sync changes; `daily_metrics.projected_sale` keeps populating.
