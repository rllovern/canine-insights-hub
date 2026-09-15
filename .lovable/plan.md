# Ads Agent — Phase 0 foundation

A standalone internal tool, fully separate from Bob. This phase creates storage, security, one read-only health check, and a single admin page. No AI calls, no Google Ads write operations.

## What gets built

**1. Storage (new tables, all prefixed `agent_`)**

The ten tables from the spec, verbatim: `agent_account_policies`, `agent_kill_switch` (seeded with the single unfrozen row), `agent_task_batches`, `agent_tasks`, `agent_executions`, `agent_rollbacks`, `agent_audit_log`, `agent_sessions`, `agent_messages`, `agent_llm_calls` — plus the listed indexes and check constraints.

Access: every table gets row level security on with one policy, full access only for super admins (`is_super_admin(auth.uid())`), plus the grants the data layer needs (without grants the data layer returns permission errors even when the policy passes). No staff or viewer access anywhere.

`agent_audit_log` is append-only: insert and read only; update and delete are revoked from every application role including the service role.

**2. Credentials**

- `GOOGLE_ADS_DEVELOPER_TOKEN_LEVEL` — added to the secret store; you supply the value (`basic` or `standard`). Nothing reads it in this phase.
- `ads_agent_refresh_token` — a new `get_ads_agent_refresh_token()` reader function granted to the service role only, mirroring `get_cron_secret_v2()` exactly. **Open decision:** writing the value into the vault means putting the token into a SQL statement in this chat, so by default you save it through the secure secret form and the reader falls back to that value. Say the word if you want vault-only instead.
- The existing `GOOGLE_ADS_DEVELOPER_TOKEN` is reused for the `developer-token` header; no new token secret.

This is a separate Google sign-in from the existing manager-account token. No agent code reads the existing one.

**3. Health check function: `ads-agent-health`**

Read-only. Steps, in order:

1. Resolve the caller from the request, look up `is_super_admin`; anything else — including an admin-role user — gets a 403.
2. Read the agent refresh token from the vault, exchange it for an access token at Google's token endpoint.
3. For each `agent_account_policies` row with `agent_enabled = true`, run the single campaign query against Google Ads v23 `searchStream` with the developer token and manager account `2189989288`.
4. For each property, read freshness from `property_data_sources.last_success_at` for `google_ads`, `ctm`, `ghl` only. A null timestamp reports "no data", which is kept distinct from "zero campaigns".
5. Return, per property: customer id, campaign count, campaign ids and names, the resolved allowlist, campaigns outside the allowlist, and the three timestamps with ages in hours.
6. Write one `agent_audit_log` row per call: actor `user:<uuid>`, event `health_check`.

**4. Admin page**

New route `/admin/ads-agent` inside the app shell, super admin only, and a matching entry in the admin nav group flagged super-admin only. The page is one panel: a button that runs the health check and a table of properties showing campaign counts, allowlist status, and freshness age in hours. Built from the existing shadcn components and page patterns already used on the other admin pages. No drawer, no Bob surface, no new design system.

**5. Cleanup**

- Delete the `jarvis-auth-debug` function.
- Delete the `seed-bob` function.
- Remove the `sync-sheet-sales` entry from the functions config (that directory does not exist).

Nothing else in `jarvis` or `ai-assistant` is touched.

## Explicitly not in this phase

AI chat, proposal generation, task queue UI, approvals, mutation execution, rollback, scheduled scanning, cron jobs. Also: no `:mutate` call anywhere, not even disabled.

## Notes and one flag

- `seed-bob` created the demo account "Bob (demo viewer)", which still exists as a user with viewer access to every location. Deleting the function does not remove that account or its access — say the word if you also want the account removed, otherwise it stays as is.
- Correction to my earlier audit: there are **10 locations, all active**, with exactly one Google Ads connection each (9 distinct customer ids; NoVA and Winchester share 9627559898). The earlier "7 locations" figure was wrong.
- `campaign_label_filter` is already set to `NoVA` and `Winchester` on the two rows for 9627559898; the other eight are null. Your post-build step 2 may already be done.
- `agent_account_policies` starts empty, so the first health run legitimately returns no properties; the page says that rather than looking broken.
- The completed read-only audit I was writing is superseded by this file; I can re-issue it separately on request.

## Technical details

- Migration order per table: create, grant, enable row level security, create policy. `agent_audit_log` additionally revokes update/delete after grants.
- Function path `supabase/functions/ads-agent-health/index.ts`; caller verification uses `getClaims` on the bearer token then the `is_super_admin` RPC, matching `admin-users`.
- Google Ads constants match the existing sync functions: API v23, REST via `fetch`, `developer-token` and `login-customer-id: 2189989288` headers, token exchange at `https://oauth2.googleapis.com/token`.
- Route registration: `<Route path="/admin/ads-agent" element={<RequireAuth requireSuperAdmin><AdsAgent /></RequireAuth>} />` inside the `AppShell` route in `src/App.tsx`, plus an `ADMIN_ITEMS` entry with `superAdminOnly: true` in `src/components/layout/navItems.ts`.
- Page fetches via `supabase.functions.invoke("ads-agent-health")` with react-query or local state consistent with `AdminDataSources.tsx`.
