# Ads Agent — Phase 0 (build), with pre-build check results

## Part 1 — Timezone check (report only, no fix)

All 10 locations are set to `America/New_York`, including the four you named as not Eastern:

```text
Ridgeside K9 Ashtabula        America/New_York  active
Ridgeside K9 Central IL       America/New_York  active
Ridgeside K9 DFW              America/New_York  active
Ridgeside K9 MoCo             America/New_York  active
Ridgeside K9 NorCal           America/New_York  active
Ridgeside K9 Ohio             America/New_York  active
RidgesideK9 Colorado Springs  America/New_York  active
RidgesideK9 NoVA              America/New_York  active
RidgesideK9 Winchester        America/New_York  active
RK9 Summerville - SC          America/New_York  active
```

NorCal (Pacific), Colorado Springs (Mountain), Central IL (Central) and DFW (Central) are all wrong. Not fixed in this task. Note that `agent_account_policies.timezone` also defaults to `America/New_York`, so blackout windows will inherit the same error unless set per row.

## Part 2 — Re-verified: no mutate operations anywhere

Searched `src` and `supabase/functions` for: `:mutate`, `mutateOperations`, `googleAds:mutate`, `campaignBudgets:mutate`, `adGroupCriteria:mutate`, the bare word `mutate` (case-insensitive), and every literal `googleads.googleapis.com` URL.

- `:mutate` — none
- `mutateOperations` — none
- `mutate` in any casing — none
- Every Google Ads URL in the repo (4 total, all `searchStream`):
  - `supabase/functions/google-ads-change-history/index.ts:111`
  - `supabase/functions/list-google-ads-labels/index.ts:72`
  - `supabase/functions/list-mcc-customers/index.ts:113`
  - `supabase/functions/sync-google-ads/index.ts:146`

No POST to `googleads.googleapis.com` on a path other than `searchStream`. The claim holds, now query-backed.

## Part 3 item 6 — Winchester residue row count

The delete you specified affects **6 rows**, total cost $0. Deleted as part of this build.

---

# What gets built

**1. Migration — 10 `agent_` tables, DDL verbatim from your spec**

`agent_account_policies`, `agent_kill_switch` (seeded `(1, false)`), `agent_task_batches`, `agent_tasks`, `agent_executions`, `agent_rollbacks`, `agent_audit_log`, `agent_sessions`, `agent_messages`, `agent_llm_calls`, plus every index and check constraint listed.

Per table, in order: create → grants → enable row level security → policy.

Nine tables (all but `agent_audit_log`):
- `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`
- `GRANT ALL ... TO service_role`
- no `anon` grant
- one policy `"super admin all"` `FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()))`

`agent_audit_log`:
- `GRANT SELECT, INSERT` to `authenticated` and `service_role`
- `GRANT USAGE, SELECT ON SEQUENCE agent_audit_log_id_seq` to both
- `REVOKE UPDATE, DELETE` from `authenticated`, `anon`, `service_role`, `PUBLIC`
- two policies: `"super admin read"` `FOR SELECT`, `"super admin insert"` `FOR INSERT` (your accepted split)
- trigger `agent_audit_log_immutable`: `BEFORE UPDATE OR DELETE FOR EACH ROW`, raises an exception — binds the owner, which the revokes do not

**2. Secrets**

- `ADS_AGENT_REFRESH_TOKEN` — secret store only, one source, read only by `ads-agent-health`. No vault row, no reader function, no fallback.
- `GOOGLE_ADS_DEVELOPER_TOKEN_LEVEL` — secret store, you supply `basic` or `standard`; nothing reads it this phase.
- Existing `GOOGLE_ADS_DEVELOPER_TOKEN` reused for the header.

Both are requested through the secure secret form during the build.

**3. Edge function `ads-agent-health`** (read-only)

`verify_jwt` stays at its default (no `config.toml` entry) **and** the function resolves the JWT user and calls the `is_super_admin` RPC first; anything else, admin role included, gets 403.

Then: exchange `ADS_AGENT_REFRESH_TOKEN` at `https://oauth2.googleapis.com/token`; for each `agent_account_policies` row with `agent_enabled = true`, POST the campaign GAQL to `v23 .../googleAds:searchStream` with `developer-token` and `login-customer-id: 2189989288`; read freshness from `property_data_sources.last_success_at` for `google_ads`, `ctm`, `ghl` only (null = "no data", distinct from zero results); return per property the customer id, campaign count, campaign ids and names, resolved allowlist, out-of-allowlist campaigns, and the three timestamps with ages in hours; insert one `agent_audit_log` row, actor `user:<uuid>`, event `health_check`.

Three standing rules written into the file as comments:
- Campaign identity is `campaign.id` from a live API call scoped to a `customer_id`. Never resolve a campaign by name; never join warehouse tables on campaign name across properties. `daily_metrics`, `campaign_budgets` and `campaign_labels` are keyed on (property_id, campaign name) — safe within a property, wrong across them.
- Once this function holds the service key, it must never accept a `property_id`, `customer_id` or `campaign_id` from the request body without re-validating it against `agent_account_policies` for the authenticated caller. RLS protects nothing past that point.
- No mutate operation ever, in any phase of this tool.

**4. Route `/admin/ads-agent`**

Registered inside the `AppShell` route in `src/App.tsx` behind `RequireAuth requireSuperAdmin`, plus an `ADMIN_ITEMS` entry with `superAdminOnly: true`. One page: a button that invokes the health function and a table of properties with campaign counts, allowlist status and freshness ages in hours. Existing shadcn components and page patterns only. Empty state for the (expected) case of zero enabled policies, and an error state.

**5. Cleanup**

- Delete edge function `jarvis-auth-debug`.
- Delete edge function `seed-bob`.
- Remove the `functions.sync-sheet-sales` entry from `supabase/config.toml`.
- Delete the Bob demo auth user `76ee5d03-...` (`bob@demo.rsk9insights.com`), its 1 `user_roles` row and its 5 `viewer_property_access` rows.
- Remove `BOB_USER_ID` and `BOB_EMAIL` from `src/lib/owners.ts` and the Bob impersonation path from `PreviewModeContext` (`impersonatedUserId` becomes null; the `location_owner` preview stays, just without impersonating a deleted user). Any consumer of the removed constants is updated in the same change.
- Run the Winchester delete (6 rows).

**6. Documentation**

Restore the audit to `docs/SYSTEM_AUDIT.md`, full text, with the Part B corrections applied inline and each marked as a correction showing the original claim next to the corrected one — including the newly verified "no mutate operations" evidence above. Durable records go in `docs/` from here on; `.lovable/plan.md` is working state.

## Out of scope

AI chat, proposals, task queue UI, approvals, mutation execution, rollback, scheduled scanning, cron jobs. No `:mutate` anywhere, not even disabled.
