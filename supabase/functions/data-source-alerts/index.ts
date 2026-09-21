// Data source alerting — evaluator + notifier.
//
// Step 0 scaffold: email send path only. The evaluator lands after the test
// email is confirmed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendPlainEmail } from "../_shared/send-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Same cron authentication as the other scheduled jobs.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  let vaultCronSecret = "";
  try {
    const { data: v } = await admin.rpc("get_cron_secret_v2");
    vaultCronSecret = typeof v === "string" ? v : "";
  } catch (_e) { /* optional */ }
  let ok = !!token && (token === SERVICE_KEY || token === CRON_SECRET || (!!vaultCronSecret && token === vaultCronSecret));
  // A signed-in super admin may also run it on demand (admin page, manual test).
  if (!ok && token) {
    const { data: userRes } = await admin.auth.getUser(token);
    const uid = userRes?.user?.id;
    if (uid) {
      const { data: isSa } = await admin.rpc("is_super_admin", { _user_id: uid });
      ok = isSa === true;
    }
  }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }


  if (body.action === "test_email") {
    const to = String(body.to ?? "");
    if (!to) return json({ error: "Missing to" }, 400);
    const result = await sendPlainEmail(
      to,
      "RSK9 alert test",
      [
        "This is a test from the Ridgeside Insights data source alerting system.",
        "",
        "If you are reading this, alert emails can reach you and the alerter can be built on this path.",
        "",
        `Sent at ${new Date().toISOString()} (UTC).`,
      ].join("\n"),
    );
    return json(result, result.sent ? 200 : 502);
  }

  return json({ error: "Unknown action" }, 400);
});
