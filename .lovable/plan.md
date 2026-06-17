
# Command Page — Presentation Cleanup

Presentation-only. No data model changes. No numbers change. Lead model, tiers, targets, pending states all stay exactly as they are.

## 1. JourneyFunnel — single horizontal row

Rewrite the funnel body so all four stages sit on one baseline, evenly spaced, connected by arrows. No vertical stacking of stages.

Stages in order:

```text
[Ad Spend] → [Calls Received] → [Qualified Leads] → [Verified Sale]
   $xxx           N calls           K (good+AI-proj)        — pending
    100%          conv %              quality %             not piped
```

The Qualified node is one funnel stage that internally shows the parallel split:
- Stage label: "Qualified leads"
- Primary number: `good + projected` (the canonical quality numerator from `leadModel.ts`)
- Sub-line inside the node: `{good} good · {projected} AI-projected` (purple/amber accents preserved from current code)
- Conversion sub-line under the node: quality rate %

Ad Spend conversion line = `100%`. Calls Received line = `calls / calls` or "—". Verified Sale line = "pending".

Implementation: replace the `mt-2 flex items-start gap-1` block in `src/components/command/JourneyFunnel.tsx`. The current `flex-col` wrapper around Good/AI-projected gets removed. New single `Stage`-like node renders the merged "Qualified Leads" tile with a two-line interior:

```tsx
<div className="flex flex-col items-center text-center flex-1">
  <div className="size-9 rounded-full bg-emerald-100 grid place-items-center">
    <Award className="size-4 text-emerald-600" />
  </div>
  <div className="mt-1 text-[10px] font-medium text-slate-600">Qualified Leads</div>
  <div className="text-[13px] font-bold tabular-nums text-slate-900">{good + projected}</div>
  <div className="text-[10px] tabular-nums">
    <span className="text-purple-600">{good} good</span> ·
    <span className="text-amber-600"> {projected} AI-projected</span>
  </div>
  <div className="text-[10px] text-slate-500 mt-0.5">{qualityRatePct.toFixed(1)}% quality</div>
</div>
```

Arrows (`ArrowRight`) sit between every stage including before Qualified and before Verified Sale.

The metric strip below (CPL, CPGL, Quality Rate, Lead Mix) stays exactly as-is — same layout, same numbers, same judged-target rendering. Description line under the title updates to "Ad Spend → Calls → Qualified (good + AI-projected) → Verified (pending)".

## 2. PortfolioVerdict (location mode) — ring gauge

Replace the dot-and-word treatment in the `mode !== "agency"` branch of `src/components/command/PortfolioVerdict.tsx` with a filled SVG ring gauge.

Layout: two-column inside the card — gauge on the left, verdict + reason on the right.

Gauge:
- Pure SVG, ~120px circle, 12px stroke width, rounded caps
- Track: `stroke-slate-100`
- Fill: arc covering `qualityRate` portion of the circle, colored by tier (`emerald-500` / `amber-500` / `rose-500`); low-sample renders a dashed slate track with no fill
- Center: integer score = `Math.round(qualityRate * 100)`, font size 32, weight 500, plus a small `/100` underneath in slate-400
- Below the center: tiny tier word ("Good"/"Warning"/"Critical") in tier color

Right column:
- `{label}` (scope name) in slate-900 semibold
- Verdict reason sentence from the existing `locationVerdict()` helper (already produces the right copy — keep as-is)
- A small target line: `Target ≥55% · Winchester benchmark 60%`

Agency mode (the rollup list) is untouched — that's a different surface and the spec only calls out the single-location verdict.

No revenue, no dollars, no "capture score" wording.

## 3. AI-Projected KPI tile — chrome parity

All four top KPI tiles already render via `KpiSparkCard`, so structurally they are siblings. The visual mismatch the user is seeing is from the sparkline shape (projected_sale series is sparse with occasional spikes, producing a jagged silhouette).

Fixes inside `KpiSparkCard`:
- Smooth sparse series: use `type="monotone"` (already) but add `connectNulls` and clamp the Y domain to `[0, max]` so single-point spikes don't dominate
- Reduce stroke from 1.5 → 1.25 and gradient opacity from 0.35 → 0.18 so dense/sparse series read the same weight
- Ensure identical card height by enforcing `min-h-[112px]` on the card root

No structural divergence between tiles; all four use the same component with the same props shape.

## 4. Global card language

Audit pass — all cards on `/command` already use `rounded-2xl bg-white border border-slate-200/70 shadow-sm` and `p-3` headers. Lock that into a single Tailwind class constant `CARD_CHROME` exported from `src/components/command/tooltips.ts` (or a new `cardChrome.ts`) and replace inline duplicates in:

- `JourneyFunnel.tsx`
- `PortfolioVerdict.tsx`
- `PerformanceCards.tsx` (all three pending cards)
- `TopOpportunities.tsx` (root container)
- `KpiSparkCard.tsx`

This guarantees identical chrome, padding, and shadow across every tile. Pending cards keep their honest "pending" inner state but live in the same chrome.

## What does NOT change

- Lead model (`total = bad + good + AI-projected`, `quality = (good + AI-proj) / total`, 55/45 tiers, Winchester 60% benchmark, low-sample <25)
- Any number on the page
- Pending state copy on Verified Sale and the three performance cards
- Parallel (non-nested) relationship of good vs AI-projected — both numbers live side by side inside the single Qualified node, neither nested under the other
- Page header, scope/date controls, top KPI tile order, section order

## Files touched

- `src/components/command/JourneyFunnel.tsx` — single-row layout, merged Qualified node
- `src/components/command/PortfolioVerdict.tsx` — ring gauge for the location-mode branch only
- `src/components/command/KpiSparkCard.tsx` — sparkline normalization, min-height
- `src/components/command/PerformanceCards.tsx` — adopt shared chrome constant
- `src/components/command/TopOpportunities.tsx` — adopt shared chrome constant
- `src/components/command/cardChrome.ts` *(new)* — single `CARD_CHROME` Tailwind class string

## Verification after build

- Visual screenshot of `/command` at 1504px: funnel is one horizontal row, four stages, three arrows, no stage drops below the baseline
- Location verdict shows a filled ring with "86" centered, green fill, reason sentence to the right
- All four top KPI tiles look like siblings (same height, same sparkline weight)
- All cards share identical border/shadow/radius/padding
