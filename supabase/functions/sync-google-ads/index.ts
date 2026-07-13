// Pulls campaign-level metrics from Google Ads API for one client and
// upserts into daily_metrics. Called on-demand from Settings or by nightly cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_ADS_API_VERSION = "v23";

function isoYesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
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
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`refresh failed: ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth guard: allow service role / CRON_SECRET / internal user JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  let authorized = false;
  const isPrivilegedInvocation = !!token && (token === SERVICE_KEY || (CRON_SECRET && token === CRON_SECRET));
  if (isPrivilegedInvocation) {
    authorized = true;
  } else if (token) {
    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData } = await anon.auth.getUser(token);
    const uid = userData?.user?.id as string | undefined;
    if (uid) {
      const { data: roleRows } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .in("role", ["super_admin", "admin", "owner", "internal"]);
      if (roleRows && roleRows.length > 0) authorized = true;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const startedAt = new Date().toISOString();
  let propertyId: string | undefined;
  const shouldSelfLog = !isPrivilegedInvocation;

  const finish = async (status: "success" | "failure", body: Record<string, unknown>, httpStatus = 200, errMsg?: string) => {
    if (shouldSelfLog) {
      try {
        await admin.from("sync_runs").insert({
          property_id: propertyId ?? null,
          source: "google_ads",
          status,
          error_message: errMsg ? errMsg.slice(0, 2000) : null,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          trigger_source: "manual",
          stats: body as never,
        });
      } catch { /* health logging must never block the sync response */ }
    }
    return new Response(JSON.stringify(body), {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  try {
    const body = await req.json().catch(() => ({}));
    propertyId = body?.property_id ?? body?.client_id;
    const { date_from, date_to } = body ?? {};
    if (!propertyId) {
      return finish("failure", { error: "property_id required" }, 400, "property_id required");
    }

    const from = date_from ?? isoDaysAgo(7);
    const to = date_to ?? isoYesterday();

    const { data: conn, error: connErr } = await admin
      .from("property_data_sources")
      .select("*")
      .eq("property_id", propertyId)
      .eq("source", "google_ads")
      .maybeSingle();

    if (connErr || !conn) {
      return finish("failure", { error: "no google_ads connection for client" }, 404, connErr?.message ?? "no google_ads connection for client");
    }
    if (!conn.external_account_id) {
      return finish("failure", { error: "connection missing customer id" }, 400, "connection missing customer id");
    }

    // Fall back to agency MCC refresh token if this connection has none of its own.
    const effectiveRefreshToken = conn.refresh_token ?? Deno.env.get("GOOGLE_ADS_MCC_REFRESH_TOKEN");
    if (!effectiveRefreshToken) {
      return finish("failure", { error: "no refresh token (per-client or MCC)" }, 400, "no refresh token (per-client or MCC)");
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(effectiveRefreshToken);
    } catch (e) {
      await admin.from("property_data_sources").update({ status: "error", last_error: String(e) }).eq("id", conn.id);
      return finish("failure", { error: String(e) }, 500, String(e));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!,
      "Content-Type": "application/json",
    };
    if (conn.login_customer_id) headers["login-customer-id"] = conn.login_customer_id;

    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${conn.external_account_id}/googleAds:searchStream`;

    // If this connection is scoped to a Google Ads label (e.g. for shared
    // ad accounts), resolve matching campaign IDs first and restrict the
    // metrics query to those campaigns only.
    let campaignIdAllowlist: string[] | null = null;
    const labelFilter: string | null = (conn as any).campaign_label_filter ?? null;
    if (labelFilter && labelFilter.trim()) {
      const escaped = labelFilter.replace(/'/g, "\\'");
      const labelGaql = `SELECT campaign.id, label.name FROM campaign_label WHERE label.name = '${escaped}'`;
      const labelRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: labelGaql }) });
      const labelJson = await labelRes.json();
      if (!labelRes.ok) {
        await admin.from("property_data_sources").update({ status: "error", last_error: JSON.stringify(labelJson).slice(0, 1000) }).eq("id", conn.id);
        return finish("failure", { error: "google ads label query error", detail: labelJson }, 502, JSON.stringify(labelJson));
      }
      const labelChunks = Array.isArray(labelJson) ? labelJson : [labelJson];
      const ids = new Set<string>();
      for (const chunk of labelChunks) {
        for (const r of chunk.results ?? []) {
          const cid = r.campaign?.id;
          if (cid) ids.add(String(cid));
        }
      }
      campaignIdAllowlist = Array.from(ids);
      if (campaignIdAllowlist.length === 0) {
        await admin.from("property_data_sources").update({
          status: "connected",
          last_synced_at: new Date().toISOString(),
          last_error: `no campaigns found for label "${labelFilter}"`,
        }).eq("id", conn.id);
        return finish("success", { ok: true, written: 0, range: { from, to }, note: `no campaigns matched label ${labelFilter}` });
      }
    }

    const gaql = `
      SELECT
        segments.date,
        campaign.name,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${from}' AND '${to}'
      ${campaignIdAllowlist ? `AND campaign.id IN (${campaignIdAllowlist.join(",")})` : ""}
    `;

    const adsRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: gaql }) });
    const adsJson = await adsRes.json();
    if (!adsRes.ok) {
      await admin.from("property_data_sources").update({ status: "error", last_error: JSON.stringify(adsJson).slice(0, 1000) }).eq("id", conn.id);
      return finish("failure", { error: "google ads api error", detail: adsJson }, 502, JSON.stringify(adsJson));
    }

    // searchStream returns an array of result chunks
    const chunks = Array.isArray(adsJson) ? adsJson : [adsJson];
    const rows: Array<{ date: string; campaign: string; cost: number; impressions: number; clicks: number; conversions: number }> = [];
    for (const chunk of chunks) {
      for (const r of chunk.results ?? []) {
        rows.push({
          date: r.segments?.date,
          campaign: r.campaign?.name ?? "(unknown)",
          cost: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
          impressions: Number(r.metrics?.impressions ?? 0),
          clicks: Number(r.metrics?.clicks ?? 0),
          conversions: Number(r.metrics?.conversions ?? 0),
        });
      }
    }

    // Aggregate by (date, campaign) in case API returned dupes
    const agg = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const key = `${r.date}::${r.campaign}`;
      const prev = agg.get(key);
      if (prev) {
        prev.cost += r.cost;
        prev.impressions += r.impressions;
        prev.clicks += r.clicks;
        prev.conversions += r.conversions;
      } else {
        agg.set(key, { ...r });
      }
    }

    const upsertRows = Array.from(agg.values()).map((r) => ({
      property_id: propertyId,
      date: r.date,
      ad_source: "Google PPC",
      campaign: r.campaign,
      cost: r.cost,
      impressions: r.impressions,
      clicks: r.clicks,
    }));

    let written = 0;
    if (upsertRows.length) {
      // Non-destructive merge-upsert: preserve CTM-owned (record_count/leads/etc.) and
      // GA4-owned (sessions/users) columns when a row already exists for this key.
      const dates = Array.from(new Set(upsertRows.map(r => r.date)));
      const { data: existing } = await admin
        .from("daily_metrics")
        .select("date,campaign,record_count,leads,good_leads,bad_leads,medicaid,projected_sale,verified_sale,no_entry,spam,sessions,users")
        .eq("property_id", propertyId)
        .eq("ad_source", "Google PPC")
        .in("date", dates);
      const existingMap = new Map<string, any>();
      for (const r of (existing ?? []) as any[]) {
        existingMap.set(`${r.date}::${r.campaign}`, r);
      }
      const merged = upsertRows.map((r) => {
        const prev = existingMap.get(`${r.date}::${r.campaign}`);
        return {
          ...r,
          record_count: prev ? Number(prev.record_count ?? 0) : 0,
          leads: prev ? Number(prev.leads ?? 0) : 0,
          good_leads: prev ? Number(prev.good_leads ?? 0) : 0,
          bad_leads: prev ? Number(prev.bad_leads ?? 0) : 0,
          medicaid: prev ? Number(prev.medicaid ?? 0) : 0,
          projected_sale: prev ? Number(prev.projected_sale ?? 0) : 0,
          verified_sale: prev ? Number(prev.verified_sale ?? 0) : 0,
          no_entry: prev ? Number(prev.no_entry ?? 0) : 0,
          spam: prev ? Number(prev.spam ?? 0) : 0,
          sessions: prev ? Number(prev.sessions ?? 0) : 0,
          users: prev ? Number(prev.users ?? 0) : 0,
        };
      });
      const { error: insErr, count } = await admin
        .from("daily_metrics")
        .upsert(merged, { onConflict: "property_id,date,ad_source,campaign", count: "exact" });
      if (insErr) {
        await admin.from("property_data_sources").update({ status: "error", last_error: insErr.message }).eq("id", conn.id);
        return finish("failure", { error: insErr.message }, 500, insErr.message);
      }
      written = count ?? merged.length;
    }

    await admin
      .from("property_data_sources")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);

    // Also refresh per-campaign daily budget snapshot for Budget Pacing.
    try {
      const budgetGaql = `
        SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED'
        ${campaignIdAllowlist ? `AND campaign.id IN (${campaignIdAllowlist.join(",")})` : ""}
      `;
      const bRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: budgetGaql }) });
      const bJson = await bRes.json();
      if (bRes.ok) {
        const bChunks = Array.isArray(bJson) ? bJson : [bJson];
        const budgetRows: Array<{ property_id: string; campaign: string; daily_budget: number; status: string }> = [];
        const seen = new Set<string>();
        for (const chunk of bChunks) {
          for (const r of chunk.results ?? []) {
            const name = r.campaign?.name ?? "(unknown)";
            if (seen.has(name)) continue;
            seen.add(name);
            budgetRows.push({
              property_id: propertyId,
              campaign: name,
              daily_budget: Number(r.campaignBudget?.amountMicros ?? 0) / 1_000_000,
              status: String(r.campaign?.status ?? ""),
            });
          }
        }
        // Snapshot: clear prior rows for this property then insert current.
        await admin.from("campaign_budgets").delete().eq("property_id", propertyId);
        if (budgetRows.length) {
          await admin.from("campaign_budgets").insert(budgetRows.map((r) => ({ ...r, synced_at: new Date().toISOString() })));
        }
      }
    } catch (e) {
      console.error("campaign_budgets snapshot failed", e);
    }

    // Refresh campaign↔label mapping for Budget Pacing label filtering.
    try {
      const labelMapGaql = `
        SELECT campaign.name, label.name
        FROM campaign_label
        WHERE campaign.status != 'REMOVED'
        ${campaignIdAllowlist ? `AND campaign.id IN (${campaignIdAllowlist.join(",")})` : ""}
      `;
      const lmRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: labelMapGaql }) });
      const lmJson = await lmRes.json();
      if (lmRes.ok) {
        const lmChunks = Array.isArray(lmJson) ? lmJson : [lmJson];
        const labelRows: Array<{ property_id: string; campaign: string; label_name: string }> = [];
        const seen = new Set<string>();
        for (const chunk of lmChunks) {
          for (const r of chunk.results ?? []) {
            const c = r.campaign?.name;
            const l = r.label?.name;
            if (!c || !l) continue;
            const key = `${c}::${l}`;
            if (seen.has(key)) continue;
            seen.add(key);
            labelRows.push({ property_id: propertyId, campaign: c, label_name: l });
          }
        }
        await admin.from("campaign_labels").delete().eq("property_id", propertyId);
        if (labelRows.length) {
          await admin.from("campaign_labels").insert(labelRows.map((r) => ({ ...r, synced_at: new Date().toISOString() })));
        }
      }
    } catch (e) {
      console.error("campaign_labels snapshot failed", e);
    }

    return finish("success", { ok: true, written, range: { from, to } });
  } catch (e) {
    return finish("failure", { error: String(e) }, 500, String(e));
  }
});
