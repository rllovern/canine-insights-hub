# Marketing Ops: Private Access Security Specification (rev. 2)

Scope: security architecture only. Nothing is built until approved. Feature design (directory, onboarding, SOPs, journal UI, change archive) follows in a separate plan on top of this foundation.

## 1. Principles

1. Access = verified sign-in AND an explicit grant tied to one account ID. No role (including super_admin) implies access.
2. The browser never touches private tables. All private data moves through a small set of authenticated backend endpoints.
3. Identity always comes from the verified sign-in token. No endpoint accepts a user ID for authorization.
4. Deny by default at every layer; a forgotten check fails closed, not open.
5. Existing roles, pages, reports, exports, sync jobs, and Bob are untouched.

## 2. Exact permission model (resolves the RPC tension)

All private objects live in a dedicated schema `mops`, which is NOT added to the Data API's exposed schemas. Even with a valid token, the browser cannot address it.

```sql
-- Schema: nobody but the owner and service_role
REVOKE ALL ON SCHEMA mops FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mops TO service_role;

-- Every table in mops
REVOKE ALL ON ALL TABLES IN SCHEMA mops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA mops TO service_role;  -- no DELETE by default
ALTER DEFAULT PRIVILEGES IN SCHEMA mops REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA mops REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- RLS still enabled on every mops table, with ZERO policies for anon/authenticated
-- (defense in depth if a grant is ever added by mistake).
```

**Grant table** `mops.access_grants(user_id uuid PK, granted_at, granted_by_note, revoked_at, revoked_reason)`. Active grant = row with `revoked_at IS NULL`. A unique partial index enforces at most one active grant (single-owner system by construction).

**Access check (the only browser-callable piece):**

```sql
CREATE FUNCTION public.mops_my_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM mops.access_grants
       WHERE user_id = auth.uid() AND revoked_at IS NULL) $$;
REVOKE ALL ON FUNCTION public.mops_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mops_my_access() TO authenticated;
```

- Takes no arguments; answers only "do I have access?" for the caller. It cannot probe other accounts and returns no private data. Returns false for everyone else, so it leaks only the fact that a feature exists, which the code already reveals.
- Owned by a dedicated non-login role `mops_owner` (not `postgres`) that holds SELECT on `access_grants` only.
- Server-side variant `mops.has_access(_uid uuid)` exists for endpoints, executable by `service_role` only, never by `authenticated`.

**Frontend:** calls `mops_my_access()` to decide whether to show the menu and route. That is cosmetic. Every data request still goes to an endpoint that re-checks.

## 3. Endpoints and the service-role problem

Service-role credentials bypass RLS, so the database cannot be the last line of defense for privileged code. Enforcement therefore sits in a single mandatory wrapper.

**3.1 The wrapper** (`supabase/functions/_shared/mops/guard.ts`):

```ts
export const mopsHandler = (handler: (ctx: MopsCtx) => Promise<Response>) =>
  async (req: Request) => { /* CORS; verify JWT via getClaims; reject if none;
    uid = claims.sub; call mops.has_access(uid) with service client;
    on deny: audit(denied) and return 404;
    on allow: build ctx { uid, db: scoped client, audit } and run handler;
    audit(allowed/failed) in finally */ };
```

- The privileged database client is created INSIDE the wrapper and handed to the handler only after the grant passes. Handlers never import the service key themselves.
- `ctx.uid` is the only identity available. Request bodies are validated with a schema that rejects any `user_id`/`actor` field.
- Denials return 404 with no body detail.

**3.2 Preventing omission (automated, fails the release):**

1. **Naming rule:** every private endpoint is named `mops-*`. Nothing else may reference schema `mops`.
2. **Static check test** (Deno test in `_shared/mops/static_test.ts`), run on every change:
   - every `supabase/functions/mops-*/index.ts` must call `Deno.serve(mopsHandler(...))` and must not reference `SUPABASE_SERVICE_ROLE_KEY` or `createClient` directly;
   - no function outside `mops-*` and `_shared/mops` may contain the string `mops.` / `schema('mops')`, including `jarvis`, `ai-assistant`, `monthly-report-data`, `onboarding-public`, sync and alert functions.
3. **Live denial tests** per endpoint (Deno tests): no token, other super admin, admin, owner, location owner, viewer, revoked grant, and forged `user_id` in body each get 404 and produce a `denied` audit row; the granted user gets 200 and an `allowed` row.
4. **Endpoint registry test:** a list of all `mops-*` functions is enumerated from the folder and compared with the tests; an endpoint without denial tests fails the check.
5. **Database drift check** (SQL test): asserts zero privileges for `anon`/`authenticated`/`PUBLIC` on schema `mops` and all objects in it, `mops` absent from exposed schemas, and that no SECURITY DEFINER function outside the approved list reads `mops`.

