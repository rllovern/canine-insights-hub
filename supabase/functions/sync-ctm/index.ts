// Pulls call data from CTM for one property and writes both raw ctm_calls
// rows and aggregated daily_metrics rows. Per-property credentials live in
// property_data_sources.config (api_token, api_secret, account_id, number_filter).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string { return new Date().toISOString().slice(0, 10); }

type Bucket = "admission" | "good" | "bad" | "spam" | "repeat" | "no_entry" | "unmapped" | "ignore";

function extractScoreLabels(call: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s) out.push(s);
  };
  push(call?.sale?.name);
  push(call?.score);
  push(call?.score_name);
  for (const list of [call?.tags, call?.reporting_tags, call?.scoring_tags]) {
    if (Array.isArray(list)) {
      for (const t of list) {
        if (typeof t === "string") push(t);
        else if (t && typeof t === "object") push(t.name ?? t.label ?? t.tag);
      }
    }
  }
  const tl = call?.tag_list;
  if (Array.isArray(tl)) {
    for (const t of tl) {
      if (typeof t === "string") push(t);
      else if (t && typeof t === "object") push(t.name ?? t.label ?? t.tag);
    }
  } else if (typeof tl === "string" && tl.trim()) {
    for (const s of tl.split(",")) push(s);
  }
  return out;
}

function classifyCall(call: any, mapping: Map<string, { bucket: Bucket; priority: number }>): Bucket {
  const labels = extractScoreLabels(call);
  if (labels.length === 0) return "no_entry";
  let best: { bucket: Bucket; priority: number } | null = null;
  for (const raw of labels) {
    const hit = mapping.get(raw.toLowerCase());
    if (!hit) continue;
    if (!best || hit.priority < best.priority) best = hit;
  }
  // Has at least one score label, but none of them mapped to a bucket.
  // This is "scored, but uncategorized" — count it in records only, not in no_entry.
  return best ? best.bucket : "unmapped";
}

const TRACKING_SOURCE_MAP: Record<string, string> = {
  "Google Ads": "Google PPC",
  "Google Call Asset": "Google PPC",
  "GMB Ad Extension": "Google PPC",
  "Facebook": "Facebook",
  "Facebook Call Extension": "Facebook",
  "Facebook Call Asset": "Facebook",
  "Multi-Organic Search": "Organic",
  "Referral": "Referral",
  "Direct": "Direct",
};

function classifyChannel(call: any): string {
  const ts = call?.source;
  if (typeof ts === "string" && TRACKING_SOURCE_MAP[ts]) return TRACKING_SOURCE_MAP[ts];
  return "Other";
}

