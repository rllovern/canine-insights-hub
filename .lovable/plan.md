# Executive Overview — Command page rebuild

Replace the current `/command` page with the PerformX-style Executive Overview from the mockup, wired to real data wherever it exists. Same data scope as today (uses `useScope` + `useDateRange`).

## Sections (top → bottom)

1. **Header** — "Executive Overview / Real-time performance across the customer journey", existing date range + compare picker on the right.

2. **5 KPI cards with sparklines** (vs prior period delta):
   - Ad Spend = Σ `daily_metrics.cost`
   - Calls Received = Σ CTM calls (`ctm_calls` count in window)
   - Qualified Calls = Σ `daily_metrics.good_leads`
   - Appointments Set = Σ `daily_metrics.projected_sale`
   - Revenue Generated = Σ `daily_metrics.verified_sale`
   Each card: big value, % delta vs comparable prior window, mini area sparkline of daily values.

3. **Customer Journey Funnel** (left, 2/3 width) — 5 stacked icons + values + conversion % between each stage:
   Ad Spend → Calls → Qualified → Appointments → Revenue.
   Below: 4 sub-KPIs — Overall Conversion Rate (revenue count / calls), Cost per Qualified Call, Cost per Appointment, Cost per Revenue $.

4. **Revenue Capture Score** (right, 1/3 width) — donut 0–100:
   Score = weighted blend of answer-rate, qualified-call rate, and appointment-set rate (clamped 0–100). Show "Estimated Revenue Lost This Week" = (expected revenue at goal − actual revenue), with delta vs prior period. CTA → `/lead-performance`.

5. **Call Handling Performance** (1/3) — from `lead_perf_handling` + CTM:
   - Answer Rate (CTM answered / total calls) with progress bar + goal 70%
   - Avg Answer Time (CTM `time_to_answer` mean) + goal <20s
   - Abandon Rate (CTM abandoned / total) + goal <10%

6. **Missed Call Follow-Up Performance** (1/3) — from `lead_perf_speed`:
   - Missed Calls count + % of total
   - Returned <5m, Returned <30m, Never Returned (each a row with %, goal, delta)
   Where the speed RPC doesn't cover a bucket, show "—" with "data not wired" hint.

7. **Call Quality (AI Score)** (1/3) — donut of average score + legend (Excellent/Good/Average/Poor distribution).
   Data source: `ctm_calls.score` if populated; otherwise render the card with "AI scoring not yet connected" empty state.

8. **Top Opportunities to Improve** — derived from the section severities above. Each row: Opportunity, Impact ($ recoverable estimate), Why It Matters, "View Details" link to the relevant page. Generate up to 4 rows by sorting handling/speed/quality gaps vs goal.

## Data plumbing

New hooks/queries in `src/pages/Command.tsx` (or new `src/components/command/*`):
- Existing: `daily_metrics` query already returns most KPIs.
- Add `ctm_calls` aggregate query (count, answered, abandoned, avg time_to_answer, avg score) over the date+scope.
- Reuse `lead_perf_speed` / `lead_perf_handling` RPCs (already wired in `src/components/lead-perf/hooks.ts`).
- Prior-period query: re-run the same selects shifted by window length to compute deltas + sparkline series.

## Files

- Rewrite `src/pages/Command.tsx` — new layout.
- Add `src/components/command/`:
  - `KpiSparkCard.tsx` (KPI + delta + sparkline using Recharts area)
  - `JourneyFunnel.tsx` (5-stage row with conversion % between stages + cost sub-KPIs)
  - `RevenueCaptureScore.tsx` (donut + lost-revenue panel)
  - `CallHandlingCard.tsx`, `MissedCallFollowUpCard.tsx`, `CallQualityCard.tsx`
  - `TopOpportunitiesTable.tsx`
  - `useCommandData.ts` — single hook returning current+prior aggregates, sparkline series, CTM rollup.

## Empty / unavailable data

- CTM AI Score, Missed-Call Follow-Up buckets that don't exist yet → render the card with values dashed and a one-line "Data source not connected" note. No fake numbers.
- Targets-driven goals pulled from `property_targets` (already loaded); fall back to sensible defaults (Answer 70%, <20s, Abandon <10%, <5m returned 60%, <30m 80%) shown as "Goal" labels.

## Out of scope (this round)

- Wiring AI call-quality scores or missed-call return-time pipelines (data plumbing for those is a separate task).
- The current "Error feed" placeholder card is removed; nothing else on the site links to it.

## Verification

- Typecheck/build is run automatically after the edit.
- Visual check via preview at `/command` for agency scope and one property scope.
