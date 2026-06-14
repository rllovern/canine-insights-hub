
# Command Layer, Handoff Integrity & Jarvis Write Gate

Build-ready plan for the full handoff spec. Ordered per §9 of the spec. Every metric is scope-aware; rates are always ratio-of-sums.

## 1. Global scope model (replaces existing selectors everywhere)

**Goal:** one scope source of truth, driven from the left rail. Removes the TopBar property switcher and the per-page dropdown on Lead Performance.

- New `ScopeContext` (`src/contexts/ScopeContext.tsx`):
  - State: `{ mode: "agency" | "property", propertyId: string | null }`.
  - `agency` mode resolves to `null` for internal users (all properties), or the viewer's assigned property IDs.
  - Persists in `localStorage` under `scope.v1`.
  - Exposes `propertyIds: string[] | null` (null = unrestricted) and `activeProperty` for header titles.
- Mounts in `App.tsx` above `PropertyProvider`. `PropertyContext` keeps loading the property list but `activeProperty`/`setActiveProperty` are deprecated and replaced by reading scope.
- Sidebar gets a `ScopeSelector` block at the top: "All locations (Agency)" + grouped list of properties, search input, GHL-style. Internal-only sees Agency; viewers see only their accessible properties.
- TopBar: remove `PropertySwitcher`. The H1 reflects scope ("All Locations" or property name).
- `LeadPerformance.tsx`: drop the page-level `Select`/`ALL_VALUE` and read from `useScope()`.
- `Dashboard.tsx`, `CallTracking.tsx`, `Keywords.tsx`, `PropertyPage.tsx`, `Reports.tsx`, `BudgetPacing.tsx`: replace `useProperties().activeProperty` with `useScope()`.
- `DashboardContext` already aggregates by `activeProperty`; widen its query to accept `propertyIds: string[] | null` and either sum across all when null (internal agency) or filter to the array.

**Ratio-of-sums rule:** add `src/lib/scopedMetrics.ts` exporting helpers that take row arrays and compute CTR/CPL/response-rate as `Σ num ÷ Σ den`. Replace existing per-row averages on Dashboard and Lead Performance summaries with these.

## 2. Command page (new default landing)

- Route `/command` added in `App.tsx`, becomes the redirect target from `/` (replacing current `Index` → Dashboard).
- New `src/pages/Command.tsx` composed of three sections:
  1. **Portfolio summary line** — scope-aware: budget total, spend MTD, good leads vs expected, blended CPL, % month elapsed. Pulled from `daily_metrics` + `campaign_budgets`.
  2. **Jarvis-authored summary sentence** — calls `jarvis` edge fn with a deterministic `summarize_portfolio` tool (new) that returns `{ headline, locations_needing_attention[] }`. Cached for 10 min per scope+date.
  3. **Location status grid** — one row per property: three dots (spend pacing / CPGL / lead handling) computed via new SQL view `v_location_status` (see Technical). Worst-first sort. "Fix ↗" deep-links to the page where that dot is red.
- In property scope the grid collapses to that property's detail card + its slice of the error feed.
- Sidebar nav reorders to: Command, Budget Pacing, PPC Overview, Call Tracking, Lead Performance, Client Reports, Reports, Jarvis, then admin.

## 3. Error feed (lives on Command, two lanes)

- New table `system_errors` (severity, lane, source, scope, property_id, message, evidence jsonb, opened_at, closed_at, jarvis_explanation).
- New edge fn `compute-errors` (cron every 15 min via `scheduled-sync-all`) writes/closes rows by evaluating deterministic thresholds:
  - **Lane A (data integrity):** sync stale (per source last_success_at > threshold), OCI match-rate, CTM↔GHL inbound mismatch spike, untracked-callback spike, unconfirmed mappings, non-monotonic funnel, sale-capture completeness drop, tag/response divergence > threshold.
  - **Lane B (performance):** pace ±15, rolling CPL over allowable, qual rate < trailing-norm 3+ days, zero good leads N days w/ spend live, response/SLA breach, impression share drop >10pt.
