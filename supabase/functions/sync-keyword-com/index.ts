// Pulls keyword rankings + Share of Voice from Keyword.com for one client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://app.keyword.com/api/v2";

async function kwFetch(path: string, token: string, attempt = 0): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return kwFetch(path, token, attempt + 1);
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message ?? json?.message ?? text.slice(0, 300);
    throw new Error(`keyword.com ${res.status}: ${msg}`);
  }
  return json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const { client_id } = body ?? {};
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: conn, error: connErr } = await admin
      .from("client_data_sources")
      .select("*")
      .eq("client_id", client_id)
      .eq("source", "keyword_com")
      .maybeSingle();
    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: "no keyword_com connection for client" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = conn.refresh_token as string | null;
    const project = conn.external_account_id as string | null;
    if (!token || !project) {
      return new Response(JSON.stringify({ error: "connection missing token or project name" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const today = new Date().toISOString().slice(0, 10);
    const projectEnc = encodeURIComponent(project);

    // ---- Fetch all keywords (paginated) ----
    const keywords: any[] = [];
    let page = 1;
    while (true) {
      const json = await kwFetch(`/groups/${projectEnc}/keywords?page=${page}&per_page=100`, token);
      const rows = (json?.data ?? []) as any[];
      keywords.push(...rows);
      const totalPages = json?.meta?.pagination?.total_pages ?? 1;
      if (page >= totalPages || rows.length === 0) break;
      page++;
      if (page > 100) break; // safety
    }

    // Fetch latest prior position per keyword to populate previous_position
    const ids = keywords.map((k) => Number(k.id ?? k.keyword_id)).filter((n) => Number.isFinite(n));
    const prevMap = new Map<number, number | null>();
    if (ids.length) {
      const { data: prevRows } = await admin
        .from("keyword_rankings")
        .select("keyword_id,position,captured_at")
        .eq("client_id", client_id)
        .in("keyword_id", ids)
        .lt("captured_at", today)
        .order("captured_at", { ascending: false })
        .limit(2000);
      for (const r of (prevRows ?? []) as any[]) {
        if (!prevMap.has(Number(r.keyword_id))) prevMap.set(Number(r.keyword_id), r.position);
      }
    }

    const upserts = keywords.map((k) => {
      const kid = Number(k.id ?? k.keyword_id);
      const pos = k.rank ?? k.position ?? k.current_rank ?? null;
      return {
        client_id,
        keyword_id: kid,
        keyword: String(k.keyword ?? k.name ?? ""),
        search_engine: k.search_engine ?? k.engine ?? null,
        region: k.region ?? k.location ?? null,
        ranking_url: k.ranking_url ?? k.url ?? null,
        position: pos != null ? Number(pos) : null,
        previous_position: prevMap.get(kid) ?? null,
        search_volume: k.search_volume != null ? Number(k.search_volume) : null,
        captured_at: today,
      };
    }).filter((r) => r.keyword_id && r.keyword);

    let written = 0;
    if (upserts.length) {
      const { error: insErr, count } = await admin
        .from("keyword_rankings")
        .upsert(upserts, { onConflict: "client_id,keyword_id,captured_at", count: "exact" });
      if (insErr) throw new Error(`upsert rankings: ${insErr.message}`);
      written = count ?? upserts.length;
    }

    // ---- Share of Voice (best-effort; don't fail entire sync if this 404s) ----
    let sovWritten = 0;
    try {
      const sov = await kwFetch(`/metrics/${projectEnc}/mindshare/latest`, token);
      const items = (sov?.data?.competitors ?? sov?.data ?? sov?.competitors ?? []) as any[];
      const ownDomain = sov?.data?.domain ?? sov?.domain ?? null;
      const sovRows = items.map((c: any) => ({
        client_id,
        domain: String(c.domain ?? c.url ?? ""),
        is_own_domain: ownDomain ? String(c.domain ?? c.url) === String(ownDomain) : Boolean(c.is_own_domain),
        sov_score: Number(c.sov ?? c.share ?? c.score ?? 0),
        captured_at: today,
      })).filter((r) => r.domain);
      if (sovRows.length) {
        const { error: sErr, count: sCount } = await admin
          .from("keyword_share_of_voice")
          .upsert(sovRows, { onConflict: "client_id,domain,captured_at", count: "exact" });
        if (!sErr) sovWritten = sCount ?? sovRows.length;
      }
    } catch (_e) { /* SoV optional */ }

    await admin.from("client_data_sources")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);

    return new Response(JSON.stringify({ ok: true, written, sov_written: sovWritten, keywords: keywords.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
