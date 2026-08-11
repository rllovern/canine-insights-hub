# Fix Qualified Leads coloring in the journey funnel

The "Qualified Leads" stage currently turns red whenever bad calls outnumber good calls — it ignores the quality target entirely. With 8 qualified out of 18 (44%, above the 30% benchmark), it should read as healthy, not red.

## Changes

1. **Qualified Leads stage color** — grade by quality rate against the shared targets instead of good-vs-bad counts:
   - ≥ 30% (green target) → green
   - 25–30% → amber
   - < 25% → red
   - Below the low-sample base, or no base → neutral slate (no judgment)
2. **Lead Mix tile** — replace its separate hardcoded "good share ≥ 20%" benchmark with the same 30% / 25% target bands so the two tiles can't disagree, and use amber rather than red for the near-miss band. Tooltip text updates to match.

## Technical details

- In `src/components/command/JourneyFunnel.tsx`, use the existing `qualityTier(rate, base)` from `src/lib/leadModel.ts` (which already encodes `QUALITY_TARGETS` green 0.30 / amber 0.25 and `LOW_SAMPLE_BASE`) to drive the number class in `QualifiedStage` and `LeadMix`, mapping green/amber/red/low-sample to the semantic success / warning / destructive / muted tokens.
- `QualifiedStage` needs the quality rate and its base (total leads) passed through; it already receives `qualityRatePct` and `hasBase`, so add the lead base for the low-sample check.
- No metric math changes — this is presentation only.
