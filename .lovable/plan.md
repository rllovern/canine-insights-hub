## Hide the "low n" tag

Remove the visible `low n` annotation on KPI tiles and funnel deltas. Underlying logic (`safeDelta` returning `low-sample`) stays — we just render the raw absolute change without the badge.

### Files
- `src/components/command/KpiSparkCard.tsx` (line ~59): drop the `<span>low n</span>`, keep the `+N` absolute change.
- `src/components/command/JourneyFunnel.tsx` (line ~321): same treatment.

### Not touched
- `safeDelta` / `LOW_SAMPLE_BASE` thresholds.
- Portfolio Verdict "Low sample" reason text (that's a separate concept about quality-rate reliability, not a delta badge).