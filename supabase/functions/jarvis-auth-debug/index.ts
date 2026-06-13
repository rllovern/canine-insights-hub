import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)) as { exp?: number; sub?: string };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const apikeyHeader = req.headers.get("apikey") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  console.log("[Jarvis Auth Debug Endpoint]", {
    hasAuthHeader: !!authHeader,
    authHeaderStartsBearer: authHeader.startsWith("Bearer "),
    tokenPrefix: token.slice(0, 12),
    hasApikeyHeader: !!apikeyHeader,
    supabaseHost: supabaseUrl ? new URL(supabaseUrl).host : null,
    hasAnonKey: !!supabaseAnonKey,
    hasServiceRoleKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });

  if (!token || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser();
  const jwt = decodeJwtPayload(token);
  const expiresInSeconds = jwt?.exp ? jwt.exp - Math.floor(Date.now() / 1000) : null;

  console.log("[Jarvis Auth Debug Endpoint User]", {
    hasUser: !!user,
    userId: user?.id,
    userErrorMessage: userError?.message,
    expiresInSeconds,
  });

  if (userError || !user) {
    return new Response(JSON.stringify({
      hasAuthHeader: true,
      hasUser: false,
      userId: null,
      expiresInSeconds,
      error: "Invalid user session",
      detail: userError?.message ?? null,
    }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    hasAuthHeader: true,
    hasUser: true,
    userId: user.id,
    expiresInSeconds,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});