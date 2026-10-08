# Marketing Ops and Client Lifecycle: Complete Implementation Plan

Nothing is built until this plan is approved. Built in five phases, each released and checked before the next.

## Part A. Security foundation (final)

**Verified against the live database (Oct 8 2026):** service accounts bypass row rules (confirmed); existing locked-down check functions are owned by `postgres` (confirmed); signed-in users cannot create objects in `public` (confirmed); there is currently no `mops` schema; the read-only audit account cannot create roles, so whether migrations may create a dedicated owner role is UNVERIFIED and becomes Phase 1, step 1 (fallback: functions owned by `postgres`, the same pattern already in use).

**Access rule:** signed in AND a grant row for that exact account. No role grants access.

**Where data lives:** schema `mops`, not exposed to the browser API. The browser never reads private tables. All data goes through `mops-*` backend endpoints.

**Privileges (exact):**
```sql
CREATE SCHEMA mops;
REVOKE ALL ON SCHEMA mops FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mops TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA mops REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA mops REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
-- per table: RLS ON, zero policies; service_role gets SELECT/INSERT (+UPDATE only where edits are allowed); never DELETE/TRUNCATE.
```

**One active grant, globally (exact constraint):**
```sql
CREATE TABLE mops.access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, reason text);
CREATE UNIQUE INDEX one_active_grant ON mops.access_grants ((true)) WHERE revoked_at IS NULL;
```
The index has a constant key, so a second active row of any user fails.

**Browser-callable check (resolves the RPC tension):**
```sql
CREATE FUNCTION public.mops_my_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM mops.access_grants WHERE user_id = auth.uid() AND revoked_at IS NULL) $$;
REVOKE ALL ON FUNCTION public.mops_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mops_my_access() TO authenticated;

CREATE FUNCTION mops.has_access(_uid uuid) ... SECURITY DEFINER SET search_path = '';
REVOKE ALL ON FUNCTION mops.has_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mops.has_access(uuid) TO service_role;
```
No arguments, answers only for the caller, returns no data. Used to show/hide the menu; every endpoint re-checks.

**Endpoints:** every `mops-*` function uses one shared wrapper that verifies the token, takes identity only from it, checks `mops.has_access`, logs the outcome, and only then creates the privileged client. Denials return 404. Request bodies reject any user ID field.

**Bypass prevention (automated tests that block release):**
1. Static test: every `mops-*` function must use the wrapper and must not read the service key itself; no other function (Bob, old assistant, reports, onboarding-public, sync, alerts) may reference `mops`.
2. Endpoint registry test: each `mops-*` folder must have its denial tests.
3. Live tests per endpoint: no token, every other role, revoked grant, forged user ID all get 404 and a `denied` log row.
4. Database test: zero privileges for `anon`/`authenticated`/`PUBLIC` on `mops`; only the two approved definer functions touch `mops`; existing `public` definer functions confirmed not to read `mops`.

**Audit and history:** `mops.audit_log` (allowed, denied, error; IDs only, never secret contents). Journal edits copied to `mops.journal_revisions`. Google Ads events insert-only. Update/delete blocked by triggers on audit log, revisions and change events. No hash chain and no digest emails. Retention via normal platform backups.

**Plain limit:** this is application-level privacy. Authorized infrastructure administrators with database-owner access can still read or alter data; protections stop the app, its users, its functions, and leaked app keys.

**Emergency recovery:** through Lovable's supported project administration. The project owner (you, signed into the Lovable workspace that owns this project; or Lovable support after their own account verification) authorizes it. It does not need the lost account. The administrator runs `mops.recover_access(new_user_id, reason)`, owner-only: revokes the active grant, inserts the new one in one transaction, writes `access_revoked` and `access_granted` audit rows. The AI agent only runs it when instructed from the owning workspace and never treats a chat claim alone as identity proof. Afterwards, the denial tests are re-run.

## Part B. Data model (all in `mops`, linked to existing tables)

Existing `properties` remain the single client record. No duplicate client table. Prospects are created as inactive properties through the existing creation flow.

| Table | Purpose / key fields |
|---|---|
| `client_lifecycle` | 1 row per property (PK `property_id`): stage (prospect, questionnaire, access_discovery, configuration, validation, active, paused, archived), `legacy` flag, ownership model, billing responsibility, billing status, `last_activity_at` |
| `requirement_catalog` | SOP library: key, area (google_ads, ctm, ghl_forms, website, access, billing), title, instructions (markdown), how verified (auto, detect+confirm, manual, conditional), applicability rule |
| `client_requirements` | per property x requirement: status (not_started, awaiting_access, in_progress, awaiting_verification, verified, blocked, not_applicable), severity (blocking/warning), evidence JSON, unique (property, requirement) |
| `requirement_decisions` | exceptions: requirement, resolution, reason, authorized by, date |
| `client_assets` | per property x platform (ads, GA4, GTM, GSC, GBP, website, CTM, GHL): exists (yes/no/unknown), controlled by (corporate/franchisee/prior agency/unknown), access status, external ID, notes. No passwords ever |
| `form_integration_config` | GHL-to-CTM snippet references per property (thank-you slug, FormReactor ID, tracking number, capture host, default form) plus installed/redirect/thank-you/FormReactor/end-to-end test status. Record-keeping only; the live integration is not touched |
| `journal_entries` / `journal_revisions` | freeform note, optional tags, property, timestamps, archived flag; revision copy on every edit |
| `ads_change_events` | archived Google Ads changes: unique (customer_id, change resource name), property, campaign, type, old/new values, event time (UTC), raw JSON |
| `note_event_links` | optional journal-to-change links |
| `ops_signals` | Phase 5: state (healthy/observing/action_required), reason, opened/resolved, cooldown key |
| `access_grants`, `audit_log` | from Part A |

