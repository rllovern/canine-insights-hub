# Simplify the Location Verdict card

Strip the card down to the verdict and the numbers that matter. Everything explanatory moves into the info-icon tooltip.

## What the card shows after

```text
Location Verdict            (i)      [low confidence]

   ( 44 )   RidgesideK9 Colorado Springs
   /100     Quality 44.4%  ·  Target ≥30%
   GOOD     18 leads · 8 qualified · 6 verified sales
```

- Gauge and GOOD/WARNING/CRITICAL word: unchanged.
- One headline line: quality rate next to the target, nothing else.
- One stat line: leads, qualified calls, verified sales.
- Removed from the face of the card: the long sentence explaining what clears which threshold, the "Mix: X bad · Y good · Z projected-sale calls" breakdown, the portfolio-average footnote, and the blue 30-day window banner.
- The confidence chip ("low confidence") stays top-right, since it is a one-word signal, and the confidence range is shown only as a small "±" suffix on the rate when the sample is thin.

## What moves into the (i) tooltip

The tooltip becomes the full explanation, in order:
1. How the quality rate is computed and the green/amber thresholds.
2. The mix breakdown for the current window (bad / good / projected-sale calls) and the note that projected-sale calls are call-scoring, not closed deals.
3. Portfolio average for the current scope.
4. The 30-day window guidance, shown only when the window is short or the sample is thin.

## Technical notes

- All edits are in `src/components/command/PortfolioVerdict.tsx` (single-location branch, roughly lines 200-235).
- `locationVerdict()` gets split: it keeps returning the tier/verdict, but the long `reason` string is repurposed as tooltip content rather than card body text.
- Tooltip content becomes a small composed node instead of the static `TIPS.portfolioVerdict` string for this card, so it can include live numbers. The multi-location Portfolio Verdict card keeps the existing static tip and is otherwise unchanged.
- No changes to grading math, thresholds, Wilson interval, or data fetching.
