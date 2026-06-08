// Lists all labels and their attached campaigns for a property's Google Ads
// connection. Internal users only. Used to discover the correct campaign
// label name to put in property_data_sources.campaign_label_filter.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_ADS_API_VERSION = "v23";

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(`refresh failed: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authorized = false;
  if (token && token === SERVICE_KEY) {
    authorized = true;
  } else if (token) {
    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData } = await anon.auth.getUser(token);
    const uid = userData?.user?.id as string | undefined;
    if (uid) {
      const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", uid).eq("role", "internal").maybeSingle();
      if (roleRow) authorized = true;
    }
  }
  if (!authorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const propertyId: string | undefined = body?.property_id;
    if (!propertyId) return new Response(JSON.stringify({ error: "property_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: conn } = await admin.from("property_data_sources").select("*").eq("property_id", propertyId).eq("source", "google_ads").maybeSingle();
    if (!conn || !conn.external_account_id) return new Response(JSON.stringify({ error: "no google_ads connection" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const refreshToken = conn.refresh_token ?? Deno.env.get("GOOGLE_ADS_MCC_REFRESH_TOKEN");
    if (!refreshToken) return new Response(JSON.stringify({ error: "no refresh token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const accessToken = await getAccessToken(refreshToken);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!,
      "Content-Type": "application/json",
    };
    if (conn.login_customer_id) headers["login-customer-id"] = conn.login_customer_id;

    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${conn.external_account_id}/googleAds:searchStream`;

    async function runQuery(query: string) {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
      const json = await res.json();
      if (!res.ok) throw new Error(`google ads api: ${JSON.stringify(json).slice(0, 500)}`);
      const chunks = Array.isArray(json) ? json : [json];
      const rows: any[] = [];
      for (const c of chunks) for (const r of (c.results ?? [])) rows.push(r);
      return rows;
    }

    const labelRows = await runQuery(`SELECT label.id, label.name, label.resource_name FROM label`);
    const campaignLabelRows = await runQuery(`SELECT label.name, label.resource_name, campaign.id, campaign.name FROM campaign_label`);

    const labels = labelRows.map((r) => ({ id: r.label?.id, name: r.label?.name, resource_name: r.label?.resourceName }));
    const byLabel: Record<string, Array<{ id: string; name: string }>> = {};
    for (const r of campaignLabelRows) {
      const lname = r.label?.name ?? "(unknown)";
      (byLabel[lname] ??= []).push({ id: String(r.campaign?.id), name: r.campaign?.name });
    }

    return new Response(JSON.stringify({ ok: true, customer_id: conn.external_account_id, labels, campaigns_by_label: byLabel }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});