## Goal
Replace AI-projected with verified sale on **both** sides of the Quality Rate formula across Command surfaces.

New formula:
**Quality = (good + verified_sale) ÷ (bad + good + verified_sale)**

Total Leads denominator in the rest of the canonical lead model (funnel base, KPIs, etc.) stays unchanged — this swap only affects the **Quality Rate** numerator/denominator pair.

## Changes

### 1. `src/lib/leadModel.ts`
- Extend `LeadCounts` (or add a sibling helper) with `verified` so the math is shared, not duplicated per component.
- Add `commandQualityRate(c)` = `(good + verified) / (bad + good + verified)` returning `0` when the new base is `0`.
- Add `commandQualityBase(c)` = `bad + good + verified` so tier checks (`qualityTier(rate, base)`) use the matching base for the low-sample floor (still 8).
- Keep existing `qualityRate` / `qualityNumerator` untouched so non-Command surfaces (Performance Report, Assistant, SQL rollups) are not affected.

### 2. `src/components/command/PortfolioVerdict.tsx`
- `locationVerdict`: compute `verified = totals.revenue`, then `localRate = commandQualityRate({ ...counts, verified })` and `base = commandQualityBase(...)`. Pass `base` to `qualityTier` and to the low-sample / provisional copy (so "X leads in window" reflects the new base).
- Per-location ranking loop (~line 162): same swap — use the new rate + base for tier and sort.
- Ring gauge value + center label: driven by the same `localRate`.
- Reason strings: update "Mix: bad · good · verified sale" stays, but the "X leads" figure now refers to the new base. Tooltip copy should say "Quality = (good + verified) ÷ (bad + good + verified)".

### 3. `src/components/command/JourneyFunnel.tsx`
- `qualityCount` stays `good + verified`.
- Replace `localQualityRate = qualityCount / t.totalLeads` with `commandQualityRate(...)` and use `commandQualityBase(...)` for `qualityTier` + the "X% quality" label inside `QualifiedStage`.
- Tooltip (`TIPS.qualityRate` or inline copy) updated to the new definition.
- The **funnel stages themselves** (Records → Leads → Qualified) are not re-shaped; only the Quality % tile and its tier coloring change.

### 4. Portfolio benchmark query (inside `PortfolioVerdict.tsx`)
- The aggregate that powers "portfolio avg" must use the same formula: sum `good + verified_sale` over sum `bad + good + verified_sale` across the scoped properties/date range/mode.
- Keep the Ads-vs-Business mode filter as-is.

### 5. Scope
- Owner view and Bob/Viewer view both pick this up automatically because they share `PortfolioVerdict` + `JourneyFunnel`.
- No change to Performance Report, CallTracking, Dashboard KPIs, sync functions, or SQL views/RPCs.

## Verification
- Read the current 30-day numbers for the Ashtabula property and the portfolio, recompute by hand under the new formula, and confirm the ring + funnel tile match.
- Spot-check a low-sample location to confirm the provisional/low-sample message uses the new base count.
- Confirm tier coloring (≥55 green, 45–54 amber, <45 red) still applies and that the portfolio benchmark line moves with the new formula.