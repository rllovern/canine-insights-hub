# Port AlienX Build → Ridgeside Canine

Goal: bring every capability from the AlienX dashboard into this project, but keep the Ridgeside brand (sage green `#3F6B4A`, Inter, "Ridgeside Canine" wordmark) and the existing `properties` / `ctm_calls` data model already shipped in Prompts 1–3.

## What AlienX has that we need to add

Pages
- **PPC Overview** — 3-column layout (Cost & Impressions / Clicks / Actions), KPI cards with period-over-period deltas, dual-axis daily charts.
- **Call Tracking** — replaces our current basic CallTracking; richer source × outcome, score-bucket breakdown, multi-line trend.
- **Keywords** — rankings + share-of-voice tables and trend.
- **Clients Admin** (becomes **Properties Admin**) — full data-source connection management for Google Ads (OAuth + MCC picker), CTM (account picker), GA4, Keyword.com; logo upload; visible-metric toggles; score mapping editor; sync health.
- **Settings** — internal preferences, secrets status, scheduled sync controls.
- **Public Report** — branded read-only version of the PPC overview.
- **AI Assistant** — chat panel that answers questions about the active property's metrics.

Cross-cutting components
- `DashboardContext` with date-range presets (MTD / 7 / 30 / 90 / custom) **plus compare mode** (off / previous period / custom).
- `SectionDivider`, `KpiCard` w/ Delta, `ChartCard`, `DualAxisChart`, `MultiLineChart`.
- `SyncHealthBell` (top bar) + `CtmDiagnosticDialog` + `ScoreMappingsDialog`.
- `client-labels` → `property-labels`: per-property visible metric config + relabeling (e.g., "admissions" → "intakes" if a property prefers it).
- Blended-metrics fetcher (`data-sources.ts`) reading from `daily_metrics`.

Edge functions to port
- `sync-google-ads`, `google-ads-oauth-url`, `google-ads-oauth`, `list-mcc-customers`
- `sync-ga4`
- `sync-keyword-com`
- `list-ctm-accounts` (we already have `sync-ctm` and `test-ctm` — keep ours, add the account picker)
- `scheduled-sync-all` (cron orchestrator)
- `ai-assistant` (uses Lovable AI Gateway, no key needed)

## Data model changes

AlienX is keyed on `clients`; we're keyed on `properties`. We will keep `properties` and add the missing tables, all referencing `property_id`:

- `daily_metrics(property_id, date, ad_source, campaign, cost, impressions, clicks, record_count, no_entry, leads, good_leads, bad_leads, spam, admissions, sessions, users)` + index `(property_id, date)`.
- `property_settings(property_id pk, visible_metrics jsonb, data_sources jsonb, metric_labels jsonb, updated_at)`.
- `property_call_score_mappings(property_id, score_label, bucket)` — drives good/bad/spam classification on `ctm_calls` (the missing piece flagged at the end of Prompt 3).
- `sync_runs(id, property_id, source, status, started_at, finished_at, error, stats jsonb)`.
- `keyword_rankings(property_id, date, keyword, position, search_engine, location)`.
- `keyword_share_of_voice(property_id, date, share_pct, competitors jsonb)`.
- New enums: `data_source_type` (extend existing `DataSource`: add `bigquery`, `keyword_com`), `connection_status`, `score_bucket` (`good`/`bad`/`spam`/`no_entry`).
- Extend `property_data_sources.config` usage to store OAuth tokens, GA4 property id, CTM account id, Keyword.com project id.
- RLS: internal full access; viewers limited via existing `viewer_can_access(uid, property_id)` helper. Public report token read paths via `SECURITY DEFINER` functions (`get_daily_metrics_by_report_token`, `get_keyword_rankings_by_report_token`, etc.) following the pattern already used for `get_ctm_calls_by_report_token`.
- Seed 90 days of synthetic `daily_metrics` for existing properties so the UI is populated immediately (mirrors AlienX seed loop).

We keep `ctm_calls` exactly as-is and resolve good/bad/spam by joining to `property_call_score_mappings` — that closes the loop on Prompt 3 and feeds the new Call Tracking page.

## Brand / design system

