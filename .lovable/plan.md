# Private Access Control for the Marketing Operations System

Scope of this plan: how the "only one named person" rule is enforced and tested. It is a design document only. No tables, pages, or functions are built until you approve it. The rest of the Marketing Operations system (client directory, onboarding, SOPs, journal, and so on) will be planned separately and will build on this foundation.

## The rule in plain terms

- Being a Super Admin is not enough. Access requires (1) being signed in and (2) holding a separate, explicit "Marketing Ops" grant tied to your exact account.
- At launch, exactly one account holds that grant: yours. No screen exists to hand it to anyone else. Changing it requires a deliberate database change.
- Everyone else gets nothing: other Super Admins, Admins, Owners, Location Owners, Internal, Viewers, logged-out visitors, public report links, and Bob.
- All existing pages, reports, exports, roles, and Bob keep working exactly as they do now.

## How it is enforced (four layers)

```text
Browser page  ->  Private API functions  ->  Private database area  ->  Grant table
 (hides menu)     (check grant first)        (locked by row rules)      (1 row: you)
```

1. **Grant table (source of truth).** A new, separate grant table holds one row per allowed account, keyed by account ID (not email, not role). It is not part of the existing roles table, so promoting someone to Super Admin never touches it. Nobody can read or edit it through the app; it is only checked by a locked-down check function.
2. **Private database area.** All Marketing Ops data lives in its own walled-off section of the database, separate from the reporting data. Every table there: no access at all for logged-out visitors, and for signed-in users, rows are visible or editable only if the check function confirms the grant. Deletion of history (journal, change archive, audit log) is blocked for everyone.
3. **Private API functions.** Any server function serving Marketing Ops verifies the sign-in token, then checks the grant before doing anything. Because these functions run with elevated power that bypasses database rules, the grant check is mandatory in code, and they only ever act for the verified caller (never on an account ID sent by the browser). A shared guard helper is used by all of them, so no function can skip it. Failures return a generic "not found", revealing nothing.
4. **The page.** The menu item and pages appear only when the server confirms the grant. This is convenience only; security never depends on it.

## Keeping Bob and existing features out

- Bob's function, the old assistant, the monthly report function, public report links, sync jobs, alerts, and exports will not be given any reference to the private area. Their existing database access keys will be explicitly denied on it.
- Existing shared lookups and the Bob data summary functions are not changed and will not read private tables.
- An automated scan (part of testing) searches Bob's and the reporting functions' code for any reference to the private area and fails if one appears.
- Private data is never copied into existing tables (daily metrics, incidents, reports, and so on).

## Audit trail

- Every read of sensitive records (access details, operational notes) and every change is written to a private, append-only log. Denied attempts are also logged, including which account tried.

## How it will be tested (before release)

Test accounts will be created for each role and removed after.

| Who | Expected result |
|---|---|
| You (signed in) | Full access |
| Another Super Admin | Menu hidden; direct page link redirects; every API call refused; direct database reads return nothing; writes rejected |
| Admin, Owner, Location Owner, Internal, Viewer | Same as above |
| Logged out / public report link | Refused at every layer |
| Bob, asked directly about private notes or clients | No access; code scan clean |
| You, with the grant temporarily removed | Locked out (proves it is the grant, not the Super Admin role) |
| Existing pages and reports for every role | Unchanged; quick spot-check run |

Plus: a database security scan, and a check that private tables have no public access permissions at all.

## Decisions needed from you

- Confirm the single allowed account is rl.lovern@gmail.com.
- If you ever lose access to that account, recovery is a manual database change by me on your request. Acceptable?

## Technical details

- Schema `mops` (not exposed beyond `authenticated`); `REVOKE ALL ... FROM anon, public`; grant only `authenticated` plus `service_role`.
- `mops.access_grants(user_id uuid PK, granted_at, granted_by, note)`; RLS enabled, zero policies, no grants to `authenticated` (hidden). Seeded with one row via data insert after migration.
- `public.has_mops_access(_uid uuid) returns boolean` SECURITY DEFINER, `search_path` pinned, `EXECUTE` revoked from `anon`/`public`.
- Every `mops.*` table: RLS on; policies `TO authenticated USING (public.has_mops_access(auth.uid())) WITH CHECK (same)`; no `DELETE` policy on journal/change archive/audit tables; immutability trigger on audit log.
- `supabase/functions/_shared/mops-guard.ts`: validates JWT via `getClaims`, calls `has_mops_access` with the user-scoped client, returns 404 on failure, writes denial to `mops.audit_log`. Private functions prefixed `mops-`; service-role client used only after guard passes, with `user_id` taken from claims.
- Bob isolation: no `mops` references in `jarvis`, `ai-assistant`, `monthly-report-data`, `onboarding-public`, report token RPCs; CI-style `rg "mops"` check across those directories. `ai_assistant_context*` untouched.
- Frontend: `useMopsAccess()` calls the RPC; `RequireMopsAccess` route guard; nav item gated by it (not `superAdminOnly`). Preview-as-role mode cannot grant access.
- Record the rule in AGENTS.md: "Marketing Ops access = explicit per-user grant in `mops.access_grants`, never role-derived."
