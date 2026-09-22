// Fetches recent change history (change_event) for a property's Google Ads
// account. Google Ads API only retains change events for the last 30 days.
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

function toGoogleDateTime(d: Date): string {
  // Format: 'YYYY-MM-DD HH:MM:SS'
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authorized = false;
  let userId: string | undefined;
  if (token && token === SERVICE_KEY) {
    authorized = true;
  } else if (token) {
    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData } = await anon.auth.getUser(token);
    userId = userData?.user?.id as string | undefined;
    if (userId) authorized = true;
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const propertyId: string | undefined = body?.property_id;
    const days: number = Math.min(Math.max(Number(body?.days ?? 30), 1), 30);
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 200), 1), 1000);
    if (!propertyId) {
      return new Response(JSON.stringify({ error: "property_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: conn } = await admin
      .from("property_data_sources")
      .select("*")
      .eq("property_id", propertyId)
      .eq("source", "google_ads")
      .maybeSingle();
    if (!conn || !conn.external_account_id) {
      return new Response(JSON.stringify({ error: "no google_ads connection" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const refreshToken = conn.refresh_token ?? Deno.env.get("GOOGLE_ADS_MCC_REFRESH_TOKEN");
    if (!refreshToken) {
      return new Response(JSON.stringify({ error: "no refresh token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getAccessToken(refreshToken);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!,
      "Content-Type": "application/json",
    };
    if (conn.login_customer_id) headers["login-customer-id"] = conn.login_customer_id;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = toGoogleDateTime(since);
    const nowStr = toGoogleDateTime(new Date());

    const query = `
      SELECT
        change_event.change_date_time,
        change_event.user_email,
        change_event.client_type,
        change_event.change_resource_type,
        change_event.change_resource_name,
        change_event.resource_change_operation,
        change_event.changed_fields,
        change_event.campaign,
        change_event.ad_group
      FROM change_event
      WHERE change_event.change_date_time BETWEEN '${sinceStr}' AND '${nowStr}'
      ORDER BY change_event.change_date_time DESC
      LIMIT ${limit}
    `;

    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${conn.external_account_id}/googleAds:searchStream`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
    const json = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "google ads api", detail: json }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Need campaign/ad_group names too — best-effort second query for referenced ids.
    const chunks = Array.isArray(json) ? json : [json];
    const rawRows: any[] = [];
    for (const c of chunks) for (const r of (c.results ?? [])) rawRows.push(r);

    const campaignIds = new Set<string>();
    const adGroupIds = new Set<string>();
    for (const r of rawRows) {
      const camp = r.changeEvent?.campaign as string | undefined;
      const ag = r.changeEvent?.adGroup as string | undefined;
      if (camp) {
        const m = camp.match(/campaigns\/(\d+)/);
        if (m) campaignIds.add(m[1]);
      }
      if (ag) {
        const m = ag.match(/adGroups\/(\d+)/);
        if (m) adGroupIds.add(m[1]);
      }
    }

    const campaignNames = new Map<string, string>();
    const adGroupNames = new Map<string, string>();
    async function lookup(q: string, dest: Map<string, string>, idKey: string, nameKey: string) {
      try {
        const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: q }) });
        const j = await r.json();
        if (!r.ok) return;
        const cs = Array.isArray(j) ? j : [j];
        for (const c of cs) for (const row of (c.results ?? [])) {
          const obj = idKey === "campaign" ? row.campaign : row.adGroup;
          if (obj?.id != null && obj?.name) dest.set(String(obj.id), String(obj.name));
        }
      } catch { /* ignore */ }
    }
    if (campaignIds.size) {
      await lookup(`SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id IN (${[...campaignIds].join(",")})`, campaignNames, "campaign", "name");
    }
    if (adGroupIds.size) {
      await lookup(`SELECT ad_group.id, ad_group.name FROM ad_group WHERE ad_group.id IN (${[...adGroupIds].join(",")})`, adGroupNames, "adGroup", "name");
    }

    const events = rawRows.map((r) => {
      const e = r.changeEvent ?? {};
      const campMatch = (e.campaign ?? "").match(/campaigns\/(\d+)/);
      const agMatch = (e.adGroup ?? "").match(/adGroups\/(\d+)/);
      const campaignId = campMatch?.[1];
      const adGroupId = agMatch?.[1];
      return {
        change_date_time: e.changeDateTime,
        user_email: e.userEmail,
        client_type: e.clientType,
        resource_type: e.changeResourceType,
        resource_name: e.changeResourceName,
        operation: e.resourceChangeOperation,
        changed_fields: e.changedFields,
        campaign_id: campaignId,
        campaign_name: campaignId ? campaignNames.get(campaignId) : undefined,
        ad_group_id: adGroupId,
        ad_group_name: adGroupId ? adGroupNames.get(adGroupId) : undefined,
      };
    });

    return new Response(JSON.stringify({ ok: true, customer_id: conn.external_account_id, since: since.toISOString(), count: events.length, events }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});