## Goal
On the performance report's **Actions** KPI row, replace the **AI-Projected** tile with **Verified Sale**. Keep the same card chrome, delta logic, and per-property hide config. No other surfaces touched (Command, Lead Performance, canonical lead model, source/campaign tables all unchanged).

## Change
In `src/pages/Dashboard.tsx`, both `ActionsHeader` and `ActionsKpis`:

- Change the metric order array from
  `["leads", "good_leads", "projected_sale"]`
  to
  `["leads", "good_leads", "verified_sale"]`.

`verified_sale` already exists as a `MetricKey` with label "Verified Sale" in `src/lib/property-labels.ts` and is already present on the `totals` / `prev` row objects, so `KpiCard` value + delta render correctly with no other wiring.

## Result
The third tile in the Actions row shows **VERIFIED SALE** (CTM `sale.conversion` count) instead of AI-Projected, with the same percent delta vs the prior period. Header subtitle auto-updates to "By Total Leads, Good Leads, Verified Sale".
