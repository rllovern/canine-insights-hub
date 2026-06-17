
# Command Center — Honest Rebuild

Goal: every number on `/command` is attributable, judged inline, and actionable. Funnel ends where tracking ends. No fabricated deltas, no placeholder styled as real.

## Build order

### 1. Strip revenue-as-dollars
- `KpiSparkCard` "Revenue Generated" → removed. KPI row goes from 5 → 4 tiles (Ad Spend, Calls, Qualified Calls, Appointments).
- `RevenueCaptureScore.tsx` → deleted. Card slot reclaimed for the new **Portfolio Verdict / Ranked Locations** block.
- `JourneyFunnel`:
  - Drop "Revenue Generated" stage. Funnel ends at **AI-Projected Sale (count)** plus a pending **Verified Sale (count, GHL Won — not piped)** stage.
  - Remove "Cost Per Revenue $" sub-KPI. Keep Overall Conversion, Cost/Qualified Call, Cost/Appointment.
- `TopOpportunities` impact column stays — it's cost saved, not revenue.

### 2. Reclassify bottom of funnel to counts
- `projected_sale` rendered as count, label "AI-projected sale" with info tip "CTM transcript projection — count only, not dollars."
- `verified_sale` rendered as a pending stage ("— / not piped") until GHL Won feed is wired. Greyed style, dashed border, info tip explaining attribution gap.

### 3. Fix data-honesty bugs
- New helper `safeDelta(curr, prior, { minBase = 25 })` in `src/lib/metrics.ts`:
  - prior === 0 → returns `{ kind: 'no-prior' }`
  - base < minBase → returns `{ kind: 'low-sample', abs: curr - prior }`
  - else → `{ kind: 'pct', value }`
- All delta renderers (`KpiSparkCard`, `JourneyFunnel.SubKpi`, `Delta.tsx`) consume this discriminated union: render "no prior data", "+N (low sample)", or "%". No more `+100%`.
- `PerformanceCards`:
  - `CallHandlingCard` → if CTM disposition not wired, collapse to compact "Pending — CTM disposition not mapped" empty state (not full-styled card).
  - `CallQualityCard` → if `buckets` is empty/unscored-only, same pending state. AI Score 3.7 placeholder removed.
- Confirm compare window: when `priorDaily` sums are all zero, KPI shows "no prior data" instead of green +100%.

### 4. Portfolio verdict + ranked locations (scope-aware hero)
- New `src/components/command/PortfolioVerdict.tsx`:
  - **Agency scope** (`propertyIds === null` or length > 1): hero line "X critical · Y warning · Z good" with colored counts. Below it, ranked location list (worst-first), each row: `{name} — {verdict} · {deciding reason}` e.g. "Ashtabula — critical · CPL $449 vs $200 target".
  - **Location scope** (single property): hide ranking, show that location's verdict sentence + its own funnel only.
- New `src/components/command/useLocationRollup.ts`: fetches per-property aggregates for the window, computes ratio-of-sums per property, judges each against targets from `property_targets`, returns sorted list.
- Verdict thresholds (initial, configurable later): CPL > target × 1.5 = critical; > target × 1.15 = warning; else good. Same pattern for CPGL, qualified-call rate, SLA.

### 5. Complete attributable funnel
- Funnel stages with explicit data-source badges on hover:
  `Ad Spend (Google Ads)` → `Calls (CTM)` → `Qualified Calls (CTM scored)` → `Worked w/in SLA (GHL)` → `AI-Projected Sale (CTM)` → `Verified Sale (GHL Won — pending)`.
- Seam stages (Worked/SLA, Verified) marked pending with dashed treatment until their feed is confirmed live.

### 6. Lead handling + speed-to-lead as first-class
- Promote `useSpeed` data into a dedicated **Lead Handling** card (replaces current `MissedCallFollowUpCard`): answer rate, median response time, never-responded count — each judged vs SLA from `property_sla_settings`.
- Only render once the underlying query returns non-empty; otherwise pending state.

### 7. Two-lane opportunity feed
- Refactor `TopOpportunities` into two lanes inside one card:
  - **Lane A — Data integrity**: stale syncs (`sync_runs` last_success > 24h), placeholder-still-live, reconciliation gaps, AI self-audit flags.
  - **Lane B — Performance**: existing dollar-ranked CPL/CPGL/SLA/qual opportunities.
- Each row keeps the "Why It Matters" narration column.

### 8. AI self-audit (Role 2)
- New edge function `supabase/functions/command-self-audit/index.ts` using Lovable AI Gateway (`google/gemini-3-flash-preview`, structured output via `Output.object`).
- Client sends the computed dashboard snapshot (totals, deltas, flags, scope). Function returns `{ flags: [{ severity, message, location? }] }`.
- Flags surface in Lane A. Examples it must catch: implausible revenue/spend ratio, repeated identical deltas, card labeled placeholder still rendering as real, prior-period-empty patterns.
- Narration (Role 1) for portfolio verdict sentence + per-opportunity "why" reuses same function with a different prompt mode.
- No chat widget on this page — Jarvis stays the conversational surface.

## Governing rules (enforced in code, not just docs)
- `safeDelta` is the only path to render a delta.
- `KpiSparkCard` requires a `sourceTable` prop shown in tooltip — forces every tile to declare attribution.
- Any card whose data dependency is empty renders `<PendingCard reason={...} />` instead of styled zeros.

## Files

**New**
- `src/components/command/PortfolioVerdict.tsx`
- `src/components/command/RankedLocations.tsx`
- `src/components/command/LeadHandlingCard.tsx`
- `src/components/command/PendingCard.tsx`
- `src/components/command/useLocationRollup.ts`
- `src/components/command/useSelfAudit.ts`
- `supabase/functions/command-self-audit/index.ts`

**Edited**
- `src/pages/Command.tsx` — 4-tile KPI row; hero swap; scope-aware layout.
- `src/components/command/JourneyFunnel.tsx` — drop revenue stage + CPR sub-KPI; add Worked/SLA + pending Verified stages; counts only.
- `src/components/command/KpiSparkCard.tsx` — `safeDelta`, `sourceTable` prop, no revenue tile.
- `src/components/command/PerformanceCards.tsx` — pending states; remove fake AI score.
- `src/components/command/TopOpportunities.tsx` — two-lane layout, integrate self-audit flags.
- `src/components/command/useCommandData.ts` — expose per-property rollups + integrity signals.
- `src/components/command/tooltips.ts` — drop revenue tips; add source-attribution tips.
- `src/lib/metrics.ts` — `safeDelta`, low-sample helpers.
- `src/components/ui/Delta.tsx` — consume `safeDelta` result.

**Deleted**
- `src/components/command/RevenueCaptureScore.tsx`

## Out of scope
- Real GHL Won → CTM revenue reconciliation (returns revenue dollars only when that pipe exists).
- Conversational AI on `/command`.
- Dark-mode parity (still deferred).
