// Data source alerting — evaluator + notifier.
//
// Step 0 scaffold: email send path only. The evaluator lands after the test
// email is confirmed.
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

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  if (!cronSecret || provided !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

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
