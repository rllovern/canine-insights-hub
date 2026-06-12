// Saves a per-property GHL sub-account Private Integration token after
// validating it against the Location and Contacts endpoints.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

function safeMessage(text: string) {
  try {
    const j = JSON.parse(text);
    return String(j.message ?? j.error ?? text).slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function ghlGet(path: string, token: string) {
  const res = await fetch(GHL_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function ghlPost(path: string, token: string, body: unknown) {
  const res = await fetch(GHL_BASE + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
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

  const body = await req.json().catch(() => ({}));
  const property_id = body.property_id as string | undefined;
  const location_id = (body.location_id as string | undefined)?.trim();
  const token = (body.token as string | undefined)?.trim();
  if (!property_id || !location_id || !token) {
    return new Response(JSON.stringify({ error: "property_id, location_id, and token are required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate token: must be able to read this location AND contacts (the most
  // commonly missing scope).
  const locRes = await ghlGet(`/locations/${encodeURIComponent(location_id)}`, token);
  if (!locRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: `Go High Level rejected reading this location (HTTP ${locRes.status}): ${safeMessage(locRes.text)}. Check that the Location ID is correct and the Private Integration was created inside this sub-account with "View Locations" enabled.`,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const contactsRes = await ghlPost("/contacts/search", token, { locationId: location_id, pageLimit: 1 });
  if (!contactsRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: `Go High Level rejected reading contacts (HTTP ${contactsRes.status}): ${safeMessage(contactsRes.text)}. Edit this sub-account's Private Integration and enable: View Contacts, View Conversations, View Conversation Messages, View Opportunities.`,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { error: upErr } = await admin
    .from("property_data_sources")
    .upsert({
      property_id,
      source: "ghl",
      is_connected: true,
      status: "connected",
      config: { location_id },
      secret_token: token,
      last_error: null,
    }, { onConflict: "property_id,source" });
  if (upErr) {
    return new Response(JSON.stringify({ error: upErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});