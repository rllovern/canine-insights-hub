// Between-cron auto-recovery pass.
//
// Bounded by design: ONE pair per tick, ONE invocation per tick, a hard
// wall-clock ceiling, and no in-function sleeping. Earlier versions took up
// to 10 pairs per tick, retried each 3 times with 30s/120s sleeps inside the
// function, and allowed 5 minutes per pair. At a 2-minute cadence that let
// ticks overlap and pile database work on top of already-slow syncs, which
// saturated the database and took auth down with it.
//
// Retry spacing is now owned by the cron cadence plus `backoff_until` on
// property_data_sources, not by sleeping inside the request.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOURCE_TO_FN: Record<string, string> = {
  google_ads: "sync-google-ads",
  ctm: "sync-ctm",
  ga4: "sync-ga4",
  keyword_com: "sync-keyword-com",
  ghl: "sync-ghl",
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Recovery re-pulls a short window only. A 30-day window turns every
// recovery attempt into a heavy backfill, which is what we are trying not to
// do while a source is already struggling. Scheduled full syncs still cover
// the wider window.
const RECOVERY_WINDOW_DAYS = 7;

// ----- Failure classification --------------------------------------
// Auth / scope / config failures never recover on their own. Retrying them
// every 2 minutes burns quota and buries real transient failures, so a hard
// failure pauses the pair until a human re-connects it.
const HARD_FAILURE_PATTERNS: RegExp[] = [
  /\b401\b/,
  /\b403\b/,
  /unauthoriz/i,
  /not authorized/i,
  /invalid[_ ]?(token|grant|client|credential)/i,
  /token (is )?(expired|revoked|invalid)/i,
  /permission denied/i,
  /insufficient (scope|permission)/i,
  /missing (refresh_token|credential|secret)/i,
  /developer token|customer not found|CUSTOMER_NOT_FOUND/i,
  /not configured|no connection|missing config/i,
];
function isHardFailure(msg: string | null): boolean {
  if (!msg) return false;
  return HARD_FAILURE_PATTERNS.some((re) => re.test(msg));
}

// Hard ceiling on a single child sync invocation. If it has not answered by
// then we give up on this tick rather than holding the slot open.
const INVOKE_TIMEOUT_MS = 60_000;
// Exactly one pair per tick. Remaining pairs are picked up on later ticks.
const MAX_CANDIDATES_PER_TICK = 1;

