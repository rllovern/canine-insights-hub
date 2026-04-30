import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await supabase.auth.getClaims(token);
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const { data: isInternal } = await supabase.rpc("has_role", { _user_id: userId, _role: "internal" });
    if (!isInternal) return json({ error: "Forbidden" }, 403);

    const { account_id, api_token, api_secret } = await req.json();
    if (!account_id || !api_token || !api_secret) return json({ error: "Missing credentials" }, 400);

    const basic = btoa(`${api_token}:${api_secret}`);
    const r = await fetch(`https://api.calltrackingmetrics.com/api/v1/accounts/${account_id}`, {
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
    const text = await r.text();
    if (!r.ok) return json({ ok: false, status: r.status, error: text.slice(0, 400) });
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const account = (parsed.account ?? parsed) as Record<string, unknown>;
    return json({ ok: true, account_name: account?.name ?? account?.account_name ?? "Connected" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
