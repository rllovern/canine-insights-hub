// Between-cron auto-recovery pass. Runs every 2 minutes via pg_cron.
// Any (property, source) pair whose most recent sync_runs row is a failure
// (or a stuck "running" older than 5 minutes), or whose last success is older
// than 5 hours, is re-invoked with the standard 3-attempt policy. Retries
// continue every 2 minutes until a success is recorded, at which point the
// pair falls back to the normal 4-hour scheduled cadence.
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

const ATTEMPT_WAITS_MS = [0, 30_000, 120_000];
const PER_PAIR_TIMEOUT_MS = 5 * 60_000;
// Per-tick candidate cap so a single 2-minute run can't blow past platform
// wall-time when many pairs fail at once. Remaining pairs are picked up on
// the next tick 2 minutes later.
const MAX_CANDIDATES_PER_TICK = 10;

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
    .select("property_id, source, status")
    .in("source", ["google_ads", "ctm", "ga4", "keyword_com", "ghl"])
    .in("status", ["connected", "error"]);
  if (srcErr) {
    return new Response(JSON.stringify({ error: srcErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Full sync runs every 4h; if the latest success is older than 5h,
  // the pair missed a cycle and needs immediate recovery.
  const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000).toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

  const candidates: { property_id: string; source: string }[] = [];
  for (const row of srcRows ?? []) {
    const property_id = row.property_id as string;
    const source = row.source as string;

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

  const date_from = isoDaysAgo(30);
  const date_to = isoToday();
  let recovered = 0;
  let stillFailing = 0;

  async function invokeOnce(fnName: string, property_id: string) {
    const started_at = new Date().toISOString();
    let status: "success" | "failure" = "success";
    let error_message: string | null = null;
    let rows_written: number | null = null;
    try {
      const { data, error } = await admin.functions.invoke(fnName, {
        body: { property_id, date_from, date_to },
      });
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

  for (const c of candidates) {
    const fnName = SOURCE_TO_FN[c.source];
    if (!fnName) continue;
    const run_group_id = crypto.randomUUID();
    const pairDeadline = Date.now() + PER_PAIR_TIMEOUT_MS;
    let lastStatus: "success" | "failure" = "failure";

    for (let i = 0; i < ATTEMPT_WAITS_MS.length; i++) {
      if (i > 0) {
        if (Date.now() + ATTEMPT_WAITS_MS[i] > pairDeadline) break;
        await new Promise((r) => setTimeout(r, ATTEMPT_WAITS_MS[i]));
      }
      const attempt = i + 1;
      const r = await invokeOnce(fnName, c.property_id);
      lastStatus = r.status;
      await admin.from("sync_runs").insert({
        property_id: c.property_id,
        source: c.source,
        status: r.status,
        error_message: r.error_message ? r.error_message.slice(0, 2000) : null,
        started_at: r.started_at,
        finished_at: new Date().toISOString(),
        attempt,
        run_group_id,
        trigger_source: "resync_failed",
        stats: { rows_written: r.rows_written, attempt, run_group_id } as never,
      });
      if (r.status === "success") break;
    }
    if (lastStatus === "success") recovered++;
    else stillFailing++;
  }

  return new Response(
    JSON.stringify({
      candidates: candidates.length,
      recovered,
      still_failing: stillFailing,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});