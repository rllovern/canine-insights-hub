# Marketing Ops and Client Lifecycle: Master Implementation Plan (rev. 4)

Five-phase architecture approved in principle. Nothing is built until you explicitly authorize Phase 1. This revision folds in your eight final requirements; the structure is unchanged.

## Part A. Security foundation

(Unchanged from rev. 3: schema `mops` not exposed to the browser; zero privileges for `PUBLIC`/`anon`/`authenticated`; RLS on with no policies; `public.mops_my_access()` as the only browser-callable check; `mops.has_access(uid)` for `service_role` only; global single-active-grant index; shared `mops-*` endpoint wrapper; protected audit log, journal revisions and insert-only change events; recovery via `mops.recover_access` run through Lovable's supported project administration, authorized by the project owner workspace, never by the lost account or a chat claim alone. This is application-level privacy; authorized infrastructure administrators retain database access.)

Access is granted only to rl.lovern@gmail.com through the grant table. The Super Admin role grants nothing, including to other super admins and to preview-as-role mode.

### A1. Internal (non-user) access paths — the controlled exceptions

| Path | Runs as | May touch | Cannot |
|---|---|---|---|
| Lifecycle trigger on `properties` insert | owner-owned definer function `mops.init_lifecycle()` | insert one `mops.client_lifecycle` row (ON CONFLICT DO NOTHING) | read any `mops` data; return anything to the caller |
| Questionnaire trigger on `onboarding_submissions` -> submitted | `mops.on_questionnaire_submitted()` | set stage forward only, write `audit_log` row (actor = `system:questionnaire`) | move stage backward; read journal/assets |
| Change-history job `mops-ads-changes-sync` | cron secret, no user | insert into `ads_change_events`, `ads_change_sync_state`, `audit_log` | read any other `mops` table; be called with a user token |
| Everything else (Bob, old assistant, reports, exports, public token functions, existing sync/alerts, onboarding-public) | — | nothing in `mops` | — |

Rules: trigger functions are `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` revoked from `PUBLIC/anon/authenticated` (triggers fire regardless of caller grants), and they return `NEW` only, so no private data reaches the calling app. The cron job uses its own narrow wrapper (`cronHandler`) that rejects user tokens and only accepts the existing vault cron secret.

Tests cover each exception: a static test lists the exact allowed definer functions that reference `mops` (any new one fails); the cron endpoint rejects a valid user token, rejects missing/wrong secret; trigger tests prove a viewer inserting/submitting through existing flows gets no `mops` data back and cannot call the trigger functions directly.

### A2. Environment verification gate (before any Phase 1 migration)

Verified so far (live, read-only): service role bypasses RLS; existing definer functions are owned by `postgres`; signed-in users cannot create objects in `public`; no `mops` schema exists; `get_property_by_report_token` already filters inactive properties.

Still UNVERIFIED and checked as Phase 1 step 1 on a disposable test schema `mops_probe` (dropped afterwards): migrations can create a schema and revoke `USAGE`; default privileges apply; `postgres` can own definer functions in it; triggers on `public` tables can call into it; edge functions with the service key can read it through a non-exposed schema client; `authenticated` truly gets "permission denied". If creating a dedicated owner role is not permitted, functions are owned by `postgres` (the existing pattern). If any check fails, implementation stops and I report back before adapting.

## Part B. Data model

Unchanged from rev. 3, with these changes:
- `journal_entries`: only `id, property_id, body, created_at, updated_at, archived_at`. No tags or categories. `journal_revisions` keeps every prior body verbatim.
- `ads_change_events`: adds `scope` (`campaign` or `account`), `campaign_id` nullable; `property_id` nullable.
- New `ads_change_sync_state`: per Google Ads customer, `last_success_through`, `last_attempt_at`, `consecutive_failures`.

## Part C. Phases

**Requirement 1 — prospects and inactive locations (finding):** existing sync jobs, Command Center data and the location list do not filter on `is_active` (only the public report token check does). Creating prospect properties today could leak them into reporting. Therefore:
- Phase 1 creates no new property records. The directory shows only the existing 11 locations.
- Prospect support moves into Phase 2 and starts with an audit of every place that lists properties; a prospect is only allowed once each place is shown to exclude it (with a stored `is_active = false` and no connected data sources). Any filter added must leave current active-location results byte-identical, checked by before/after comparison.

**Requirement 2 — questionnaire prerequisite:** enforced in the database. `client_requirements` rows other than questionnaire stay `locked` until `client_lifecycle.questionnaire_submitted_at` is set; endpoints refuse status changes on locked items. After submission, each requirement advances independently based on its own dependencies. Legacy locations are marked as having a pre-existing questionnaire equivalent so nothing is fabricated.

**Requirement 3 — change-history resilience (Phase 4):**
- Daily job reads from `last_success_through - 2 days` to now, capped at Google's 30-day window; after an outage it catches up the full available window automatically. Gaps older than 30 days are recorded as a visible "unrecoverable gap" note, not silently skipped.
- Idempotent by Google's change resource name; per-customer state so one failing account doesn't block others; quota backoff.
- Shared accounts: a change is attributed to a location only when its campaign matches that location's existing campaign label filter. Account-wide changes (account settings, shared negative lists, shared budgets) are stored with `scope = account` and shown on every location sharing that account labeled "Account-wide", never assigned to a single location.

**Requirement 4 — journal:** one text box, one Save button. Edits keep the original and all revisions. No required fields anywhere.

**Requirement 7:** the GHL-to-CTM PHP integration and Bob (jarvis and its tools) are not modified. Static tests confirm no file under `jarvis`, `ai-assistant` or the form integration changes reference `mops`.

Phases 2–5 otherwise as in rev. 3.

## Part D. Phase 1 execution checklist

1. **Environment gate** — `mops_probe` checks from A2; drop probe; report results.
2. **Migration `mops_foundation`** — schema `mops`; revokes and default privileges; tables `access_grants` (+ `one_active_grant` index), `audit_log` (+ no-update/delete trigger), `client_lifecycle`; functions `public.mops_my_access()`, `mops.has_access(uuid)`, `mops.recover_access(uuid, text)`, `mops.init_lifecycle()` + AFTER INSERT trigger on `public.properties`; grants exactly as Part A.
3. **Data step** — insert the single grant for rl.lovern@gmail.com's account ID; insert legacy lifecycle rows for the 11 existing properties.
4. **Shared code** — `supabase/functions/_shared/mops/guard.ts` (`mopsHandler`), `_shared/mops/audit.ts`.
5. **Endpoints** — `supabase/functions/mops-directory/index.ts` (list with stage, questionnaire status, connection status from `property_data_sources`, last activity); `supabase/functions/mops-client/index.ts` (one location's profile; questionnaire answers read-only from `onboarding_submissions`).
6. **Frontend** — `src/hooks/useMopsAccess.ts`; `src/components/RequireMopsAccess.tsx`; `src/pages/ops/OpsDirectory.tsx`; `src/pages/ops/OpsClient.tsx` (Overview, Business Discovery, Access & Assets placeholder, Performance links); routes `/ops` and `/ops/:propertyId` in `src/App.tsx`; menu item in `src/components/layout/Sidebar.tsx` and `MobileNav.tsx` gated by `useMopsAccess` (not `superAdminOnly`); `mops` query cache cleared on sign-out.
7. **Tests** — `_shared/mops/static_test.ts` (wrapper use, no direct service key, no `mops` outside allowed paths, allowed definer list); `mops-directory/index_test.ts`, `mops-client/index_test.ts` (no token, each role, revoked grant, forged user ID -> 404 + denied audit row; you -> 200); SQL privilege test (zero grants to `PUBLIC/anon/authenticated`, second active grant fails, audit update/delete fails, lifecycle trigger fires and returns nothing private); regression: Command Center, reports, Bob answer unchanged for each role; database linter.
8. **Docs** — AGENTS.md rule (access only via `mops.access_grants` + `mops-*` guard); `docs/SYSTEM_OVERVIEW.md` section on Marketing Ops security and recovery.

Not in Phase 1: prospects, onboarding requirements, SOPs, journal, change history, intelligence.