function bucketLabel(b: Bucket): string {
  return b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const startedAt = new Date().toISOString();
  let propertyId: string | undefined;

  const finish = async (status: "success" | "failure", body: Record<string, unknown>, httpStatus = 200, errMsg?: string) => {
    try {
      await admin.from("sync_runs").insert({
        property_id: propertyId ?? null,
        source: "ctm",
        status,
        error_message: errMsg ? errMsg.slice(0, 2000) : null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        stats: body as never,
      });
    } catch { /* swallow */ }
    return new Response(JSON.stringify(body), {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  try {
    const body = await req.json().catch(() => ({}));
    // Accept both new and legacy arg names so it works regardless of caller.
    propertyId = body.property_id ?? body.client_id;
    const from = body.from_date ?? body.date_from ?? isoDaysAgo(30);
    const to = body.to_date ?? body.date_to ?? isoToday();
    const debug = !!body.debug;

    if (!propertyId) {
      return finish("failure", { error: "property_id required" }, 400, "property_id required");
    }

    const { data: conn, error: connErr } = await admin
      .from("property_data_sources")
      .select("*")
      .eq("property_id", propertyId)
      .eq("source", "ctm")
      .maybeSingle();
    if (connErr || !conn) {
      return finish("failure", { error: "no ctm connection for property" }, 404, connErr?.message ?? "no connection");
    }

    const cfg = (conn.config ?? {}) as Record<string, any>;
    const agencyToken = Deno.env.get("CTM_API_ACCESS_KEY") ?? "";
    const agencySecret = Deno.env.get("CTM_API_SECRET_KEY") ?? "";
    const useAgency = cfg.use_agency_credentials === true || (!cfg.api_token && !cfg.api_secret);
    const accountId = cfg.account_id ?? conn.external_account_id;
    const apiToken = useAgency ? agencyToken : cfg.api_token;
    const apiSecret = useAgency ? agencySecret : cfg.api_secret;
    const numberFilter: string[] = Array.isArray(cfg.number_filter) ? cfg.number_filter : [];

    if (!accountId || !apiToken || !apiSecret) {
      const msg = useAgency
        ? "CTM connection missing account_id (or agency CTM_API_ACCESS_KEY/CTM_API_SECRET_KEY not configured)"
        : "CTM connection missing account_id / api_token / api_secret in config";
      await admin.from("property_data_sources").update({ status: "error", last_error: msg }).eq("id", conn.id);
      return finish("failure", { error: msg }, 400, msg);
    }

    const authHeader = "Basic " + btoa(`${apiToken}:${apiSecret}`);

    // Page through CTM calls.
    const calls: any[] = [];
    let page = 1;
    const perPage = 150;
    while (true) {
      const url = `https://api.calltrackingmetrics.com/api/v1/accounts/${accountId}/calls/search.json?start_date=${from}&end_date=${to}&page=${page}&per_page=${perPage}&fields=tag_list,tags,score,sale,source,custom_fields,reporting_tags,scoring_tags,tracking_number,called_at,start_time`;
      const res = await fetch(url, { headers: { Authorization: authHeader, Accept: "application/json" } });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* */ }

      if (!res.ok) {
        const msg = `CTM API ${res.status}: ${(text || "").slice(0, 500)}`;
        await admin.from("property_data_sources").update({ status: "error", last_error: msg.slice(0, 1000) }).eq("id", conn.id);
        return finish("failure", { error: "ctm api error", status: res.status, detail: msg, url }, 502, msg);
      }

      const list = (json?.calls ?? []) as any[];
      calls.push(...list);
      const totalPages = Number(json?.total_pages ?? 1);
      if (list.length < perPage || page >= totalPages) break;
      page++;
      if (page > 50) break;
    }

    // Optional per-property number filter (CTM account can serve multiple locations).
    const filtered = numberFilter.length
      ? calls.filter((c) => {
          const num = String(c.tracking_number ?? c.called_to ?? "").replace(/[^\d+]/g, "");
          return numberFilter.some((f) => String(f).replace(/[^\d+]/g, "") === num);
        })
      : calls;

    if (debug) {
      return finish("success", {
        total_calls: calls.length,
        after_filter: filtered.length,
        sample: filtered.slice(0, 3),
        range: { from, to },
      });
    }

    // Score-label mapping for this property.
    const { data: mapRows, error: mapErr } = await admin
      .from("property_call_score_mappings")
      .select("score_label,bucket,priority")
      .eq("property_id", propertyId);
    if (mapErr) {
      return finish("failure", { error: `mapping load failed: ${mapErr.message}` }, 500, mapErr.message);
    }
    const mapping = new Map<string, { bucket: Bucket; priority: number }>();
    for (const m of (mapRows ?? []) as any[]) {
      mapping.set(String(m.score_label).toLowerCase(), { bucket: m.bucket as Bucket, priority: Number(m.priority ?? 100) });
    }

    // Upsert raw call rows into ctm_calls.
    const callRows = filtered.map((c) => {
      const calledAt = c.called_at ?? c.start_time ?? c.date ?? null;
      const cls = classifyCall(c, mapping);
      return {
        property_id: propertyId,
        ctm_call_id: String(c.id ?? c.call_id ?? crypto.randomUUID()),
        called_at: calledAt,
        duration_seconds: Number(c.duration ?? c.duration_seconds ?? 0) || null,
        tracking_source: typeof c.source === "string" ? c.source : null,
        channel: classifyChannel(c),
        campaign_name: (c.campaign ?? c.utm_campaign ?? null) as string | null,
        ad_group: (c.ad_group ?? null) as string | null,
        caller_number: (c.caller_number ?? c.from ?? null) as string | null,
        call_score_label: extractScoreLabels(c)[0] ?? null,
        call_score_bucket: bucketLabel(cls),
        raw_payload: c as never,
      };
    }).filter((r) => r.called_at);

    let callsWritten = 0;
    if (callRows.length) {
      const { error: ccErr, count } = await admin
        .from("ctm_calls")
        .upsert(callRows, { onConflict: "property_id,ctm_call_id", count: "exact" });
      if (ccErr) {
        await admin.from("property_data_sources").update({ status: "error", last_error: ccErr.message }).eq("id", conn.id);
        return finish("failure", { error: `ctm_calls upsert failed: ${ccErr.message}` }, 500, ccErr.message);
      }
      callsWritten = count ?? callRows.length;
    }

    // Aggregate by date × channel × campaign for daily_metrics.
    type Agg = { record_count: number; leads: number; good_leads: number; bad_leads: number; admissions: number; no_entry: number; spam: number };
    const agg = new Map<string, Agg>();
    const newAgg = (): Agg => ({ record_count: 0, leads: 0, good_leads: 0, bad_leads: 0, admissions: 0, no_entry: 0, spam: 0 });
    for (const c of filtered) {
      const callDate = String(c.called_at ?? c.start_time ?? c.date ?? "").slice(0, 10);
      if (!callDate) continue;
      const cls = classifyCall(c, mapping);
      if (cls === "repeat" || cls === "ignore") continue;
      const channel = classifyChannel(c);
      const campaign = (c.campaign ?? c.utm_campaign ?? c.source ?? "(unattributed)").toString().slice(0, 120);
      const key = `${callDate}::${channel}::${campaign}`;
      const b = agg.get(key) ?? newAgg();
      b.record_count += 1;
      switch (cls) {
        case "admission": b.admissions += 1; b.leads += 1; break;
        case "good":      b.good_leads += 1; b.leads += 1; break;
        case "bad":       b.bad_leads  += 1; b.leads += 1; break;
        case "no_entry":  b.no_entry   += 1; b.leads += 1; break;
        case "spam":      b.spam       += 1; break;
        case "unmapped":  /* counted in record_count only */ break;
      }
      agg.set(key, b);
    }

    const upsertRows = Array.from(agg.entries()).map(([key, b]) => {
      const [date, channel, campaign] = key.split("::");
      return {
        property_id: propertyId,
        date,
        ad_source: channel,
        campaign,
        cost: 0,
        impressions: 0,
        clicks: 0,
        sessions: 0,
        users: 0,
        record_count: b.record_count,
        leads: b.leads,
        good_leads: b.good_leads,
        bad_leads: b.bad_leads,
        no_entry: b.no_entry,
        spam: b.spam,
        admissions: b.admissions,
      };
    });

    let metricsWritten = 0;
    if (upsertRows.length) {
      const dates = Array.from(new Set(upsertRows.map(r => r.date)));
      const channels = Array.from(new Set(upsertRows.map(r => r.ad_source)));
      const { data: existing } = await admin
        .from("daily_metrics")
        .select("date,ad_source,campaign,cost,impressions,clicks,sessions,users")
        .eq("property_id", propertyId)
        .in("date", dates)
        .in("ad_source", channels);
      const existingMap = new Map<string, { cost: number; impressions: number; clicks: number; sessions: number; users: number }>();
      for (const r of (existing ?? []) as any[]) {
        existingMap.set(`${r.date}::${r.ad_source}::${r.campaign}`, {
          cost: Number(r.cost ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          sessions: Number(r.sessions ?? 0),
          users: Number(r.users ?? 0),
        });
      }
      const merged = upsertRows.map((r) => {
        const prev = existingMap.get(`${r.date}::${r.ad_source}::${r.campaign}`);
        return prev ? { ...r, cost: prev.cost, impressions: prev.impressions, clicks: prev.clicks, sessions: prev.sessions, users: prev.users } : r;
      });
      const { error: insErr, count } = await admin
        .from("daily_metrics")
        .upsert(merged, { onConflict: "property_id,date,ad_source,campaign", count: "exact" });
      if (insErr) {
        await admin.from("property_data_sources").update({ status: "error", last_error: insErr.message }).eq("id", conn.id);
        return finish("failure", { error: `daily_metrics upsert failed: ${insErr.message}` }, 500, insErr.message);
      }
      metricsWritten = count ?? merged.length;
    }

    await admin.from("property_data_sources")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);

    return finish("success", {
      ok: true,
      calls: filtered.length,
      total_fetched: calls.length,
      calls_written: callsWritten,
      rows_written: metricsWritten,
      range: { from, to },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return finish("failure", { error: msg }, 500, msg);
  }
});
