// Pulls call data from CTM API for one client and upserts into daily_metrics.
// Uses agency-wide CTM_API_* secrets. The client_data_sources row's external_account_id
// holds the CTM sub-account ID.
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
function isoYesterday(): string { return isoDaysAgo(1); }

function ctmAuthHeader(): string {
  const access = Deno.env.get("CTM_API_ACCESS_KEY") ?? "";
  const secret = Deno.env.get("CTM_API_SECRET_KEY") ?? "";
  return "Basic " + btoa(`${access}:${secret}`);
}

type Bucket = "admission" | "good" | "medicaid" | "bad" | "spam" | "repeat" | "no_entry" | "ignore";

// Extract every score-like label string from a CTM call payload.
// CTM's primary scoring field is `call.sale.name` (the "Score" set in CTM UI).
// We also defensively read `call.score`, `call.score_name`, and tag arrays in case
// future accounts surface scores there too.
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
  const lists = [call?.tags, call?.reporting_tags, call?.scoring_tags];
  for (const list of lists) {
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

// Map a CTM call to a bucket using the per-client score-label mapping.
// Lower priority number wins when multiple labels match. Unmapped labels are ignored.
// No labels at all → "no_entry".
function classifyCall(call: any, mapping: Map<string, { bucket: Bucket; priority: number }>): Bucket {
  const labels = extractScoreLabels(call);
  if (labels.length === 0) return "no_entry";
  let best: { bucket: Bucket; priority: number } | null = null;
  for (const raw of labels) {
    const key = raw.toLowerCase();
    const hit = mapping.get(key);
    if (!hit) continue;
    if (!best || hit.priority < best.priority) best = hit;
  }
  // If labels exist but none match the mapping, treat as no_entry (still a real call).
  return best ? best.bucket : "no_entry";
}

// Map CTM's `source` field directly to a dashboard channel.
// CTM's `source` field carries the source-name string set in the CTM UI
// ("Google Ads", "Facebook Call Extension", etc.) — exactly the values
// we want to surface as channels. Exact-string lookup, case-sensitive.
// Anything not in this table — including blank or missing — falls into "Other".
const TRACKING_SOURCE_MAP: Record<string, string> = {
  "Google Ads": "Google PPC",
  "Google Call Asset": "Google PPC",
  "GMB Ad Extension": "Google PPC",
  "Facebook": "Facebook",
  "Facebook Call Extension": "Facebook",
  "Multi-Organic Search": "Organic",
  "Referral": "Referral",
  "Direct": "Direct",
};

// Returns the dashboard channel for a call. If the source isn't in our allowed
// lookup table (or is missing/blank) we still keep the call as "Other" so the
// volume shows up on the dashboard. This makes admin diagnostics visible —
// previously these calls were silently dropped before record_count could see them.
function classifyChannel(call: any): string {
  const ts = call?.source;
  if (typeof ts === "string" && TRACKING_SOURCE_MAP[ts]) return TRACKING_SOURCE_MAP[ts];
  return "Other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const { client_id, date_from, date_to, debug } = body ?? {};
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const access = Deno.env.get("CTM_API_ACCESS_KEY");
    const secret = Deno.env.get("CTM_API_SECRET_KEY");
    if (!access || !secret) {
      return new Response(JSON.stringify({ error: "missing CTM secrets" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const from = date_from ?? isoDaysAgo(30);
    const to = date_to ?? isoYesterday();

    const { data: conn, error: connErr } = await admin
      .from("client_data_sources")
      .select("*")
      .eq("client_id", client_id)
      .eq("source", "ctm")
      .maybeSingle();
    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: "no ctm connection for client" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const subAccountId = conn.external_account_id;
    if (!subAccountId) {
      return new Response(JSON.stringify({ error: "connection missing CTM sub-account id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch all calls in date range, paginated.
    const calls: any[] = [];
    let page = 1;
    const perPage = 150;
    while (true) {
      const url = `https://api.calltrackingmetrics.com/api/v1/accounts/${subAccountId}/calls/search.json?start_date=${from}&end_date=${to}&page=${page}&per_page=${perPage}&fields=tag_list,tags,score,sale,source,custom_fields,reporting_tags,scoring_tags`;
      const res = await fetch(url, { headers: { Authorization: ctmAuthHeader(), Accept: "application/json" } });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* */ }

      if (!res.ok) {
        await admin.from("client_data_sources").update({ status: "error", last_error: (text || "").slice(0, 1000) }).eq("id", conn.id);
        return new Response(
          JSON.stringify({ error: "ctm api error", status: res.status, detail: (text || "").slice(0, 500), url }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const list = (json?.calls ?? []) as any[];
      calls.push(...list);
      const totalPages = Number(json?.total_pages ?? 1);
      if (list.length < perPage || page >= totalPages) break;
      page++;
      if (page > 50) break;
    }

    if (debug) {
      // Pick the first 3 calls that look "scored" — i.e., have any non-empty tag/score field.
      // Fall back to first 3 calls if none look scored.
      const looksScored = (c: any) => {
        if (c.score != null && String(c.score).trim()) return true;
        if (Array.isArray(c.tags) && c.tags.length) return true;
        if (typeof c.tag_list === "string" && c.tag_list.trim()) return true;
        if (Array.isArray(c.tag_list) && c.tag_list.length) return true;
        return false;
      };
      const scoredFirst = [...calls].sort((a, b) => Number(looksScored(b)) - Number(looksScored(a)));
      const pickIds = scoredFirst.slice(0, 3).map((c) => c.id).filter(Boolean);

      // Fetch the FULL raw payload for each picked call — every key, no filtering.
      const fullDetails: any[] = [];
      for (const cid of pickIds) {
        try {
          const dUrl = `https://api.calltrackingmetrics.com/api/v1/accounts/${subAccountId}/calls/${cid}.json`;
          const dRes = await fetch(dUrl, { headers: { Authorization: ctmAuthHeader(), Accept: "application/json" } });
          const dText = await dRes.text();
          let dJson: any = null;
          try { dJson = JSON.parse(dText); } catch { /* */ }
          fullDetails.push({
            id: cid,
            http_status: dRes.status,
            raw: dJson ?? dText.slice(0, 4000),
          });
        } catch (e) {
          fullDetails.push({ id: cid, error: String(e) });
        }
      }

      // Also keep a quick aggregate so we can spot fields used across the whole list.
      const tagCounts = new Map<string, number>();
      const allScores = new Set<string>();
      const sourceCounts = new Map<string, number>();
      const scoreLabelCounts = new Map<string, number>();
      const topLevelKeys = new Set<string>();
      for (const c of calls) {
        for (const k of Object.keys(c)) topLevelKeys.add(k);
        if (c.score != null) allScores.add(String(c.score));
        // Track every source seen so admin can decide what to map.
        const srcVal = typeof c.source === "string" && c.source.trim() ? c.source : "(blank)";
        sourceCounts.set(srcVal, (sourceCounts.get(srcVal) ?? 0) + 1);
        // Track every score-like label found via the same extractor used during sync.
        for (const lab of extractScoreLabels(c)) {
          scoreLabelCounts.set(lab, (scoreLabelCounts.get(lab) ?? 0) + 1);
        }
        const raw = c.tag_list;
        let tagArr: string[] = [];
        if (Array.isArray(raw)) tagArr = raw.map((x: any) => String(x.name ?? x));
        else if (typeof raw === "string" && raw.trim()) tagArr = raw.split(",").map((s) => s.trim()).filter(Boolean);
        for (const t of tagArr) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
        for (const t of (c.tags ?? [])) {
          const name = typeof t === "string" ? t : (t.name ?? JSON.stringify(t));
          tagCounts.set(`obj:${name}`, (tagCounts.get(`obj:${name}`) ?? 0) + 1);
        }
      }

      return new Response(JSON.stringify({
        total_calls: calls.length,
        range: { from, to },
        distinct_scores: Array.from(allScores),
        distinct_sources: Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1]),
        distinct_score_labels: Array.from(scoreLabelCounts.entries()).sort((a, b) => b[1] - a[1]),
        tag_usage: Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]),
        list_top_level_keys: Array.from(topLevelKeys).sort(),
        picked_call_ids: pickIds,
        full_details: fullDetails,
      }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load per-client score-label → bucket mapping (case-insensitive lookup).
    const { data: mapRows, error: mapErr } = await admin
      .from("client_call_score_mappings")
      .select("score_label,bucket,priority")
      .eq("client_id", client_id);
    if (mapErr) {
      return new Response(JSON.stringify({ error: `mapping load failed: ${mapErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const mapping = new Map<string, { bucket: Bucket; priority: number }>();
    for (const m of (mapRows ?? []) as any[]) {
      mapping.set(String(m.score_label).toLowerCase(), { bucket: m.bucket as Bucket, priority: Number(m.priority ?? 100) });
    }

    // Aggregate by date + channel + campaign.
    // record_count = every call we received (informational).
    // leads = admission + good + medicaid + bad + no_entry. Spam and Repeat NEVER add to leads.
    // Repeat callers are skipped entirely.
    type Agg = { record_count: number; leads: number; good_leads: number; bad_leads: number; medicaid: number; admissions: number; no_entry: number; spam: number };
    const agg = new Map<string, Agg>(); // key = date::channel::campaign
    const newAgg = (): Agg => ({ record_count: 0, leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, admissions: 0, no_entry: 0, spam: 0 });
    for (const c of calls) {
      const callDate = (c.called_at ?? c.start_time ?? c.date ?? "").slice(0, 10);
      if (!callDate) continue;
      const cls = classifyCall(c, mapping);
      if (cls === "repeat" || cls === "ignore") continue; // excluded entirely
      const channel = classifyChannel(c); // always returns a string ("Other" if unknown)
      const campaign = (c.campaign ?? c.utm_campaign ?? c.source ?? "(unattributed)").toString().slice(0, 120);
      const key = `${callDate}::${channel}::${campaign}`;
      const b = agg.get(key) ?? newAgg();
      b.record_count += 1;
      switch (cls) {
        case "admission": b.admissions += 1; b.leads += 1; break;
        case "good":      b.good_leads += 1; b.leads += 1; break;
        case "medicaid":  b.medicaid   += 1; b.leads += 1; break;
        case "bad":       b.bad_leads  += 1; b.leads += 1; break;
        case "no_entry":  b.no_entry   += 1; b.leads += 1; break;
        case "spam":      b.spam       += 1; break; // tracked, not a lead
      }
      agg.set(key, b);
    }

    const upsertRows = Array.from(agg.entries()).map(([key, b]) => {
      const [date, channel, campaign] = key.split("::");
      return {
        client_id,
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
        medicaid: b.medicaid,
        no_entry: b.no_entry,
        spam: b.spam,
        admissions: b.admissions,
      };
    });

    let written = 0;
    if (upsertRows.length) {
      // Non-destructive merge-upsert: fetch existing rows for the keys we're about to write
      // so we can preserve foreign-source columns (cost/impressions/clicks from Google Ads,
      // sessions/users from GA4) instead of zeroing them out.
      const dates = Array.from(new Set(upsertRows.map(r => r.date)));
      const channels = Array.from(new Set(upsertRows.map(r => r.ad_source)));
      const { data: existing } = await admin
        .from("daily_metrics")
        .select("date,ad_source,campaign,cost,impressions,clicks,sessions,users")
        .eq("client_id", client_id)
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
        .upsert(merged, { onConflict: "client_id,date,ad_source,campaign", count: "exact" });
      if (insErr) {
        await admin.from("client_data_sources").update({ status: "error", last_error: insErr.message }).eq("id", conn.id);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      written = count ?? merged.length;
    }

    await admin.from("client_data_sources")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);

    return new Response(JSON.stringify({ ok: true, written, calls: calls.length, range: { from, to } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
