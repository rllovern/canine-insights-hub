# Funnel Top-Stage Fix — Records (calls + forms)

The top funnel stage currently sums raw rows from `ctm_calls` and labels them "Calls Received". That count omits forms entirely on some scopes, and on Winchester it lands at 304 because elsewhere we've been folding No Entry on top of the call count. The canonical source for the superset is `public.v_lead_counts_daily.records` — and No Entry / Spam / Bad / Good / AI-projected are slices *inside* Records, never additions.

Quality math, Total Leads, Lead Mix, and the AI-projected tier are correct and will not be touched.

## Changes

### 1. `src/components/command/useCommandData.ts`
- In `fetchWindow`, stop counting `ctm_calls` rows for the funnel's top stage. Pull `records` per day from `v_lead_counts_daily` instead (same scope filter — `property_id in propertyIds`, `date` between from/to).
- Sum `records` into `DailyAgg.calls` so the rest of the surface keeps working without a rename. (Field name stays `calls` internally to minimize blast radius; it now means "Records = calls + forms".)
- Leave `good_leads`, `bad_leads`, `projected_sale`, `verified_sale` exactly as they are — those continue to come from `daily_metrics` and feed the unchanged quality / total-leads / lead-mix math.
- `ctm_calls` query stays only if another surface needs it; if it's only used here, drop it. (Will confirm during implementation with a quick `rg`.)

### 2. `src/components/command/JourneyFunnel.tsx`
- Rename the middle stage from `Calls Received` to `Records`, source label `CTM + Forms`.
- Update the funnel sub-header from `Ad Spend → Calls → Qualified (good + AI-projected)` to `Ad Spend → Records → Qualified (good + AI-projected)`.
- Update the conversion sub-line currently shown on the Qualified node (`{leadsConvPct}% of calls`) to `{leadsConvPct}% of records`.
- No structural / styling changes; still one horizontal row, still three stages.

## Verification

- Winchester scope, current window: top stage should read ≈ 273 (the `records` value in `v_lead_counts_daily` for that scope+window), not 304.
- Lead Mix still reads 97 total = 43 bad + 43 good + 11 AI-projected.
- Quality Rate still reads 55.7%.
- Header text reads `Ad Spend → Records → Qualified (good + AI-projected)`.

## Out of scope (do not touch)

- `qualityRate`, `totalLeads`, `qualityNumerator`, lead-tier definitions in `src/lib/leadModel.ts`.
- Verified Sale / pending treatments.
- KPI tiles, PortfolioVerdict gauge, card chrome.
