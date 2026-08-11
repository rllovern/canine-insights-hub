# Volume-aware Location / Portfolio Verdict

## Problem
The verdict compares a raw quality rate against fixed cutoffs (55% green / 45% amber) with only a hard 8-lead floor. With low volume, an 11-day window of 18 leads swings the rate far enough to trip "Critical", and the same location turns amber/green at 30 days. The thresholds don't move with sample size, so noise reads as failure.

## Approach: confidence-based grading, not point-estimate grading
Keep the targets (55% / 45%) exactly as they are. Change what gets compared to them: instead of the raw rate, use a Wilson score interval around the observed rate, plus a light shrink toward the portfolio average for very thin samples.

Grading rule (single source of truth in `src/lib/leadModel.ts`):

- Under 8 leads: unchanged — suppressed, "Low sample".
- Red / Critical only when the sample is strong enough to prove underperformance: the **upper bound** of the 90% Wilson interval is still below the amber target (45%). A location with 10 leads and 44% will not be red, because its upper bound sits well above 45%. A location with 120 leads and 30% still goes red.
- Green when the **point estimate** is at or above 55% and the lower bound is not below the amber target.
- Everything in between is Amber / Warning.
- Between 8 and ~30 leads the card also shows the interval so the number is honest: "44% (range 26–64% at this volume)".

Effect on the screenshot case: Colorado Springs, 18 leads, 44.4% → 90% interval roughly 27–63%. Upper bound is above 45%, so it grades **Warning**, not Critical, at 11 days, and holds a consistent grade when the window expands to 30 days.

## Supporting changes
- Replace the current "Small sample" caveat with a volume tag that states the effective confidence: "18 leads · low confidence", "60 leads · moderate", "150+ leads · high".
- Reword the reason line so it names the evidence, not just the number: "Quality 44.4% (range 27–63% on 18 leads). Not enough volume to call this critical yet."
- Keep the existing 30-day-window hint banner.
- Portfolio (agency) list uses the same graded function, so the rollup counts of critical/warning/good stop flipping with window length.
- The gauge ring uses the same grade, so the color and the word always agree with the reason text.

## Technical detail
- `src/lib/leadModel.ts`: add `wilsonInterval(successes, n, z)` (z = 1.645 for 90%), a `confidenceLabel(n)` helper, and a new `gradeQuality(counts)` returning `{ tier, rate, lower, upper, n, confidence }`. `qualityTier` keeps its signature and delegates, so existing callers stay valid.
- `src/components/command/PortfolioVerdict.tsx`: both the single-location branch and the agency rollup call `gradeQuality` instead of `qualityTier(rate, total)`; reason strings and the caveat pill use the returned interval and confidence.
- No backend, SQL view, or data-model changes. `QUALITY_TARGETS`, `LOW_SAMPLE_BASE`, and the quality-rate math are untouched.
- Add unit tests in `src/lib/__tests__/` covering: 18 leads at 44% → warning; 120 leads at 30% → red; 7 leads → low-sample; 100 leads at 60% → green.

## Out of scope
- Changing the 55/45 targets themselves.
- Any change to how leads are counted or classified.
