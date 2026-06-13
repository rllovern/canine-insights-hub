# Jarvis — Phase 1 build plan (approved with revisions)

Scope: agent foundation + flagship CTM↔GHL reconciliation report. No alerts, no write actions.

## Revisions accepted
- Reconciliation classifies each CTM row as: `unmatchable` | `missing` | `contact_only` | `activity_loose` | `activity_strong` | `lead_fact` | `opportunity`.
- Identity = phone OR email exact (normalized). Timestamp proximity is secondary evidence (±15 min strong, same-day loose).
- Every report carries scope/evidence: property, date range, sources used, sync freshness, matching method, unmatchable/contact-only/activity counts, caveats.
- Explicit permission tests for cross-property, cross-user, internal-read-all, service-role writes.
- Report header actions: Save · Copy summary · Open evidence · Export CSV · Create alert (disabled, "coming soon").

## Build
1. Migration: `ai_agent_sessions`, `ai_agent_messages`, `ai_agent_tool_runs`, `ai_agent_reports` with GRANTs, RLS, owner-only + internal-read-all policies.
2. Edge function `jarvis`: AI SDK `streamText` against Lovable AI Gateway (`google/gemini-3-flash-preview`), system prompt enforces tool use + evidence, persists messages + tool runs.
3. Tools: `get_property_context`, `get_account_summary`, `get_lead_performance_snapshot`, `get_account_stability`, `reconcile_ctm_to_ghl`, `save_visual_report`.
4. Report schema in `src/lib/jarvis/reportSchema.ts`; renderer in `src/components/jarvis/report/`.
5. UI: replace `/assistant` with full-page Jarvis (chat + report drawer). Global `Cmd+K` `JarvisCommandBar` in `AppShell`.
6. Threads: sessions in DB; active session id in URL `?session=…`.

## Out of scope (later phases)
Alerts, embedded "ask why" buttons, write/execute tools, push notifications, cross-property queries.