Planned endpoints are few and coarse (e.g. `mops-directory`, `mops-onboarding`, `mops-journal`, `mops-changes`) to keep the attack surface small.

## 4. Audit logging

**Table** `mops.audit_log(id bigserial, at timestamptz default now(), actor uuid, endpoint, action, target_type, target_id, outcome ['allowed','denied','error'], request_id, ip_hash, detail jsonb)`.

- Written by the wrapper for every request: allowed, denied (including the caller's ID when the token is valid), and errors. Sensitive reads (access credentials, private notes) log the record ID read, never its contents.
- Reliability: the audit insert happens before the handler returns data; if the audit write fails, the request fails (no unlogged access). Denials use a best-effort write plus a console log so attackers cannot block logging to hide denial attempts from the platform logs.
- Protected by trigger: `BEFORE UPDATE OR DELETE` raises an exception; `service_role` has INSERT and SELECT only. TRUNCATE revoked.

**Journal edit history:** `mops.journal_entries` holds the current text; every change writes the prior version to `mops.journal_revisions` (trigger-driven, same no-update/no-delete protection). Entries are "archived," never deleted.

**Google Ads change archive:** `mops.ads_change_events` is insert-only (update/delete blocked by trigger); a unique key on the Google change resource ID makes re-imports idempotent. Your annotations live in a separate table linked to the event, so notes can be edited without touching the historical record.

**Limits of append-only (stated plainly):** triggers and revoked grants stop the app, the endpoints, and stolen service keys. They do not stop an infrastructure administrator with database-owner access, who can disable triggers, alter tables, or restore backups. Mitigations: protection triggers are owned by `mops_owner`; a daily hash chain (each audit row stores a hash of the previous row) makes silent edits detectable; a daily digest (row count + chain head hash) is emailed to you so tampering would be visible against an external record. This makes alteration detectable, not impossible.

## 5. Emergency access recovery

Used only if you lose your account (lost password with no email access, compromised account, account deleted).

1. **Request:** you contact the infrastructure administrator (Lovable agent acting on your instruction in this project, or Lovable support) from the project owner workspace.
2. **Identity verification:** the request must come from the Lovable workspace that owns the project, plus confirmation via the out-of-band email on record, plus the replacement account must be newly created and signed in once.
3. **Revoke:** set `revoked_at` and `revoked_reason` on the old grant (never delete). Optionally sign out all sessions of the old account.
4. **Replace:** insert a grant for the new account ID; the single-active-grant index guarantees the old one was revoked first.
5. **Log:** the recovery is done through one SQL procedure `mops.recover_access(old_uid, new_uid, ticket_ref)`, executable only by the database owner, which writes `access_revoked` and `access_granted` audit rows with the ticket reference in one transaction, and triggers an email notification to both old and new addresses.
6. **Verify:** run the full denial test suite against the old account and an allow test against the new one.

No UI exists to grant or revoke access. Routine grant changes use the same procedure.

## 6. Bob and existing systems

- Bob (`jarvis`), `ai-assistant`, `ai_assistant_context*`, report token functions, exports, and sync/alert jobs receive no `mops` privileges and are covered by the static check in 3.2.
- No private data is copied into public tables. Data may flow INTO `mops` from existing tables (read by `mops-*` endpoints), never out.
- Preview-as-role mode cannot grant access (check is server-side by real account).

## 7. Test plan before release

| Case | Expected |
|---|---|
| You | 200 on all endpoints; `allowed` audit rows |
| Other super admin, admin, owner, location owner, internal, viewer | 404 everywhere; `denied` rows; menu hidden; direct DB queries to `mops` rejected |
| No token / public report token | 401/404; no data |
| Your token + forged `user_id` in body | Ignored; acts as you only |
| Your grant revoked | 404 (proves grant, not role) |
| Update/delete on audit, revisions, ads events | Rejected by trigger |
| Static and privilege drift checks | Pass |
| Bob asked about private notes/clients | No access; static check clean |
| Existing pages for each role | Unchanged |

## 8. Decisions to confirm

- Designated account: rl.lovern@gmail.com.
- Recovery verification steps in section 5 are acceptable.
- Daily integrity digest email to you: yes/no.
