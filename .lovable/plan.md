# Lower the quality benchmark to 30% and surface sales / qualified calls

## What changes

### 1. New thresholds
The quality-rate benchmark moves from 55% green / 45% amber to **30% green / 25% amber**. Under the volume-aware grading already in place:

- 30%+ → Good
- 25–30% → Warning
- Below 25%, and the sample is large enough to prove it → Critical
- Under 8 leads → still suppressed as Low sample

Colorado Springs at 44.4% (8 of 18) becomes **Good** instead of Critical, and stays Good as the window widens.

These are defined once in `QUALITY_TARGETS`, so every surface that reads them updates together: Location Verdict, Portfolio Verdict rollup, Journey Funnel target line, and Top Opportunities gap math ("~N more quality leads to hit target").

### 2. Verified sales and qualified calls as context
The Location Verdict card gains a compact context line under the reason text showing the window's raw counts:

```text
18 leads · 8 qualified calls · 0 verified sales
```

These are display only — they do not change the grade, the ring color, or the alert state. When verified sales is zero but qualified calls exist, the line reads "0 verified sales recorded" so the absence is explicit rather than looking like missing data.

### 3. Copy alignment
The target footnote and the portfolio summary sentence pick up the new numbers automatically ("Target ≥30% · Portfolio avg …"). The reason sentences keep the same structure, referencing the 25% floor and the 30% target.

## Technical detail
- `src/lib/leadModel.ts`: `QUALITY_TARGETS` becomes `{ green: 0.30, amber: 0.25 }`. No other math changes; `gradeQuality` and the Wilson interval logic are untouched.
- `src/components/command/PortfolioVerdict.tsx`: add the context line in the single-location branch using `totals.qualifiedCalls`, `totals.sales`, and `grade.n`, rendered in the existing muted footnote style.
- `src/lib/__tests__/qualityGrade.test.ts`: update expectations for the new thresholds — 8/18 → green; a low-rate high-volume case (e.g. 15% on 120 leads) → red; 27% on 100 leads → amber; 7 leads → low-sample.
- No backend, SQL view, or RPC changes; the SQL rollups return raw counts and do not encode the thresholds.

## Out of scope
- Making sales or qualified calls a graded factor in the verdict.
- Changing how leads, qualified calls, or verified sales are counted.
