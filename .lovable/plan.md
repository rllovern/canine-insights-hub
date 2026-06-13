## Problem

When Jarvis is asked anything that hits the lead-performance RPCs (`lead_perf_speed`, `_handling`, `_pipeline`, `_agents`, `_quality`, `_drill`), the call fails with "not authenticated".

Root cause: those Postgres functions call `public.lead_perf_check_access(...)`, which does:

```sql
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  ...
```

Inside the Jarvis edge function we run every query through the service-role client (`svc()`), so `auth.uid()` is always NULL → the access guard raises, the tool surfaces it as a caveat, and the model tells the user "GHL came back with 'not authenticated'." It has nothing to do with the GHL sub-account connection; reconnecting GHL would not fix it.

## Fix

Run only the access-checked `lead_perf_*` RPCs through a user-scoped Supabase client so `auth.uid()` resolves to the signed-in user. Keep the service-role client for everything else (table reads/writes, logging tool runs, session/message persistence) so nothing else regresses.

### Changes — `supabase/functions/jarvis/index.ts`

1. **Capture the caller's JWT** in the request handler and build a second client:
   ```ts
   const userJwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
   const userSupabase = createClient(
     Deno.env.get("SUPABASE_URL")!,
     Deno.env.get("SUPABASE_ANON_KEY")!,
     { global: { headers: { Authorization: `Bearer ${userJwt}` } } },
   );
   ```

2. **Extend `Ctx`** with `userSupabase: ReturnType<typeof svc>` and pass it in at construction (line 1224).

3. **Route every `lead_perf_*` RPC through `ctx.userSupabase`** instead of `ctx.supabase`. Call sites to update (all in `supabase/functions/jarvis/index.ts`):
   - line 285 — `lead_perf_speed` (inside `get_lead_flow_summary` / equivalent)
   - line 288 — `lead_perf_handling`
   - lines 825–829 — `get_lead_performance_report` (speed, handling, pipeline, agents, quality)
   - line 867 — `lead_perf_drill`
   - line 979 — `lead_perf_quality` (data-quality audit tool)
   - lines 1056–1058 — client-summary facts (speed, handling, pipeline)

   Leave `ctx.supabase.rpc("user_can_access_property", ...)` and all `ctx.supabase.from(...)` reads/writes alone — Jarvis already runs its own `assertPropertyAccess` check before any tool body, so the service-role table reads are intentional and correct.

### Why this is safe

- The Jarvis function already enforces per-tool property access via `assertPropertyAccess` → `user_can_access_property` before any RPC runs, so we are not loosening access.
- `lead_perf_check_access` will now see the real user id and pass for internal users / property viewers exactly as it does from the dashboard's normal RPC calls.
- No DB migration required, no schema or RLS changes, no other tools affected.

## Verification

1. After deploy, reload `/assistant?session=<uuid>` and ask: "What's Taylor's average speed-to-lead from form submissions for June 1–13?" — expect a numeric answer instead of the "not authenticated" caveat.
2. Run a `Lead Performance` report via Jarvis (`get_lead_performance_report`) and confirm `speed`, `handling`, `pipeline`, `agents`, `quality` all come back with data, no caveats containing "not authenticated".
3. Confirm existing flows still work: session persistence to `ai_agent_sessions` / `ai_agent_messages`, tool-run rows in `ai_agent_tool_runs`, and saved reports in `ai_agent_reports`.

## Out of scope

- No changes to GHL sync, the `save-ghl-connection` / `check-ghl-access` functions, or the GHL connection dialog — the GHL connection is not the problem.
- No DB migration; `lead_perf_check_access` stays as-is.
- No Phase 3 alert work.
