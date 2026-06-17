
# Ads mode: use actual PPC spend over the active date range

The current Ads view ignores the date picker for spend and shows a fabricated "estimated 30-day" number. We have real daily PPC spend in `daily_metrics`, so the toggle should use it directly — same date range as every other card.

## Changes

1. **`useCommandData.ts`**
   - Remove `fetchPpcMtdSpend`, the elapsed-fraction math, and the `spendIsEstimated` / `spendMethod` / `spendMtd` / `elapsedFraction` fields on `adsCurrent` / `adsPrior`.
   - `adsCurrent` / `adsPrior` become a plain `Totals` built from `fetchPpcWindow(propertyIds, iso.from, iso.to)` — actual PPC spend, records, good, bad, projected, AI-projected for whatever range the top date picker is on. Same for prior.
   - Drop the third extra query; only the two PPC window queries remain.

2. **`Command.tsx`**
   - Drop the `estimated` and `methodNote` props on the Ad Spend tile (the KpiSparkCard props themselves stay — still useful elsewhere — they just go unused here).
   - Rename the Ad Spend tile from "Ad Spend (Google PPC, est. 30-day)" to **"Ad Spend (Google PPC)"**.
   - Page subtitle in Ads mode: drop "est." — just `Ads view (Google PPC only)`.

3. **`JourneyFunnel.tsx`**
   - Funnel title in Ads mode: `Customer Journey Funnel · Ads (Google PPC)` (unchanged).
   - Funnel sub-header in Ads mode: `PPC Spend → PPC Records → PPC Qualified (good + AI-projected)` (drop "est. 30-day").
   - First stage label: `PPC Spend` (drop "(est.)").
   - First stage source tooltip: `daily_metrics.cost · Google PPC` (drop the MTD/elapsed line).
   - Bottom-right footnote in Ads mode: drop `Estimates ±15% directional`.

4. **`tooltips.ts`**
   - Replace `adSpendEst` with `adSpend`: "Google PPC spend over the selected date range. Source: daily_metrics.cost where ad_source = 'Google PPC'."
   - Update `adCpl` / `adCpgl` tooltips to drop "est. 30-day" wording — they're just `PPC spend ÷ …` over the active window.

5. **No DB changes. No date-range plumbing changes.** The top date toggle already drives `useCommandData(propertyIds, range, …)`; we just stop overriding spend with MTD.

## Verification

- Set top date range to "This month" with NoVA scope → Ad Spend tile shows the actual MTD PPC spend (not the $16,499 extrapolated value), and Ad CPL / Ad CPGL recompute from that real spend ÷ PPC leads in the same window.
- Switch date range to "Last 30 days" → all four tiles, funnel sub-KPIs, and Media Efficiency Ratio update together (no card stuck on a different window).
- `est.` chip and method tooltip are gone from the Ad Spend tile.
- Business mode is unchanged.

## Out of scope

- No changes to PortfolioVerdict, PerformanceCards, TopOpportunities (already respect the date range).
- No new RPC, no schema work, no Winchester benchmark changes (the $338 reference line under Ad CPGL stays).
