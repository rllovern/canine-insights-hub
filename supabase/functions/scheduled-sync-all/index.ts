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
    .eq("status", "connected");

  if (srcErr) {
    return new Response(JSON.stringify({ error: srcErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const targets = srcRows ?? [];
  let succeeded = 0;
  let failed = 0;

  // Run sequentially to avoid hammering external APIs / rate limits.
  for (const row of targets) {
    const fnName = SOURCE_TO_FN[row.source as string];
    if (!fnName) continue;

    const started_at = new Date().toISOString();
    let status: "success" | "failure" = "success";
    let error_message: string | null = null;
    let rows_written: number | null = null;

    try {
      const { data, error } = await admin.functions.invoke(fnName, {
        body: { property_id: row.property_id, date_from, date_to },
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

    if (status === "success") succeeded++;
    else failed++;

    await admin.from("sync_runs").insert({
      property_id: row.property_id,
      source: row.source,
      status,
      error_message: error_message ? error_message.slice(0, 2000) : null,
      started_at,
      finished_at: new Date().toISOString(),
      stats: { rows_written } as never,
    });
  }

  return new Response(
    JSON.stringify({ attempted: targets.length, succeeded, failed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
