## Conditions 1–4 batch — fix violations, re-point surfaces, prove the rollup

### Pre-flight: portfolio rollup verification (Condition 3) — already verified, reporting here

Ran `v_lead_counts_property_daily` directly (RPC returns zeros via psql because `auth.uid()` is null and the SECURITY DEFINER filter blocks all rows — that's correct behavior, not a bug). All 5 active properties present; there is no missing 6th location — the project has 5 active properties, not 6.

```text
property                       leads  bad  good  proj  total  quality
RidgesideK9 Winchester           273   60    49    12    121   50.41%
RidgesideK9 NoVA                 190    6    32     4     42   85.71%
Ridgeside K9 MoCo                123   19    16     0     35   45.71%
Ridgeside K9 Ashtabula            40    5     7     2     14   64.29%
RidgesideK9 Colorado Springs      18   10     2     0     12   16.67%
TOTAL                            644  100   106    18    224   55.36%
```

Portfolio = 124 ÷ 224 = **55.36%** (matches v3 prediction; the earlier "51%" came from a different window/source). Winchester 50.41% matches the benchmark. Per-location hand checks tie out (e.g. NoVA: (32+4)/42 = 85.71 ✓). The RPC math is correct; the apparent gap was windowing, not a missing location. Front-end will surface this same number once it stops reading the auth-less path.

### Condition 2 — TopOpportunities.tsx: kill the banned denominator

`qualRate = totals.qualifiedCalls / totals.calls` is `good ÷ records` — the exact forbidden formula. Replace with the shared helper:

- Import `qualityRate`, `qualityNumerator`, `totalLeads`, `QUALITY_TARGETS`, `qualityTier`, `LOW_SAMPLE_BASE` from `@/lib/leadModel`.
- Build a `LeadCounts` from `totals` (`bad`, `good`, `projected`) — extend `Totals` in `useCommandData.ts` so these three are exposed directly (they already exist internally; just surface them).
- Compute `const rate = qualityRate(counts); const base = totalLeads(counts);`.
- Trigger the "Improve Call Qualification" opportunity when `qualityTier(rate, base)` is `amber` or `red` (judged on 55/45, not on `targets.qualRate`).
- Severity = `red` → critical, `amber` → warning. Suppress entirely when tier is `low-sample`.
- "Why" copy: `${(rate*100).toFixed(0)}% quality (good + AI-projected) ÷ ${base} leads. Target 55%.` Gap text uses `Math.round(base * QUALITY_TARGETS.green - qualityNumerator(counts))`.
- Remove `targets.qualRate` from the qualified-call branch (it stays for other branches that still use targets, but the quality gate must use the canonical tiers).

### Condition 4 — CallTracking.tsx: route through the RPC and add a Quality column

Current violations: line 169 and line 241 both compute `total_leads = good + bad + projected` locally; "Proj" column is misnamed; no Quality column.

- Delete both `withTotals` helpers. Fetch totals from `lead_quality_rollup(propertyIds, from, to)` for the page-level scope and from `v_lead_counts_property_daily` (sum per property) for the table rows so each row already carries canonical `total_leads` / `quality_numerator` / `quality_rate`.
  - Wrap the RPC call in `src/lib/leadModel.ts` as `fetchLeadRollup(supabase, { propertyIds, from, to })` and `fetchLeadRollupByProperty(...)` so the page never touches column names directly.
- Source/campaign aggregator tables: read `v_lead_counts_daily` (already grouped by `ad_source`, `campaign`) instead of local sums on `daily_metrics`. `total_leads` and `quality_rate` come from the view.
- Column changes in both call-tracking tables:
  - Rename header `projected_sale` → **"AI-Projected"** (use `PROJECTED_LABEL` from `leadModel.ts`).
  - Add new **"Quality"** column right after `total_leads`. Value = `formatQualityRate(row.quality_rate)`, colored via `TIER_TEXT[qualityTier(row.quality_rate, row.total_leads)]`. Show "—" when `low-sample`.
  - Update `property-labels.ts` so the canonical label for `projected_sale` is "AI-Projected" (keeps Dashboard/PDF consistent).
- Subtitle on the `projected_sale` chart card changes to "AI-projected sale — quality signal, not a forecast".

### Condition 1 — gating

Stop after the three items above, re-verify, and wait for explicit approval before touching Dashboard / BudgetPacing / Reports / PublicReport / PDF / Jarvis / ai-assistant. Do not chain.

### Verification before reporting back

1. `rg -nP "(good_leads|good)\s*[\+/]\s*(bad_leads|bad|projected|records|record_count|calls)" src` returns zero hits outside `src/lib/leadModel.ts` and `src/integrations/supabase/types.ts`.
2. `rg -n "qualRate|qualityRate" src` — every call site resolves to the `leadModel.ts` import.
3. Manual sanity in preview: `/command` Portfolio Verdict, Journey Funnel quality sub-KPI, TopOpportunities "Why" text, and `/calls` totals all show portfolio 55.4% / Winchester 50.4% / NoVA 85.7% / Colorado Springs 16.7% with matching tier colors.
4. Re-paste the per-location table in the report message so the rollup is captured in the chat record.

### Out of scope this batch (queued for the next approval)

Dashboard, BudgetPacing, Reports, PublicReport, PDF export, Jarvis edge function context, ai-assistant edge function, `daily_metrics`-direct reads in `useCommandData.ts` (currently sums `good_leads + bad_leads + projected_sale` locally — flagged but deferred so this batch stays scoped to conditions 1–4). The intent is to migrate `useCommandData` and every remaining surface to `fetchLeadRollup` in the next batch.