- `ErrorFeed` component on Command: severity-sorted list, lane badges, expandable row with the Jarvis "why" (lazy-fetched from `jarvis` with a new `explain_error` tool). Each row has a "Drill ↗" that routes to the relevant page (e.g. Lead Performance with the matching drill key preselected).
- Filterable by lane, scope. Closed errors hidden by default with a toggle.

## 4. CTM ↔ GHL inbound reconciliation

- New view `v_inbound_reconciliation`: joins `ctm_calls` (inbound only) with `ghl_messages` where `message_type='TYPE_CALL' AND direction='inbound'` on E.164 phone + ±5 min sent_at window.
  - Buckets: `in_both`, `ghl_only`, `ctm_only` (with `ctm_only` subdivided by CTM disposition into `integration_gap` vs `correctly_filtered_spam`).
- New section on `LeadPerformance.tsx`: "Inbound Reconciliation" — count per bucket, 30-day trend, and an **Unattributed Inbound** call-out (GHL-only count).
- Drillable: clicking a bucket opens `DrillSheet` with the underlying calls/messages and the join evidence.
- Feeds Lane A error: `ctm_ghl_mismatch_spike` triggers when 7-day unattributed share > trailing-30d band.

## 5. Handoff integrity module (Lead Performance core)

### 5a. Outcome attribution — human vs workflow
- New SQL function `lead_perf_handoff_attribution(_property_ids, _from, _to)` bucketing each lead in `ghl_lead_facts` as `human_touched` (any outbound row with `response_source='human'` before outcome) vs `automation_only`. Returns good-lead rate and won rate per bucket.
- Agency-only display: trailing 60–90 days toggle. Per-property hidden when n<30 with a "low sample" caveat.
- New `HandoffAttribution.tsx` rendered on Lead Performance above Pipeline Conversion.

### 5b. Response timing
- Reuse existing Speed-to-Lead and Action Queue. Add `source` segmentation (form / call / FB / direct) to Action Queue so paid-lead neglect is isolated. Source pulled from `ghl_lead_facts` joined to `ghl_contacts.source` field.

### 5c. Tag / response divergence (audit on top of trusted `response_source`)
- New SQL function `lead_perf_divergence(_property_ids, _from, _to)` returns:
  - `worked_untagged_count` — leads w/ `human_attempt_count > 0` AND no disposition tag in `ghl_contacts.tags`.
  - `won_without_human_touch_count` — `won_at IS NOT NULL` AND `human_attempt_count = 0` AND `first_human_answered_inbound_at IS NULL`.
  - `tag_completeness_pct` — tagged ÷ worked.
  - `divergence_score` = weighted gap vs automation baseline.
- New `DivergenceCard.tsx` on Lead Performance, scope-aware. Threshold breach raises Lane A `tag_response_divergence`.

### 5d. Sales capture
- Canonical: `ghl_lead_facts.won_at IS NOT NULL` OR (future) `ghl_contacts.custom_fields->>'sale' = '1'`. New SQL `lead_perf_sales(_property_ids, _from, _to)` returns verified sales count + matched spend → CPA.
- `SalesCaptureCard.tsx` on Command + Lead Performance. Sale-capture completeness = wins with all required fields / total wins; drop > threshold raises Lane A `sale_capture_completeness_drop`.

## 6. Jarvis — full read scope + write taxonomy

### Read scope expansion
- Extend `jarvis/index.ts` system prompt and tool catalog so every SQL view above is callable: `get_location_status`, `get_error_feed`, `get_inbound_reconciliation`, `get_handoff_attribution`, `get_divergence`, `get_sales_capture`, `get_portfolio_summary`.
- Reports render only on explicit "show me a report" requests — already enforced; add a `render_report` flag the model sets.

### Write taxonomy + mandatory confirm gate
- New tables (single migration):
  - `jarvis_actions` — id, session_id, user_id, class (`read|internal_write|external_write`), tool_name, inputs jsonb, risk_level, risk_explanation, status (`proposed|confirmed|executed|rolled_back|cancelled|failed`), result jsonb, rollback_payload jsonb, created_at, executed_at.
