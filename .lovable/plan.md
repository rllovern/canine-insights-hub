# Lead Performance Overview — Revised Build Plan

A new top-level page at `/lead-performance` covering five sections: Speed to Lead, Lead Handling, Pipeline Conversion, Agent Leaderboard, Data Quality. Agency-wide by default with a property switcher to drill into a single GHL sub-account.

Powered by an expanded `sync-ghl` that captures message-, opportunity-, appointment-, task-, user-, and stage-level data and normalizes it into reporting tables so the dashboard queries facts, not raw JSON.

The page answers: how fast are leads handled, are agents actually responding (or are automations inflating numbers), where do leads fall out, which agents work leads effectively, and where is GHL data incomplete.

## Approval gate — must clear BEFORE coding

The previous direction is approved, but implementation does not start until the following are produced and signed off:

1. **GHL endpoint + scope feasibility checklist** — for every endpoint we call, document: scope required, pagination method, rate limits, response shape, available timestamps, user/source identification fields, known missing fields, fallback behavior.
2. **Confirmation that message source classification works** with the fields GHL actually exposes (we cannot rely on "userId present = human" alone).
3. **Confirmation of how outbound calls are represented** in GHL conversation/message data.
4. **Confirmation of how AI agent messages are identified**, if applicable.
5. **Confirmation that calendar event status** can deliver booked / showed / no-show / cancelled, or a documented fallback.
6. **Rate-limit and pagination strategy**.
7. **Sample payloads** for messages, opportunities, appointments, users, tasks, pipelines.
8. **Backfill plan** for existing connected properties.
9. **Validation plan** comparing dashboard values to the GHL UI for sample properties.

## Data model (new tables, all `property_id`-keyed, RLS: internal full + viewer-read-if-assigned, GRANTs to authenticated + service_role)

- `ghl_users` — agents per sub-account (id, name, email, role, is_active).
- `ghl_messages` — one row per message. Includes `direction`, `channel`, `message_type`, `user_id`, `sent_at`, and a defensively-set `response_source` enum: `human | automation | ai | system | unknown`. Classification rules:
  - Manual outbound SMS/email/call from a real GHL user → `human`
  - Workflow SMS/email → `automation`
  - AI agent message → `ai`
  - System-generated → `system`
  - Otherwise → `unknown`
  Human speed-to-lead KPIs use `response_source = 'human'` only. Automation and AI shown separately.
- `ghl_opportunities` — `status: open|won|lost|abandoned|unknown`, `monetary_value`, `assigned_to`, `lost_reason_raw`, `lost_reason_normalized`, `won_at`, `lost_at`.
- `ghl_opportunity_stage_history` — `from_stage_id`, `to_stage_id`, `changed_at`, `source: sync_diff|webhook|manual_backfill`. Sync-diff history is best-effort; intermediate stages between syncs may be missed. v1 reporting relies on current mapped stage state + available timestamps, not exact transition paths.
- `ghl_appointments` — `calendar_id`, `assigned_user_id`, `starts_at`, `ends_at`, `status: booked|confirmed|showed|no_show|cancelled|rescheduled|unknown`.
- `ghl_tasks` — `status`, `task_type`, `completed_at`, `counts_as_attempt` boolean. Created tasks do not auto-count; only completed contact-attempt tasks do, and they remain separate from direct outbound activity.
- `ghl_pipelines` — pipeline + stage catalog.
- `property_pipeline_mapping` — `stage_id → canonical_stage` enum: `new|contacted|engaged|appointment|showed|won|lost|ignore`.
- `property_sla_settings` — `first_response_seconds`, `attempts_24h`, `attempts_7d`, `stale_after_hours`, `critical_stale_after_hours`, `business_hours_only`, `after_hours_mode: count_raw|pause_until_open|exclude_from_sla|report_separately`, `timezone`.
- `property_business_hours` — per day-of-week opens_at/closes_at/is_closed.
- `agency_sla_defaults` — global fallback row used when a property has no override.
- `ghl_lead_facts` — **primary reporting table**, one row per lead lifecycle instance (a contact can have several). Carries `lead_created_at`, `assigned_user_id`, `pipeline_id`, `stage_id`, `canonical_stage`, `first_any_response_at`, `first_human_response_at`, `first_automation_response_at`, `first_ai_response_at`, `human_speed_to_lead_seconds_raw`, `human_speed_to_lead_seconds_business`, `first_human_response_channel`, `human_attempt_count`, `automation_touch_count`, `ai_touch_count`, `total_touch_count`, appointment + win/loss fields, `is_open`, `is_stale`, `last_human_activity_at`, `last_activity_at`.

