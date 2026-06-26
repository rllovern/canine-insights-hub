Add a 3-tier color scale for cost-style KPIs (Blended CPL, Blended CPGL, and the Ads variants when judged):

- Green: at or below target
- Amber: above target but within 35% over (e.g. target $200 → up to $270)
- Red: more than 35% above target

Implementation:
1. In `src/components/command/JourneyFunnel.tsx`, extend `SubKpi` to compute a tier from numeric value vs target when the metric is `invert` (cost). Replace the binary `pass` color with `text-emerald-600 / text-amber-600 / text-rose-600`.
2. Pass the raw numeric `cpl` / `cpgl` to `SubKpi` so it can compute the tier; keep the existing `target` value.
3. Update the tooltip to show the matching tier label (On target / Slightly over / Over target) with the same color.
4. Leave Quality Rate untouched (already tiered via `qualityTier`).