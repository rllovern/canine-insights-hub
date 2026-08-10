// Read-only mirror-integrity audit: walk the COMPLETE opportunity set for a
// property from GHL and compare it against what we have stored. Reports the
// stored IDs that GHL no longer returns ("drift"), split by stored status.
// Never writes to the opportunity tables.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
type Json = Record<string, unknown>;

async function ghlFetch(path: string, token: string): Promise<Json> {
  const res = await fetch(GHL_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GHL ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text) as Json; } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userRes } = await admin.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: isInternal } = await admin.rpc("is_all_properties_reader", { _user_id: user.id });
  if (!isInternal) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const propertyId = body.property_id as string | undefined;
  if (!propertyId) return json({ error: "property_id required" }, 400);
  const deadline = Date.now() + 110_000;

  const { data: pds } = await admin.from("property_data_sources")
    .select("config, secret_token").eq("property_id", propertyId).eq("source", "ghl").maybeSingle();
  const locationId = (pds?.config as Json)?.location_id as string | undefined;
  const token = (pds?.secret_token as string | undefined) ?? "";
  if (!locationId || !token) return json({ error: "GHL not connected for this property" }, 400);

  // ---- complete cursor walk ------------------------------------------------
  const live = new Map<string, string>(); // id -> status
  let startAfter: string | null = null, startAfterId: string | null = null;
  let pages = 0, reportedTotal: number | null = null, exhausted = false, dupes = 0;
  while (Date.now() < deadline) {
    const qs = new URLSearchParams({ location_id: locationId, limit: "100", order: "added_asc" });
    if (startAfter && startAfterId) { qs.set("startAfter", startAfter); qs.set("startAfterId", startAfterId); }
    const j = await ghlFetch(`/opportunities/search?${qs.toString()}`, token);
    const list = (j.opportunities as Json[]) ?? [];
    const meta = (j.meta ?? {}) as Json;
    if (reportedTotal == null && meta.total != null) reportedTotal = Number(meta.total);
    for (const o of list) {
      const id = String(o.id);
      if (live.has(id)) dupes++;
      live.set(id, String(o.status ?? "unknown"));
    }
    pages++;
    if (!list.length || meta.startAfter == null || list.length < 100) { exhausted = true; break; }
    startAfter = String(meta.startAfter);
    startAfterId = String(meta.startAfterId ?? "");
  }

  // ---- stored set ----------------------------------------------------------
  const stored: { ghl_opportunity_id: string; status: string; monetary_value: number | null; contact_id: string | null; won_at: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("ghl_opportunities")
      .select("ghl_opportunity_id, status, monetary_value, contact_id, won_at")
      .eq("property_id", propertyId).range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    stored.push(...(data ?? []) as never);
    if (!data || data.length < 1000) break;
  }

  const missing = stored.filter((s) => !live.has(s.ghl_opportunity_id));
  const byStatus: Record<string, { count: number; revenue: number }> = {};
  for (const m of missing) {
    const k = m.status ?? "unknown";
    byStatus[k] ??= { count: 0, revenue: 0 };
    byStatus[k].count++;
    byStatus[k].revenue += Number(m.monetary_value ?? 0);
  }
  const storedIds = new Set(stored.map((s) => s.ghl_opportunity_id));
  const notStored = [...live.keys()].filter((id) => !storedIds.has(id));

  return json({
    property_id: propertyId,
    walk: { complete: exhausted, pages, duplicates_in_walk: dupes, live_unique: live.size, ghl_reported_total: reportedTotal },
    stored_count: stored.length,
    drift: {
      stored_but_not_in_ghl: missing.length,
      by_status: byStatus,
      won_examples: missing.filter((m) => m.status === "won")
        .map((m) => ({ id: m.ghl_opportunity_id, value: m.monetary_value, won_at: m.won_at, contact_id: m.contact_id })).slice(0, 25),
      in_ghl_but_not_stored: notStored.length,
      in_ghl_but_not_stored_examples: notStored.slice(0, 10),
    },
  });
});
