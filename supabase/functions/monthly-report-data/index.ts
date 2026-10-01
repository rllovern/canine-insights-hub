// Monthly Google Ads report data (campaigns, networks, daily, ad groups, ads,
// keywords + quality score) for a selected month vs the prior month.
// Access: super admin JWT with property_id, OR a valid public report token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const API = "v23";
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const today = new Date();
  const capped = end > today ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1)) : end;
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { from: f(start), to: f(capped < start ? start : capped) };
}
function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

type M = { impressions: number; clicks: number; cost: number; conversions: number };
const zero = (): M => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
const addM = (a: M, r: any) => {
  a.impressions += Number(r.metrics?.impressions ?? 0);
  a.clicks += Number(r.metrics?.clicks ?? 0);
  a.cost += Number(r.metrics?.costMicros ?? 0) / 1e6;
  a.conversions += Number(r.metrics?.conversions ?? 0);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(URL_, SK);
    const body = await req.json().catch(() => ({}));
    const month = String(body?.month ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "month must be YYYY-MM" }, 400);

    let propertyId: string | null = null;
    if (typeof body?.token === "string" && body.token.length >= 8 && body.token.length <= 200) {
      const { data } = await admin.from("properties").select("id").eq("public_report_token", body.token).eq("is_active", true).maybeSingle();
      if (!data) return json({ error: "Invalid report link" }, 404);
      propertyId = data.id;
    } else {
      const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
      const anon = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: u } = await anon.auth.getUser(tok);
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      const { data: isSa } = await admin.rpc("is_super_admin", { _user_id: u.user.id });
      if (!isSa) return json({ error: "Forbidden" }, 403);
      if (typeof body?.property_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.property_id)) return json({ error: "property_id required" }, 400);
      propertyId = body.property_id;
    }

    const { data: prop } = await admin.from("properties").select("id,name,slug,logo_url,public_report_token").eq("id", propertyId).maybeSingle();
    const { data: conn } = await admin.from("property_data_sources").select("*").eq("property_id", propertyId).eq("source", "google_ads").maybeSingle();
    if (!prop || !conn?.external_account_id) return json({ error: "No Google Ads connection for this location" }, 404);

    const rt = conn.refresh_token ?? Deno.env.get("GOOGLE_ADS_MCC_REFRESH_TOKEN");
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
        refresh_token: rt!, grant_type: "refresh_token",
      }),
    });
    const tj = await tr.json();
    if (!tj.access_token) return json({ error: "Google auth failed", details: tj }, 502);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tj.access_token}`,
      "developer-token": Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!,
      "Content-Type": "application/json",
    };
    if (conn.login_customer_id) headers["login-customer-id"] = conn.login_customer_id;
    const url = `https://googleads.googleapis.com/${API}/customers/${conn.external_account_id}/googleAds:searchStream`;
    const q = async (query: string): Promise<any[]> => {
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
      const j = await r.json();
      if (!r.ok) throw new Error(`[${r.status}] ${JSON.stringify(j).slice(0, 800)}`);
      return (Array.isArray(j) ? j : [j]).flatMap((c: any) => c.results ?? []);
    };

    let allow = "";
    const label = (conn as any).campaign_label_filter as string | null;
    if (label?.trim()) {
      const rows = await q(`SELECT campaign.id FROM campaign_label WHERE label.name = '${label.replace(/'/g, "\\'")}'`);
      const ids = [...new Set(rows.map((r) => String(r.campaign?.id)).filter(Boolean))];
      allow = ids.length ? ` AND campaign.id IN (${ids.join(",")})` : " AND campaign.id = 0";
    }

    const cur = monthRange(month);
    const prvYm = prevMonth(month);
    const prv = monthRange(prvYm);
    const between = (r: { from: string; to: string }) => `segments.date BETWEEN '${r.from}' AND '${r.to}'`;
    const base = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions";

    const period = async (r: { from: string; to: string }) => {
      const rows = await q(`SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ${base},
        metrics.search_impression_share FROM campaign WHERE ${between(r)}${allow}`);
      const total = zero();
      const daily = new Map<string, M>();
      const networks = new Map<string, M>();
      const camps = new Map<string, M & { name: string; channel: string; isSum: number; isN: number }>();
      for (const x of rows) {
        addM(total, x);
        const d = x.segments.date;
        if (!daily.has(d)) daily.set(d, zero());
        addM(daily.get(d)!, x);
        const ch = x.campaign.advertisingChannelType ?? "OTHER";
        if (!networks.has(ch)) networks.set(ch, zero());
        addM(networks.get(ch)!, x);
        const id = String(x.campaign.id);
        if (!camps.has(id)) camps.set(id, { ...zero(), name: x.campaign.name, channel: ch, isSum: 0, isN: 0 });
        const c = camps.get(id)!;
        addM(c, x);
        const is = Number(x.metrics?.searchImpressionShare);
        if (is > 0) { c.isSum += is; c.isN++; }
      }
      return {
        total,
        daily: [...daily.entries()].sort().map(([date, m]) => ({ date, ...m })),
        networks: [...networks.entries()].map(([channel, m]) => ({ channel, ...m })),
        campaigns: [...camps.values()].map(({ isSum, isN, ...c }) => ({ ...c, impressionShare: isN ? isSum / isN : null }))
          .sort((a, b) => b.clicks - a.clicks),
      };
    };

    const [current, previous] = await Promise.all([period(cur), period(prv)]);

    const agRows = await q(`SELECT ad_group.id, ad_group.name, campaign.name, ${base} FROM ad_group WHERE ${between(cur)}${allow}`);
    const ag = new Map<string, any>();
    for (const x of agRows) {
      const id = String(x.adGroup.id);
      if (!ag.has(id)) ag.set(id, { name: x.adGroup.name, campaign: x.campaign.name, ...zero() });
      addM(ag.get(id), x);
    }

    const adRows = await q(`SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group.name, ${base} FROM ad_group_ad WHERE ${between(cur)}${allow}`);
    const ads = new Map<string, any>();
    for (const x of adRows) {
      const a = x.adGroupAd.ad;
      const id = String(a.id);
      if (!ads.has(id)) ads.set(id, {
        adGroup: x.adGroup.name, type: a.type,
        headlines: (a.responsiveSearchAd?.headlines ?? []).map((h: any) => h.text).slice(0, 3),
        description: a.responsiveSearchAd?.descriptions?.[0]?.text ?? null,
        finalUrl: a.finalUrls?.[0] ?? null, ...zero(),
      });
      addM(ads.get(id), x);
    }

    const kwRows = await q(`SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score,
      ad_group.id, ad_group.name, ${base} FROM keyword_view WHERE ${between(cur)}${allow}`);
    const kws = new Map<string, any>();
    for (const x of kwRows) {
      const id = `${x.adGroup.id}~${x.adGroupCriterion.criterionId}`;
      if (!kws.has(id)) kws.set(id, {
        text: x.adGroupCriterion.keyword?.text, matchType: x.adGroupCriterion.keyword?.matchType,
        qualityScore: x.adGroupCriterion.qualityInfo?.qualityScore ?? null, adGroup: x.adGroup.name, ...zero(),
      });
      addM(kws.get(id), x);
    }

    const top = (m: Map<string, any>, n: number) => [...m.values()].filter((v) => v.impressions > 0).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, n);

    return json({
      property: { id: prop.id, name: prop.name, logo_url: prop.logo_url },
      month, prevMonth: prvYm, range: cur, prevRange: prv,
      current, previous,
      adGroups: top(ag, 15), ads: top(ads, 10), keywords: top(kws, 25),
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("monthly-report-data failed", e);
    return json({ error: "Report data failed", details: String(e) }, 502);
  }
});
