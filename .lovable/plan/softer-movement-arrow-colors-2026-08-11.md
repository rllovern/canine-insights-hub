# Softer movement-arrow colors

Right now any adverse movement — even 1% — renders red, which reads like an emergency to a location owner. We will introduce a shared severity rule so small adverse moves are amber and only large ones are red.

## The rule

For every directional arrow / delta chip on the site:

- Favorable movement (up for good metrics, down for cost-type metrics): green
- Flat / negligible movement (within a small dead band): grey
- Adverse movement under 40%: amber (caution)
- Adverse movement of 40% or more: red

The 40% threshold is on the percent change magnitude. Where a delta is shown as a raw count instead of a percent (low-sample cases), the adverse direction renders amber, since we can't establish a reliable percent — red is reserved for confirmed large percent drops.

Metrics where "down is good" (e.g. cost, cost per lead) keep their existing invert behavior; the amber/red split applies to whichever direction is the bad one for that metric.

## Technical details

- Add a single helper in `src/lib/metrics.ts`, e.g. `deltaTone(pctChange, { invert })` returning `"good" | "caution" | "bad" | "neutral"`, plus a matching class map (green / amber / red / muted) using existing semantic tokens.
- Repoint every place that currently hardcodes green-vs-red arrows to that helper:
  - `src/components/ui/Delta.tsx`
  - `src/components/command/KpiSparkCard.tsx` (both the `pct` and `low-sample` branches)
  - `src/components/command/PerformanceCards.tsx`
  - `src/components/command/JourneyFunnel.tsx` (the two delta chips at lines ~328 and ~336 only — the tier/pass-fail colors below stay as-is)
  - `src/components/data/KPICard.tsx`, `src/components/data/PropertyOverview.tsx`, `src/components/dashboard/KpiCard.tsx`
  - `src/pages/Dashboard.tsx`, `src/pages/CallTracking.tsx`, `src/pages/Keywords.tsx`
  - `src/components/jarvis/report/ReportView.tsx` direction arrow (its severity badges stay unchanged)
- Non-delta colorings (pass/fail tiers, verdict grades, alert badges) are out of scope and remain untouched.
