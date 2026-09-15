// Ads Agent — read-only health check. Phase 0.
//
// ============================ STANDING RULES ============================
// 1. NO MUTATIONS, EVER, IN ANY PHASE OF THIS TOOL.
//    No `:mutate` endpoint, no mutateOperations, not commented out, not
//    behind a flag. This function reads Google Ads and nothing else.
//
// 2. CAMPAIGN IDENTITY IS `campaign.id`, resolved from a live Google Ads API
//    call and scoped to a customer_id. Campaign NAMES are not unique across
//    this portfolio (e.g. "Haydn Conversions" legitimately exists in both the
//    Colorado Springs and Ohio accounts — same former agency, same naming
//    convention). Never resolve a campaign by name, and never join warehouse
//    tables on campaign name across properties. daily_metrics,
//    campaign_budgets and campaign_labels are all keyed on
//    (property_id, campaign name): safe WITHIN a property, wrong ACROSS them.
//
// 3. SERVICE-KEY RULE. Once this function holds the service role key, row
//    level security protects nothing past that point. It must never accept a
//    property_id, customer_id or campaign_id from the request body without
//    re-validating it against agent_account_policies for the authenticated
//    caller. This function takes no such input at all — keep it that way.
// ========================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_ADS_API_VERSION = "v23";
const LOGIN_CUSTOMER_ID = "2189989288";
const FRESHNESS_SOURCES = ["google_ads", "ctm", "ghl"] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ageHours(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round(((Date.now() - new Date(iso).getTime()) / 3_600_000) * 10) / 10;
}

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
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`token exchange failed: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ---- Caller must be a super admin. Server side. Route guards do not count.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const token = authHeader.replace("Bearer ", "").trim();

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  let callerId: string | undefined;
  try {
    const { data: claimsRes, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr) return json({ error: "Session expired — sign in again" }, 401);
    callerId = claimsRes?.claims?.sub;
  } catch (_e) {
    return json({ error: "Session expired — sign in again" }, 401);
  }
  if (!callerId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: callerId });
  // An admin-role user is NOT sufficient. Super admin only.
  if (!isSuper) return json({ error: "Forbidden" }, 403);

  try {
    const refreshToken = Deno.env.get("ADS_AGENT_REFRESH_TOKEN");
    if (!refreshToken) return json({ error: "ADS_AGENT_REFRESH_TOKEN is not configured" }, 500);
    const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
    if (!developerToken) return json({ error: "GOOGLE_ADS_DEVELOPER_TOKEN is not configured" }, 500);

    const { data: policies, error: polErr } = await admin
      .from("agent_account_policies")
      .select("property_id, customer_id, campaign_allowlist, agent_enabled")
      .eq("agent_enabled", true);
    if (polErr) return json({ error: polErr.message }, 500);

    if (!policies || policies.length === 0) {
      await admin.from("agent_audit_log").insert({
        actor: `user:${callerId}`,
        event: "health_check",
        detail: { enabled_policies: 0 },
      });
      return json({ checked_at: new Date().toISOString(), properties: [], note: "No agent-enabled accounts." });
    }

    const propertyIds = [...new Set(policies.map((p) => p.property_id))];

    const { data: props } = await admin
      .from("properties")
      .select("id, name")
      .in("id", propertyIds);
    const nameById = new Map((props ?? []).map((p) => [p.id, p.name as string]));

    const { data: sources } = await admin
      .from("property_data_sources")
      .select("property_id, source, last_success_at")
      .in("property_id", propertyIds)
      .in("source", FRESHNESS_SOURCES as unknown as string[]);
    // last_success_at ONLY. status and is_connected are known unreliable.
    const freshnessKey = (pid: string, src: string) => `${pid}:${src}`;
    const freshness = new Map(
      (sources ?? []).map((s) => [freshnessKey(s.property_id, s.source), s.last_success_at as string | null]),
    );

    const accessToken = await getAccessToken(refreshToken);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": LOGIN_CUSTOMER_ID,
      "Content-Type": "application/json",
    };
    const gaql = "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'";

    const results = [];
    for (const policy of policies) {
      const customerId = String(policy.customer_id).replace(/-/g, "");
      // READ ONLY: searchStream. Never any other path on this host.
      const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;

      let campaigns: { id: string; name: string; status: string }[] = [];
      let error: string | null = null;
      try {
        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: gaql }) });
        const payload = await res.json();
        if (!res.ok) {
          error = JSON.stringify(payload).slice(0, 600);
        } else {
          const chunks = Array.isArray(payload) ? payload : [payload];
          for (const chunk of chunks) {
            for (const row of chunk.results ?? []) {
              if (!row.campaign?.id) continue;
              campaigns.push({
                id: String(row.campaign.id),
                name: row.campaign.name ?? "",
                status: row.campaign.status ?? "",
              });
            }
          }
        }
      } catch (e) {
        error = String(e);
      }

      const allowlist: string[] | null = policy.campaign_allowlist ?? null;
      // Allowlist entries are campaign IDs. Comparison is by id, never by name.
      const outsideAllowlist = allowlist
        ? campaigns.filter((c) => !allowlist.includes(c.id)).map((c) => ({ id: c.id, name: c.name }))
        : [];

      const sourceFreshness: Record<string, { last_success_at: string | null; age_hours: number | null; state: string }> = {};
      for (const src of FRESHNESS_SOURCES) {
        const key = freshnessKey(policy.property_id, src);
        const has = freshness.has(key);
        const ts = has ? freshness.get(key)! : null;
        sourceFreshness[src] = {
          last_success_at: ts,
          age_hours: ageHours(ts),
          // "no data" (never succeeded, or no connection row) is distinct from
          // a successful sync that returned zero results.
          state: ts ? "ok" : has ? "no data" : "no connection row",
        };
      }

      results.push({
        property_id: policy.property_id,
        property_name: nameById.get(policy.property_id) ?? "(unknown)",
        customer_id: customerId,
        error,
        campaign_count: error ? null : campaigns.length,
        campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
        allowlist,
        allowlist_configured: !!allowlist && allowlist.length > 0,
        campaigns_outside_allowlist: outsideAllowlist,
        source_freshness: sourceFreshness,
      });
    }

    await admin.from("agent_audit_log").insert({
      actor: `user:${callerId}`,
      event: "health_check",
      detail: {
        enabled_policies: policies.length,
        properties: results.map((r) => ({
          property_id: r.property_id,
          customer_id: r.customer_id,
          campaign_count: r.campaign_count,
          error: r.error,
        })),
      },
    });

    return json({ checked_at: new Date().toISOString(), properties: results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