Extend `ghl_contacts` with convenience fields only: `first_human_response_at`, `latest_human_response_at`, `assigned_user_id`, `has_opportunity`, `latest_opportunity_id`, `duplicate_group_id`.

Indexes on `property_id`, `contact_id`, `opportunity_id`, `assigned_user_id`, `lead_created_at`, `sent_at`, `stage_id`, `canonical_stage`, `response_source`.

## Calculation rules (locked)

- **Human speed-to-lead** = earliest outbound message/call with `response_source = human` and `sent_at > lead_created_at`.
- **Automation speed-to-lead** and **AI speed-to-lead** computed the same way against their classes.
- **Attempt counts split**:
  - `human_attempt_count` = manual outbound calls + SMS + email + qualified completed contact-attempt tasks
  - `automation_touch_count` = workflow messages / reminders / campaigns
  - `ai_touch_count` = AI agent responses
  - `total_touch_count` = sum
- **Business-hours-adjusted speed** stored alongside raw; SLA pass/fail uses the property's `after_hours_mode`. Example: lead Fri 7:30pm, response Mon 8:04am → raw 60+ h, business-hours 4 min.

## Sync changes (`supabase/functions/sync-ghl`)

Per property: pull users → upsert `ghl_users`; pull pipelines+stages → `ghl_pipelines`; pull contacts → `ghl_contacts`; pull conversations + messages for the window → `ghl_messages` with `response_source` classified at write time; pull opportunities (paginated) → `ghl_opportunities`, diffing `stage_id` to append `ghl_opportunity_stage_history` rows tagged `sync_diff`; pull calendar events → `ghl_appointments`, matching to contacts/opportunities; pull tasks for in-window contacts/opps → `ghl_tasks`; finally rebuild/update `ghl_lead_facts` per lifecycle instance.

Expand `check-ghl-access` to verify all required scopes and endpoints, plus pagination and rate-limit responses. Required scopes (to confirm in step 1 of the gate): `users.readonly`, `contacts.readonly`, `conversations.readonly`, `conversations/message.readonly` if applicable, `opportunities.readonly`, `calendars.readonly`, `tasks.readonly` if applicable.

## Admin UIs

- `/admin/properties/:id/pipeline-mapping` — list every pipeline/stage, per-stage dropdown → canonical stage. Multiple GHL stages may map to one canonical stage; some can be `ignore`. Unmapped stages trigger warnings. Keyword auto-suggest (booked/scheduled → appointment, showed/attended → showed, won/sold/paid → won, lost/no-show/bad-fit → lost, new/fresh → new, contacted/called/texted → contacted, replied/engaged/qualified → engaged) is a suggestion only; admin must confirm. Pipeline Conversion shows an empty state with "Set up pipeline mapping" CTA when missing.
- `/admin/settings` — agency-wide SLA defaults. Defaults: first_response_seconds=300, attempts_24h=3, attempts_7d=5, stale_after_hours=24, critical_stale_after_hours=48, business_hours_only=true, after_hours_mode=pause_until_open.
- `/admin/properties/:id/sla` — per-property overrides + business-hours editor + timezone.

## Aggregation functions (SECURITY DEFINER, `SET search_path = public`, enforce `has_role('internal')` OR `viewer_can_access` for every requested property; accept `_property_ids uuid[]` null = agency, `_from`/`_to timestamptz`)