- Every Jarvis tool that mutates anything declares `needsApproval: true` (AI SDK pattern) and writes a `proposed` row, then a UI dialog (`JarvisActionDialog`) renders with: what it will do, why it could be a problem, risk level (low/med/high — model-assessed but never controls whether the dialog fires), and a free-text "reason" the user types before confirming.
- Frontend wires this through the existing `JarvisChat`/`JarvisCommandBar` with an AI Elements approval pattern. Confirmed actions POST back to the edge fn which executes and writes the `executed` row + `rollback_payload`.
- Initial write tools shipped:
  - **Internal writes:** `retag_lead`, `clean_contact_record`, `fix_pipeline_mapping`.
  - **External writes — GHL** (via `sync-ghl` infra creds): `ghl_update_contact_tags`, `ghl_move_opportunity_stage`, `ghl_assign_contact`.
  - **External writes — Google Ads** (via existing `google-ads-oauth` token store): `gads_update_campaign_budget`, `gads_pause_campaign`, `gads_add_negative_keyword`.
- Rollback: for each tool, the executor captures the pre-state into `rollback_payload`; a `jarvis_rollback` tool replays the inverse. Tools where the API has no inverse (e.g. adding a negative keyword can be inverted by removing it; pausing → enabling) document the inverse path.

### Anomaly narration
- New tool `explain_error(error_id)` reads the `system_errors` row + raw evidence and returns a 2-3 sentence "why" + 1-2 recommended actions. Cached in `system_errors.jarvis_explanation` after first call.

### Spot-audit log
- New table `jarvis_audit_samples` — weekly cron picks 5 executed actions + 5 analyses, writes them to a queue for human review. Surfaced in a small `/admin/jarvis-audit` page (internal only).

## 7. Build order

Implementation follows the spec's §9 exactly, one migration + UI slice per step. Each step is shippable on its own:
1. Scope context + sidebar selector + ratio-of-sums helpers; remove old selectors.
2. Command page shell + portfolio summary + location status grid (reuse existing dot logic).
3. `system_errors` table + `compute-errors` edge fn + ErrorFeed UI (both lanes).
4. CTM↔GHL reconciliation view + Lead Perf section + Lane A wiring.
5. Handoff integrity SQL fns + UI cards + sales capture + divergence + Lane A wiring.
6. Jarvis read-scope expansion (new tools, prompt updates).
7. Write-gate scaffolding (`jarvis_actions` table, approval dialog, executor) + initial GHL + Google Ads write tools + rollback.
8. Anomaly narration tool wired into ErrorFeed.

## Technical notes

- **Migrations needed:**
  - `system_errors` (with GRANTs to `authenticated`/`service_role`, RLS scoped via `lead_perf_can_read`).
  - `jarvis_actions` (RLS: user can read own session rows; service role full).
  - `jarvis_audit_samples`.
  - Views/functions: `v_location_status`, `v_inbound_reconciliation`, `lead_perf_handoff_attribution`, `lead_perf_divergence`, `lead_perf_sales`.
- **GHL write infra:** reuse `property_data_sources.config` for location_id + token. Add a thin `ghl-write` edge fn invoked by Jarvis executor (keeps token handling out of the LLM loop).
- **Google Ads write infra:** new `google-ads-write` edge fn that uses the OAuth refresh token already stored by `google-ads-oauth`.
- **Risk assessment:** Jarvis returns `risk_level` per call but the dialog **always fires** on external writes regardless. Risk only controls dialog styling (color + copy strength).
- **Logging:** every tool call (read or write) writes to `ai_agent_tool_runs` (already exists); writes additionally write to `jarvis_actions`.
- **Trailing-norm bands:** computed as `mean ± 1.5·stddev` over trailing 30 days from `daily_metrics` per property; stored on each error row as evidence for explainability.
- **No new external integrations** — only the three existing APIs (Google Ads, CTM, GHL).

## Out of scope (explicit)

- Alerting/notifications stays Phase 3 (already gated in current report schema).
- Automatic remediation without approval — forbidden by spec §6.
- New ingestion sources beyond Google Ads, CTM, GHL.