Legacy locations get `legacy = true` and `legacy_unverified` requirement status, which is shown neutrally and never counted as a problem unless live data shows one.

## Part C. Phases

**Phase 1: Private Client Directory**
- Security foundation, grant for rl.lovern@gmail.com, tests.
- Directory page (private menu item): search, filter, sort, Active vs Onboarding tabs, columns for stage, questionnaire status, readiness, Google Ads/CTM/GHL connection (read from existing connection data), ownership, billing, last activity, "needs attention".
- Client profile: Overview, Business Discovery (shows existing questionnaire answers read-only), Access & Assets, Configuration, Journal, Performance (links into existing pages, no duplicate charts).
- Backfill lifecycle rows for the 11 existing properties as legacy.

**Phase 2: Adaptive Onboarding**
- Lifecycle row created when a property is created and when an invite is sent (from existing flows, idempotent).
- Valid questionnaire submission moves stage to Access & Discovery automatically; repeat submissions never roll back progress.
- Requirements generated from questionnaire answers (which accounts exist, who owns them) using the catalog rules.
- Consolidated access instructions generated per client (what they have, what to grant, which corporate identity to invite, what corporate will create). Sent via the existing email service; a client-facing view, if used, reuses the onboarding token pattern and shows only those instructions.
- Ownership/billing tracking: corporate vs franchisee control, franchisee pays Google directly, billing status entered manually unless the Google Ads API confirms it (to be checked; manager linkage is not treated as ownership).

**Phase 3: SOPs and verification**
- Load the Google Ads (A–L) and CTM (A–I) areas into the catalog as section headings only. Full instruction text is NOT invented: you supply the Asana SOP exports and they are imported verbatim.
- Auto-verification where real evidence exists: Google Ads connected and spending, CTM calls arriving for the property, GHL leads syncing, budget present in existing pacing. Everything else is detect-and-confirm or manual once.
- Profile shows completed / outstanding / blocked / next action; detailed steps in expandable sections.

**Phase 4: Journal and Google Ads change history**
- One-box note entry (type and save; optional tags), search by keyword and date, edit with history.
- New private job archives Google Ads change events daily with a 3-day overlapping lookback, deduplicated by the Google resource ID, mapped to properties using existing campaign label filters. Reuses the existing change-history code as a reference only; the existing function Bob uses is unchanged. Google keeps ~30 days, so history starts at go-live plus that window.
- Unified timeline: notes, Google Ads changes, data-source incidents, budget changes. Suggested note-to-change links by time and campaign, one click to confirm.

**Phase 5 (optional): Private intelligence**
- Rule-based states (Healthy, Observing, Action Required) from existing signals: qualified leads, CRM sales, pacing, freshness, incidents, readiness; minimum samples, persistence and cooldowns; auto-resolve.
- Private Operations Brief page: who needs attention, onboarding blockers, recent changes, what changed since last visit.
- Optional private AI summary through a separate `mops-ai` endpoint with its own wrapper, usage cap and audit, built only on your request. Never shares Bob's code path.
- Read-only: nothing ever changes Google Ads, CTM, or GHL automatically.

## Part D. Not changed

Bob and all its tools, the old assistant, existing reports and PDFs, exports, the public report links, onboarding questionnaire content, sync jobs, and the live GHL-to-CTM form integration.

## Part E. Needed from you

1. Asana SOP exports (Google Ads and CTM templates, including nested instructions and the position-increase rule).
2. Asana historical notes export, if you want them imported into the journal (Phase 4).
3. Confirm Phase 5 is wanted, and whether to include the private AI summary.

## Technical details

- Shared wrapper: `supabase/functions/_shared/mops/guard.ts`; static/registry tests in `_shared/mops/*_test.ts`; endpoints `mops-directory`, `mops-client`, `mops-onboarding`, `mops-journal`, `mops-changes`, `mops-brief`, cron job `mops-ads-changes-sync` (cron secret + no user context, writes only to `ads_change_events`).
- Lifecycle initialization: AFTER INSERT trigger on `properties` and on `onboarding_submissions` status change to submitted calls a `mops`-owned definer function; triggers run as owner so no browser privilege is added.
- Frontend: `useMopsAccess()` (RPC), `RequireMopsAccess` route guard, TanStack queries keyed under `mops` and cleared on sign-out; nav item gated by the RPC, not `superAdminOnly`; preview-as-role cannot unlock it.
- AGENTS.md rule: Marketing Ops access derives only from `mops.access_grants`, through `mops-*` endpoints using the shared guard.