1. **`lead_perf_speed`** — median raw + business human speed; % human <1m / <5m / <15m; % never human responded; currently waiting; median automation and AI speed; human-vs-automation gap. **Currently waiting** ignores the date range and is computed from open lead facts created in a configurable active window (default 14–30 days) with no `first_human_response_at`.
2. **`lead_perf_handling`** — new, assigned, contacted, engaged; avg human attempts / automation touches / total touches; leads with 0 / 1 / 3+ human attempts; stale warning count; critical stale count.
3. **`lead_perf_pipeline`** — counts per canonical stage and transition rates (new→contacted, contacted→engaged, engaged→appointment, appointment→showed, showed→won, lead→appointment, lead→won). Returns a clear `needs_mapping` state when no mapping exists. Does not overclaim sync-diff transition accuracy.
4. **`lead_perf_agents`** — per agent: assigned, contacted, contact rate, booked, booking rate, showed, show rate, won, win rate, median human speed (raw + business), avg human attempts, stale counts, `low_sample` boolean (true when assigned < 5). Low-sample agents are visible by default with a badge; UI toggle hides them.
5. **`lead_perf_quality`** — unassigned, missing opportunities, no disposition, duplicate contacts, duplicate opportunities, lost without reason, unmapped pipeline stages, unknown response source count, lead facts missing contact, appointments missing status. Duplicate rule: same property + normalized phone OR normalized email within 30 days.

**Drill-in functions are required** for every KPI tile — never-responded, currently-waiting, stale, critical stale, unassigned, missing-opportunity, lost-without-reason, duplicates, unknown-source, slow-response leads, low-contact-rate agents, appointments without status, unmapped stages. Each row returns: contact name, phone/email, property, assigned agent, lead-created timestamp, current stage, canonical stage, last activity, first human response timestamp, speed-to-lead, attempt count, issue type, GHL deep link when available.

## Frontend (`/lead-performance`, sidebar: "Lead Performance", internal-only initially)

Controls: scope toggle (All / single), `PropertySwitcher`, `DateRangeContext`, refresh, mapping-warning banner when the selected property has unmapped stages, SLA-defaults banner when no override exists.

- **Section 1 Speed to Lead** — 6 primary tiles (median human, % <1m, % <5m, % <15m, % never, currently waiting). Secondary row: median automation, median AI, human-vs-automation gap, raw vs business-hours toggle.
- **Section 2 Lead Handling** — 6 tiles + stale bucket table (>24h, >48h, >7d, no human response, no stage movement).
- **Section 3 Pipeline Conversion** — horizontal funnel chart + stage-to-stage table + lead→appointment, lead→won, lost view. Empty state when mapping missing.
- **Section 4 Agent Leaderboard** — sortable table per the columns above; low-sample badge; toggle to hide low-sample agents.
- **Section 5 Data Quality** — 7 tiles, each click-throughs to drill-in list.

Every KPI carries a formula tooltip; coloring driven by per-property SLA settings (fallback to agency defaults).

## Migration / build order

- **Migration A** — all new tables, enums, RLS, GRANTs, indexes; `ghl_contacts` convenience columns.
- **Migration B** — five `lead_perf_*` aggregation functions.
- **Migration C** — drill-in functions.
- **Backend phase 1** — expand `sync-ghl` to populate users, pipelines, messages, opportunities, appointments, tasks, lead facts.
- **Backend phase 2** — expand `check-ghl-access` to verify all required scopes/endpoints, pagination, rate-limit behavior.
- **Frontend phase 1** — pipeline mapping screen, per-property SLA, agency SLA defaults.
- **Frontend phase 2** — `/lead-performance`, section by section.
- **Backfill** — re-run `sync-ghl` for every connected property.
- **Validation** — compare to GHL UI for sample properties: new leads count, opportunity count, appointments booked, won/lost, agent assignment, message counts, first human response timestamps.

## Out of scope

Realtime websockets, per-user OAuth, CSV export, lost-reason taxonomy editor, webhook-based lifecycle reconstruction, conversation transcript viewer, revenue attribution outside GHL, Google Ads / GA4 / CTM / Meta / other non-GHL integrations.

## Status

Migrations A, B, C are landed.
- **A** — all new tables + enums + RLS + GRANTs + indexes; `ghl_contacts` extended.
- **B** — five `lead_perf_*` aggregation functions (speed, handling, pipeline, agents, quality), `anon`-locked.
- **C** — single `lead_perf_drill(_issue_type, ...)` dispatcher for all 13 drill-in lists.

Next up: backend phase 1 — expand `sync-ghl` to populate users, pipelines+stages, messages (with `response_source` classified at write time), opportunities (+ stage-diff history), appointments (with `appointment_status_raw` + `status_is_derived`), and `ghl_lead_facts`. AI stays bucketed under `automation` for v1. Per-property task sync gated by a toggle, off by default.

Deferred (separate cleanup pass, not blocking this build): tighten the pre-existing `SECURITY DEFINER` linter warnings on legacy public-report and auth helpers.
