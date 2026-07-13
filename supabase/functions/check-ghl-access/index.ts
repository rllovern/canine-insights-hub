import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

type CheckResult = {
  label: string;
  path: string;
  ok: boolean;
  status: number;
  message: string;
};

function safeMessage(text: string) {
  try {
    const json = JSON.parse(text);
    return String(json.message ?? json.error ?? text).slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function check(label: string, path: string, token: string, init?: RequestInit): Promise<CheckResult> {
  const res = await fetch(GHL_BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  return {
    label,
    path,
    ok: res.ok,
    status: res.status,
    message: res.ok ? "Authorized" : safeMessage(text),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userRes } = await userClient.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isInternal } = await admin.rpc("is_all_properties_reader", { _user_id: user.id });
  if (!isInternal) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const propertyId = body.property_id as string | undefined;
  if (!propertyId) {
    return new Response(JSON.stringify({ error: "property_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: pds, error } = await admin
    .from("property_data_sources")
    .select("config, secret_token")
    .eq("property_id", propertyId)
    .eq("source", "ghl")
    .maybeSingle();
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const locationId = (pds?.config as Record<string, unknown> | null)?.location_id as string | undefined;
  if (!locationId) {
    return new Response(JSON.stringify({ error: "GHL location not configured for property" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const TOKEN = (pds?.secret_token as string | undefined) ?? "";
  if (!TOKEN) {
    return new Response(JSON.stringify({ error: "No Private Integration token saved for this property." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = await Promise.all([
    check("Location read", `/locations/${encodeURIComponent(locationId)}`, TOKEN),
    check("Contacts read", "/contacts/search", TOKEN, {
      method: "POST",
      body: JSON.stringify({ locationId, pageLimit: 1 }),
    }),
    check("Conversations read", `/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=1`, TOKEN),
    check("Opportunities read", `/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=1`, TOKEN),
  ]);

  return new Response(JSON.stringify({ locationId, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});