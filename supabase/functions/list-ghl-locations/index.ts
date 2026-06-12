// Lists every GHL location accessible to the agency Private Integration token.
// Internal-only callers use this to map a Lovable property to a GHL location.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TOKEN = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN") ?? "";
  if (!TOKEN) {
    return new Response(JSON.stringify({ error: "GHL_PRIVATE_INTEGRATION_TOKEN missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth: must be signed-in internal user
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userRes } = await userClient.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isInternal } = await admin.rpc("has_role", { _user_id: user.id, _role: "internal" });
  if (!isInternal) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // GHL: /locations/search lists sub-accounts for an agency token
  const res = await fetch("https://services.leadconnectorhq.com/locations/search?limit=200", {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `GHL ${res.status}: ${text.slice(0, 500)}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* */ }
  const locations = (json.locations ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    address: l.address ?? null,
  }));

  return new Response(JSON.stringify({ locations }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});