// ----- Data-freshness thresholds -------------------------------------
// A run that reports "success" is not proof the data moved: a phase can be
// starved of budget and write nothing while the run still exits cleanly.
// These ceilings are judged on sync_watermarks.last_fresh_at, so a source
// that stops producing data is recovered even when every run looks green.
const FRESHNESS_MAX_AGE_MS: Record<string, number> = {
  // Must stay comfortably ABOVE the 4h scheduled cadence. A 3h ceiling meant
  // every GHL pair looked stale for an hour of every cycle, so the recovery
  // job re-ran heavy GHL syncs continuously even when nothing was broken.
  ghl: 6 * 3_600_000,
  ctm: 6 * 3_600_000,
  google_ads: 10 * 3_600_000,
  ga4: 10 * 3_600_000,
  keyword_com: 26 * 3_600_000,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  let vaultCronSecret = "";
  try {
    const { data: vaultVal } = await admin.rpc("get_cron_secret_v2");
    vaultCronSecret = typeof vaultVal === "string" ? vaultVal : "";
  } catch (_e) { /* optional */ }
  const matchesEnvSecret = !!CRON_SECRET && token === CRON_SECRET;
  const matchesVaultSecret = !!vaultCronSecret && token === vaultCronSecret;
  if (!token || (token !== SERVICE_KEY && !matchesEnvSecret && !matchesVaultSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: srcRows, error: srcErr } = await admin
    .from("property_data_sources")
    .select("property_id, source, status, consecutive_failures, backoff_until")
    .in("source", ["google_ads", "ctm", "ga4", "keyword_com", "ghl"])
    // "paused" pairs are deliberately excluded: a hard auth/config failure
    // stops retries until someone re-connects the source.
    .in("status", ["connected", "error"]);
  if (srcErr) {
    return new Response(JSON.stringify({ error: srcErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ----- Stuck-run reaper --------------------------------------------
  // Any run still marked "running" 15 minutes after it started can never
  // finish: the parent invocation is long gone. Close it out as a failure so
  // the health panel stops showing a phantom in-flight sync and the pair
  // becomes eligible for recovery below.
  const reapCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: reaped } = await admin
    .from("sync_runs")
    .update({
      status: "failure",
      finished_at: new Date().toISOString(),
      error_message: "stuck run reaped: no completion recorded within 15 minutes",
    })
    .eq("status", "running")
    .lt("started_at", reapCutoff)
    .select("id");
  const reapedCount = reaped?.length ?? 0;

  // Full sync runs every 4h; if the latest success is older than 5h,
  // the pair missed a cycle and needs immediate recovery.
  const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000).toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

  const candidates: { property_id: string; source: string }[] = [];
  // Freshness map, keyed property|source, from the phase-level watermarks.
  // The oldest phase for a pair drives the decision — one frozen phase is
  // enough to make the pair stale.
  const freshness = new Map<string, number>();
  {
    const { data: wmRows } = await admin
      .from("sync_watermarks")
      .select("property_id, source, last_fresh_at");
    for (const w of wmRows ?? []) {
      const key = `${w.property_id}|${w.source}`;
      const t = w.last_fresh_at ? new Date(w.last_fresh_at as string).getTime() : 0;
      const prev = freshness.get(key);
      if (prev == null || t < prev) freshness.set(key, t);
    }
  }
  const staleFreshness: string[] = [];
  for (const row of srcRows ?? []) {
    const property_id = row.property_id as string;
    const source = row.source as string;

    // ----- Circuit breaker ------------------------------------------
    // A pair that keeps failing must not be retried every 2 minutes for days.
    // After 5 consecutive failures we back off geometrically (10m, 20m, 40m…)
    // up to a 4h ceiling, matching the normal scheduled cadence.
    const backoffUntil = row.backoff_until as string | null;
    if (backoffUntil && new Date(backoffUntil).getTime() > Date.now()) continue;

    const { data: last } = await admin
      .from("sync_runs")
      .select("status, started_at")
      .eq("property_id", property_id)
      .eq("source", source)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Eligibility rules — a pair is a candidate if ANY match:
    //  a) last row is a "failure" with no success since (retry every 2m).
    //  b) last row is "running" older than 5m — parent cron was killed
    //     mid-flight or a previous resync tick is stuck.
    //  c) last successful run is older than 5h — the pair was silently
    //     skipped by the 4h scheduled loop and would otherwise never self-heal.
    let eligible = false;
    if (last && last.status === "failure") {
      eligible = true;
    } else if (last && last.status === "running" && last.started_at < fiveMinAgo) {
      eligible = true;
    } else {
      const { data: lastSuccess } = await admin
        .from("sync_runs")
        .select("started_at")
        .eq("property_id", property_id)
        .eq("source", source)
        .eq("status", "success")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastSuccess || lastSuccess.started_at < fiveHoursAgo) {
        // Don't race an in-flight run started within the last 5 minutes.
        if (!last || last.status !== "running" || last.started_at < fiveMinAgo) {
          eligible = true;
        }
      }
    }
    if (!eligible) continue;

    candidates.push({ property_id, source });
    if (candidates.length >= MAX_CANDIDATES_PER_TICK) break;
  }

  // Second pass: pairs whose runs look healthy but whose data has stopped
  // moving. Only added if there is room left in this tick.
  for (const row of srcRows ?? []) {
    if (candidates.length >= MAX_CANDIDATES_PER_TICK) break;
    const property_id = row.property_id as string;
    const source = row.source as string;
    if (candidates.some((c) => c.property_id === property_id && c.source === source)) continue;
    const backoffUntil = row.backoff_until as string | null;
    if (backoffUntil && new Date(backoffUntil).getTime() > Date.now()) continue;
    const maxAge = FRESHNESS_MAX_AGE_MS[source];
    if (!maxAge) continue;
    const key = `${property_id}|${source}`;
    if (!freshness.has(key)) continue; // no watermark yet — run-status rules cover it
    const age = Date.now() - (freshness.get(key) ?? 0);
    if (age <= maxAge) continue;
    staleFreshness.push(key);
    candidates.push({ property_id, source });
  }

  const date_from = isoDaysAgo(RECOVERY_WINDOW_DAYS);
  const date_to = isoToday();
  let recovered = 0;
  let stillFailing = 0;
  let paused = 0;

  async function invokeOnce(fnName: string, property_id: string) {
    const started_at = new Date().toISOString();
    let status: "success" | "failure" = "success";
    let error_message: string | null = null;
    let rows_written: number | null = null;
    try {
      const timeout = new Promise<never>((_res, rej) =>
        setTimeout(
          () => rej(new Error(`child sync timed out after ${INVOKE_TIMEOUT_MS / 1000}s`)),
          INVOKE_TIMEOUT_MS,
        )
      );
      const { data, error } = await Promise.race([
        admin.functions.invoke(fnName, { body: { property_id, date_from, date_to } }),
        timeout,
      ]);
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
    return { started_at, status, error_message, rows_written };
  }

  // Free retries before the breaker engages. Kept low so a genuinely broken
  // pair moves onto exponential backoff within minutes instead of hammering.
  const FAILURE_GRACE = 2;
  async function recordHealth(
    property_id: string,
    source: string,
    ok: boolean,
    lastError?: string | null,
  ) {
    if (ok) {
      await admin.from("property_data_sources").update({
        last_success_at: new Date().toISOString(),
        consecutive_failures: 0,
        last_failed_phase: null,
        backoff_until: null,
        status: "connected",
        last_error: null,
      }).eq("property_id", property_id).eq("source", source);
      return;
    }
    // Hard failure: pause the pair outright. It stays out of every retry loop
    // until an admin re-connects it, and Admin → Data Sources shows the reason.
    if (isHardFailure(lastError ?? null)) {
      await admin.from("property_data_sources").update({
        status: "paused",
        last_error: (lastError ?? "authorization or configuration error").slice(0, 2000),
        last_failure_at: new Date().toISOString(),
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
    let backoff_until: string | null = null;
    if (next > FAILURE_GRACE) {
      const steps = next - FAILURE_GRACE;              // 1, 2, 3, …
      const minutes = Math.min(240, 10 * Math.pow(2, steps - 1)); // 10m → 4h cap
      backoff_until = new Date(Date.now() + minutes * 60_000).toISOString();
    }
    await admin.from("property_data_sources").update({
      consecutive_failures: next,
      last_failure_at: new Date().toISOString(),
      last_error: lastError ? lastError.slice(0, 2000) : null,
      backoff_until,
    }).eq("property_id", property_id).eq("source", source);
  }

  for (const c of candidates) {
    const fnName = SOURCE_TO_FN[c.source];
    if (!fnName) continue;
    const run_group_id = crypto.randomUUID();

    // Exactly one attempt. The next attempt, if needed, is a later cron tick.
    const r = await invokeOnce(fnName, c.property_id);
    await admin.from("sync_runs").insert({
      property_id: c.property_id,
      source: c.source,
      status: r.status,
      error_message: r.error_message ? r.error_message.slice(0, 2000) : null,
      started_at: r.started_at,
      finished_at: new Date().toISOString(),
      attempt: 1,
      run_group_id,
      trigger_source: "resync_failed",
      stats: { rows_written: r.rows_written, attempt: 1, run_group_id } as never,
    });

    const hardFailed = r.status === "failure" && isHardFailure(r.error_message);
    await recordHealth(c.property_id, c.source, r.status === "success", r.error_message);
    if (r.status === "success") recovered++;
    else if (hardFailed) paused++;
    else stillFailing++;
  }

  return new Response(
    JSON.stringify({
      candidates: candidates.length,
      stale_by_freshness: staleFreshness.length,
      recovered,
      still_failing: stillFailing,
      paused,
      reaped: reapedCount,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});