- Keep our current sage palette (`--primary 138 26% 33%`) and Inter font.
- Adopt AlienX's structural tokens: `--section`, `--shadow-sm/md/lg`, `--gradient-section`, the seven-color chart palette (recolor to sage-led: chart-1 sage, chart-2 slate, chart-3 amber, chart-4 terracotta, chart-5 sky, chart-6 muted rose, chart-7 stone) and the dark sidebar surface.
- Port AlienX's `kpi-card`, `section-divider`, `glass-panel` component utilities.
- Rebrand all copy: "AlienX" → "Ridgeside Canine", "client(s)" → "property(ies)", "admissions" stays as default but is relabel-able per property via `metric_labels`.
- Replace AlienX logo with our existing `BrandMark`.

## Routing reconciliation

Our shell stays; we extend it with the new pages:

```
/dashboard                 → PPC Overview (current property)
/properties/:slug          → property detail tabs: Overview | Calls | Keywords | Reports
/calls                     → Call Tracking (active property)
/keywords                  → Keywords (active property)
/assistant                 → AI Assistant (already exists, wire to ai-assistant function)
/admin/properties          → Properties admin (port of ClientsAdmin, 1253 LOC)
/admin/users               → keep
/admin/settings            → port of AlienX Settings
/report/:token             → public branded report (extend current PublicReport)
```

Active-property selection continues to come from `PropertyContext` + sidebar `PropertySwitcher`. Date range + compare lives in a new `DashboardContext` that wraps our existing `DateRangeContext`.

## Implementation phases (one PR-sized step each)

1. **Schema & seed** — migration adding the six new tables, enum extensions, SECURITY DEFINER read functions, seed 90 days of `daily_metrics` for existing properties.
2. **Design tokens & shared components** — extend `index.css`, port `KpiCard`/`Delta`/`ChartCard`/`DualAxisChart`/`MultiLineChart`/`SectionDivider`, add `lib/metrics.ts` helpers (`sumMetrics`, `groupByDate`, `pctChange`, `fmtCurrency/Number/Pct`, `getRange`, `priorRange`, `rangeToISO`), add `lib/data-sources.ts` (`fetchBlendedMetrics`, `calc`).
3. **DashboardContext + PPC Overview page** — wired to seeded data.
4. **Call Tracking rebuild** — replace current component, add score-mapping join, source × outcome + bucket breakdowns + trend.
5. **Keywords page** + rankings/SoV tables.
6. **Admin: Properties** — port ClientsAdmin connection cards, score mappings dialog, visible-metrics editor, logo, sync-health bell, CTM diagnostic dialog.
7. **Edge functions** — port `sync-google-ads` (+OAuth), `sync-ga4`, `sync-keyword-com`, `list-mcc-customers`, `list-ctm-accounts`, `scheduled-sync-all`, `ai-assistant`. Google Ads OAuth requires `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN` secrets — will request via `add_secret` only when reached (user said Google Ads is deferred, so this function will deploy but stay unconfigured until they're ready).
8. **AI Assistant page** — wire UI to `ai-assistant` function (uses Lovable AI Gateway — no extra key).
9. **Settings page + Public Report** — port and rebrand.

## Things explicitly preserved from current Ridgeside build

- Existing tables: `properties`, `property_data_sources`, `user_roles`, `viewer_property_access`, `ctm_calls`.
- Existing functions: `has_role`, `viewer_can_access`, `get_property_by_report_token`, `get_ctm_calls_by_report_token`.
- Invite-code registration flow, super-admin account, sage brand, `BrandMark`, `PropertyAvatar`, `PropertySwitcher`, `PreviewMode` toggle.
- The CTM sync we shipped in Prompt 3 — Google Ads remains stubbed per your direction.

## Open question before we build

Two metric models exist in parallel: (a) **per-call rows** in `ctm_calls` (live, accurate, our current source of truth) and (b) **pre-aggregated `daily_metrics`** that AlienX's PPC Overview reads from. Plan: aggregate `ctm_calls` into `daily_metrics` on each CTM sync (cheap upsert), and let Google Ads / GA4 syncs write their own rows. That way one page (`/dashboard`) reads the blended view AlienX expects, while detail pages keep using the raw `ctm_calls` for drill-downs. If you'd prefer to skip `daily_metrics` and rebuild PPC Overview directly off raw tables, say so and I'll adjust before step 1.