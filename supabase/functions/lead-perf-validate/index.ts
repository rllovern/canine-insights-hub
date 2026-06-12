// Side-by-side validation report: compares Lead Performance DB rows to live
// counts pulled from the GHL UI's underlying API. Read-only, internal-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
type Json = Record<string, unknown>;

async function ghl(method: string, path: string, token: string, body?: Json): Promise<Json> {
  const res = await fetch(GHL_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GHL ${path} ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text) as Json; } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userRes } = await userClient.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isInternal } = await admin.rpc("has_role", { _user_id: user.id, _role: "internal" });
  if (!isInternal) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({}));
  const property_id = body.property_id as string | undefined;
  const from = body.date_from ? new Date(body.date_from) : new Date(Date.now() - 30 * 86400_000);
  const to = body.date_to ? new Date(body.date_to) : new Date();
  if (!property_id) return new Response(JSON.stringify({ error: "property_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: pds } = await admin.from("property_data_sources")
    .select("config, secret_token").eq("property_id", property_id).eq("source", "ghl").maybeSingle();
  const locationId = (pds?.config as Json | undefined)?.location_id as string | undefined;
  const token = (pds?.secret_token as string | undefined) ?? "";
  if (!locationId || !token) return new Response(JSON.stringify({ error: "GHL not configured for property" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const report: Json = { property_id, location_id: locationId, window: { from: from.toISOString(), to: to.toISOString() } };

  // ---- Live counts ----
  const live: Json = {};
  try {
    const j = await ghl("POST", "/contacts/search", token, { locationId, pageLimit: 1 });
    live.contacts_total = (j.total as number) ?? null;
  } catch (e) { live.contacts_error = (e as Error).message; }
  try {
    const j = await ghl("POST", "/opportunities/search", token, { locationId, limit: 1, page: 1 });
    live.opportunities_total = (j.total as number) ?? null;
  } catch (e) { live.opportunities_error = (e as Error).message; }
  try {
    const j = await ghl("GET", `/users/?locationId=${locationId}`, token);
    live.users_total = ((j.users as Json[]) ?? []).length;
  } catch (e) { live.users_error = (e as Error).message; }
  try {
    const j = await ghl("GET", `/opportunities/pipelines?locationId=${locationId}`, token);
    const pipes = ((j.pipelines as Json[]) ?? []);
    live.pipelines_total = pipes.length;
    live.stages_total = pipes.reduce((n, p) => n + (Array.isArray((p as Json).stages) ? ((p as Json).stages as Json[]).length : 0), 0);
  } catch (e) { live.pipelines_error = (e as Error).message; }
  report.live = live;

  // ---- DB counts ----
  async function count(table: string, qb?: (q: ReturnType<typeof admin.from>) => unknown): Promise<number | null> {
    const q = admin.from(table).select("*", { count: "exact", head: true }).eq("property_id", property_id);
    const final = qb ? (qb(q) as typeof q) : q;
    const { count: n, error } = await final;
    return error ? null : (n ?? 0);
  }

  const db: Json = {
    users: await count("ghl_users"),
    pipelines: await count("ghl_pipelines"),
    stages: await count("ghl_pipeline_stages"),
    contacts: await count("ghl_contacts"),
    contacts_in_window: await count("ghl_contacts", (q) => (q as ReturnType<typeof admin.from>).gte("ghl_created_at", from.toISOString()).lte("ghl_created_at", to.toISOString())),
    messages: await count("ghl_messages", (q) => (q as ReturnType<typeof admin.from>).gte("sent_at", from.toISOString()).lte("sent_at", to.toISOString())),
    opportunities: await count("ghl_opportunities"),
    appointments: await count("ghl_appointments", (q) => (q as ReturnType<typeof admin.from>).gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString())),
    lead_facts: await count("ghl_lead_facts", (q) => (q as ReturnType<typeof admin.from>).gte("lead_created_at", from.toISOString()).lte("lead_created_at", to.toISOString())),
  };

  // Message classification breakdown
  const sources: Json = {};
  for (const s of ["human", "automation", "system", "customer", "unknown"]) {
    sources[s] = await count("ghl_messages", (q) => (q as ReturnType<typeof admin.from>).eq("response_source", s).gte("sent_at", from.toISOString()).lte("sent_at", to.toISOString()));
  }
  db.messages_by_source = sources;
  // Outbound-only unknown (the actionable drift signal)
  db.outbound_unknown = await count("ghl_messages", (q) => (q as ReturnType<typeof admin.from>)
    .eq("response_source", "unknown").eq("direction", "outbound")
    .gte("sent_at", from.toISOString()).lte("sent_at", to.toISOString()));

  // Stage-diff history rows written by sync
  db.stage_history_rows = await count("ghl_opportunity_stage_history");

  // Appointment status distribution
  const apptStatus: Json = {};
  for (const s of ["booked", "confirmed", "showed", "no_show", "cancelled", "rescheduled", "unknown"]) {
    apptStatus[s] = await count("ghl_appointments", (q) => (q as ReturnType<typeof admin.from>).eq("appointment_status", s).gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString()));
  }
  db.appointments_by_status = apptStatus;

  // Derived (provisional) appointment statuses
  db.appointments_status_is_derived = await count("ghl_appointments", (q) => (q as ReturnType<typeof admin.from>).eq("status_is_derived", true));

  // Lead facts coverage
  const { data: factsAgg } = await admin.from("ghl_lead_facts").select(
    "first_human_response_at, first_automation_response_at, opportunity_id, assigned_user_id, human_speed_to_lead_seconds_raw",
  ).eq("property_id", property_id);
  if (factsAgg) {
    const total = factsAgg.length;
    const responded = factsAgg.filter((r) => r.first_human_response_at).length;
    const speeds = factsAgg.map((r) => r.human_speed_to_lead_seconds_raw).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
    const median = speeds.length ? speeds[Math.floor(speeds.length / 2)] : null;
    db.lead_facts_summary = {
      total,
      with_human_response: responded,
      pct_responded: total ? Math.round((100 * responded) / total) : 0,
      with_opportunity: factsAgg.filter((r) => r.opportunity_id).length,
      assigned: factsAgg.filter((r) => r.assigned_user_id).length,
      median_human_speed_seconds: median,
    };
  }
  report.db = db;

  // ---- Sample rows for visual sanity-check ----
  const samples: Json = {};
  const { data: humanMsg } = await admin.from("ghl_messages").select("ghl_message_id, contact_id, direction, channel, message_type, ghl_user_id, source_raw, response_source, sent_at, body_preview").eq("property_id", property_id).eq("response_source", "human").order("sent_at", { ascending: false }).limit(3);
  const { data: autoMsg } = await admin.from("ghl_messages").select("ghl_message_id, contact_id, direction, channel, message_type, ghl_user_id, source_raw, response_source, sent_at, body_preview").eq("property_id", property_id).eq("response_source", "automation").order("sent_at", { ascending: false }).limit(3);
  const { data: unknownMsg } = await admin.from("ghl_messages").select("ghl_message_id, contact_id, direction, channel, message_type, ghl_user_id, source_raw, response_source, sent_at").eq("property_id", property_id).eq("response_source", "unknown").order("sent_at", { ascending: false }).limit(3);
  const { data: facts } = await admin.from("ghl_lead_facts").select("contact_id, opportunity_id, assigned_user_id, canonical_stage, lead_created_at, first_human_response_at, human_speed_to_lead_seconds_raw, human_attempt_count, automation_touch_count, is_open").eq("property_id", property_id).order("lead_created_at", { ascending: false }).limit(5);
  const { data: opps } = await admin.from("ghl_opportunities").select("ghl_opportunity_id, contact_id, status, status_raw, stage_id, ghl_created_at, won_at, lost_at").eq("property_id", property_id).order("ghl_created_at", { ascending: false }).limit(3);
  const { data: stages } = await admin.from("ghl_pipeline_stages").select("ghl_pipeline_id, ghl_stage_id, name, position").eq("property_id", property_id).order("position", { ascending: true });
  const { data: mapping } = await admin.from("property_pipeline_mapping").select("ghl_stage_id, canonical_stage, suggested_canonical_stage, confirmed_by_user").eq("property_id", property_id);

  samples.messages_human = humanMsg ?? [];
  samples.messages_automation = autoMsg ?? [];
  samples.messages_unknown = unknownMsg ?? [];
  samples.lead_facts = facts ?? [];
  samples.opportunities = opps ?? [];
  samples.pipeline_stages = stages ?? [];
  samples.pipeline_mapping = mapping ?? [];
  report.samples = samples;

  // ---- Drift call-outs ----
  const drift: string[] = [];
  if (typeof live.contacts_total === "number" && typeof db.contacts === "number" && live.contacts_total !== db.contacts) {
    drift.push(`contacts: live ${live.contacts_total} vs db ${db.contacts}`);
  }
  if (typeof live.opportunities_total === "number" && typeof db.opportunities === "number" && live.opportunities_total !== db.opportunities) {
    drift.push(`opportunities: live ${live.opportunities_total} vs db ${db.opportunities}`);
  }
  if (typeof live.users_total === "number" && typeof db.users === "number" && live.users_total !== db.users) {
    drift.push(`users: live ${live.users_total} vs db ${db.users}`);
  }
  if (typeof live.stages_total === "number" && typeof db.stages === "number" && live.stages_total !== db.stages) {
    drift.push(`stages: live ${live.stages_total} vs db ${db.stages}`);
  }
  if ((db.messages_by_source as Json)?.unknown && (db.messages_by_source as Json).unknown as number > 0) {
    drift.push(`messages with response_source=unknown: ${(db.messages_by_source as Json).unknown} (review source_raw values)`);
  }
  const unmapped = (mapping ?? []).filter((m) => !(m as Json).confirmed_by_user).length;
  if (unmapped) drift.push(`pipeline mapping: ${unmapped} stages still unconfirmed (suggestions only)`);
  report.drift = drift;

  return new Response(JSON.stringify(report, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});