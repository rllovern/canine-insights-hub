// Orchestrator: invoked every 12h by pg_cron. Runs sync-google-ads, sync-ctm,
// and sync-ga4 for every connected (client, source) pair, then logs each
// attempt to public.sync_runs so the admin UI can surface failures.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const SOURCE_TO_FN: Record<string, string> = {
  google_ads: "sync-google-ads",
  ctm: "sync-ctm",
  ga4: "sync-ga4",
  keyword_com: "sync-keyword-com",
  ghl: "sync-ghl",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Cron-only: require service role key OR CRON_SECRET bearer
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  let vaultCronSecret = "";
  try {
    const { data: vaultVal } = await admin.rpc("get_cron_secret_v2");
    vaultCronSecret = typeof vaultVal === "string" ? vaultVal : "";
  } catch (_e) { /* vault lookup optional */ }
  const matchesEnvSecret = !!CRON_SECRET && token === CRON_SECRET;
  const matchesVaultSecret = !!vaultCronSecret && token === vaultCronSecret;
  if (!token || (token !== SERVICE_KEY && !matchesEnvSecret && !matchesVaultSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const date_from = isoDaysAgo(30);
  const date_to = isoToday();

  // Pull every connected source row.
  const { data: srcRows, error: srcErr } = await admin
    .from("property_data_sources")
    .select("property_id, source, status")
    .in("source", ["google_ads", "ctm", "ga4", "keyword_com", "ghl"])
    .in("status", ["connected", "error"]);

  if (srcErr) {
    return new Response(JSON.stringify({ error: srcErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const targets = srcRows ?? [];
  let succeeded = 0;
  let failed = 0;
  let retried = 0;

  // In-attempt retry policy: try up to 3 times with 30s and 120s waits.
  // Total wall time per (property, source) capped at ~5 minutes.
  const ATTEMPT_WAITS_MS = [0, 30_000, 120_000];
  const PER_PAIR_TIMEOUT_MS = 5 * 60_000;
  // Per-invoke hard timeout so a hung child function can't blow past the
  // parent's platform wall-time limit and silently kill the outer loop.
  const PER_INVOKE_TIMEOUT_MS = 90_000;

  // ---- Connection health bookkeeping (degraded state) ----------------
  async function recordHealth(
    property_id: string,
    source: string,
    ok: boolean,
    failedPhase: string | null,
  ) {
    if (ok) {
      await admin.from("property_data_sources").update({
        last_success_at: new Date().toISOString(),
        consecutive_failures: 0,
        last_failed_phase: null,
        backoff_until: null,
      }).eq("property_id", property_id).eq("source", source);
      return;
    }
    const { data: cur } = await admin
      .from("property_data_sources")
      .select("consecutive_failures")
      .eq("property_id", property_id).eq("source", source)
      .maybeSingle();
    const next = Number(cur?.consecutive_failures ?? 0) + 1;
    await admin.from("property_data_sources").update({
      consecutive_failures: next,
      last_failure_at: new Date().toISOString(),
      last_failed_phase: failedPhase,
    }).eq("property_id", property_id).eq("source", source);
  }

  async function invokeOnce(fnName: string, property_id: string, extra: Record<string, unknown> = {}) {
    const started_at = new Date().toISOString();
    let status: "success" | "failure" = "success";
    let error_message: string | null = null;
    let rows_written: number | null = null;
    let payload: any = null;
    try {
      const invokePromise = admin.functions.invoke(fnName, {
        body: { property_id, date_from, date_to, ...extra },
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`invoke timeout after ${PER_INVOKE_TIMEOUT_MS}ms`)),
          PER_INVOKE_TIMEOUT_MS,
        );
      });
      const { data, error } = (await Promise.race([invokePromise, timeoutPromise])) as any;
      payload = data ?? null;
      if (error) {
        status = "failure";
        error_message = String(error.message ?? error);
      } else if (data && (data as any).error) {
        status = "failure";
        error_message = String((data as any).error);
      } else {
        rows_written = Number((data as any)?.written ?? 0);
      }
    } catch (e) {
      status = "failure";
      error_message = e instanceof Error ? e.message : String(e);
    }
    return { started_at, status, error_message, rows_written, payload };
  }

  // ---- GHL phase runner ----------------------------------------------
  // Each phase is idempotent and safely re-runnable; the cursor returned by
  // one invoke feeds the next, so pagination is per-invoke rather than
  // per-run and full coverage becomes achievable over successive invokes.
  // opportunities_recent runs early and is capped by its own watermark, so
  // today's deals land even when the deep backfill phases exhaust the wall
  // budget later in the list. Phase order here is the recovery priority.
  const GHL_PHASES = [
    "users", "pipelines", "opportunities_recent", "contacts",
    "conversations", "opportunities", "appointments", "finalize",
  ];
  const MAX_INVOKES_PER_PHASE = 8;
  const GHL_WALL_BUDGET_MS = 10 * 60_000;

  async function runGhlChunked(property_id: string, run_group_id: string) {
    const deadline = Date.now() + GHL_WALL_BUDGET_MS;
    let anyFailure = false;
    let failedPhase: string | null = null;
    for (const p of GHL_PHASES) {
      let cursor: unknown = null;
      for (let i = 0; i < MAX_INVOKES_PER_PHASE; i++) {
        if (Date.now() > deadline) return { ok: !anyFailure, failedPhase: failedPhase ?? p };
        const startedAt = new Date().toISOString();
        const { data: pending } = await admin.from("sync_runs").insert({
          property_id, source: "ghl", status: "running", started_at: startedAt,
          attempt: i + 1, run_group_id, trigger_source: "cron", phase: p,
        }).select("id").maybeSingle();

        const r = await invokeOnce("sync-ghl", property_id, { phase: p, cursor });
        const done = r.payload?.phase_done !== false;
        const update = {
          status: r.status,
          phase: p,
          error_message: r.error_message ? r.error_message.slice(0, 2000) : null,
          finished_at: new Date().toISOString(),
          stats: { phase: p, phase_done: done, invoke: i + 1, run_group_id } as never,
        };
        if (pending?.id) await admin.from("sync_runs").update(update).eq("id", pending.id);
        else await admin.from("sync_runs").insert({ property_id, source: "ghl", started_at: startedAt, attempt: i + 1, run_group_id, trigger_source: "cron", ...update });

        if (r.status === "failure") {
          anyFailure = true;
          failedPhase = p;
          break; // move to the next phase; a stuck phase must not block the rest
        }
        if (done) break;
        cursor = r.payload?.next_cursor ?? null;
        if (!cursor) break;
      }
    }
    return { ok: !anyFailure, failedPhase };
  }

  // Run sequentially to avoid hammering external APIs / rate limits.
  for (const row of targets) {
    const fnName = SOURCE_TO_FN[row.source as string];
    if (!fnName) continue;

    const run_group_id = crypto.randomUUID();

    if (row.source === "ghl") {
      const res = await runGhlChunked(row.property_id as string, run_group_id);
      await recordHealth(row.property_id as string, "ghl", res.ok, res.failedPhase);
      if (res.ok) succeeded++; else failed++;
      continue;
    }

    const pairDeadline = Date.now() + PER_PAIR_TIMEOUT_MS;
    let lastStatus: "success" | "failure" = "failure";
    let attemptsRun = 0;

    for (let i = 0; i < ATTEMPT_WAITS_MS.length; i++) {
      if (i > 0) {
        if (Date.now() + ATTEMPT_WAITS_MS[i] > pairDeadline) break;
        await new Promise((r) => setTimeout(r, ATTEMPT_WAITS_MS[i]));
      }
      const attempt = i + 1;
      // Insert a "running" placeholder first so a parent kill still leaves a
      // trail (health panel + resync-failed can treat stale "running" rows as
      // failures instead of the pair vanishing entirely).
      const startedAt = new Date().toISOString();
      const { data: pendingRow } = await admin
        .from("sync_runs")
        .insert({
          property_id: row.property_id,
          source: row.source,
          status: "running",
          started_at: startedAt,
          attempt,
          run_group_id,
          trigger_source: "cron",
        })
        .select("id")
        .maybeSingle();

      const r = await invokeOnce(fnName, row.property_id);
      attemptsRun++;
      lastStatus = r.status;

      const updatePayload = {
        status: r.status,
        error_message: r.error_message ? r.error_message.slice(0, 2000) : null,
        finished_at: new Date().toISOString(),
        stats: { rows_written: r.rows_written, attempt, run_group_id } as never,
      };
      if (pendingRow?.id) {
        await admin.from("sync_runs").update(updatePayload).eq("id", pendingRow.id);
      } else {
        // Fallback: placeholder insert failed for some reason — still record.
        await admin.from("sync_runs").insert({
          property_id: row.property_id,
          source: row.source,
          started_at: r.started_at,
          attempt,
          run_group_id,
          trigger_source: "cron",
          ...updatePayload,
        });
      }
      if (r.status === "success") break;
    }

    await recordHealth(row.property_id as string, row.source as string, lastStatus === "success", null);
    if (attemptsRun > 1) retried++;
    if (lastStatus === "success") succeeded++;
    else failed++;
  }

  return new Response(
    JSON.stringify({ attempted: targets.length, succeeded, failed, retried }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
