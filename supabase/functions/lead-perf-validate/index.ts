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

function messagesFromPayload(j: Json): { messages: Json[]; nextPage: boolean | null; lastMessageId: string | null } {
  const inner = j.messages as Json | Json[] | undefined;
  const messages: Json[] = Array.isArray(inner) ? inner as Json[]
    : Array.isArray((inner as Json | undefined)?.messages) ? ((inner as Json).messages as Json[])
    : [];
  const source = (Array.isArray(inner) ? j : (inner ?? j)) as Json;
  const nextRaw = source.nextPage ?? source.next_page ?? source.hasMore ?? source.has_more ?? null;
  const nextPage = nextRaw == null ? null : nextRaw === true || nextRaw === 1 || String(nextRaw).toLowerCase() === "true";
  const lastMessageId = String(source.lastMessageId ?? source.last_message_id ?? messages[messages.length - 1]?.id ?? "") || null;
  return { messages, nextPage, lastMessageId };
}

function msgDuration(m: Json): number {
  const raw = ((m.meta as Json | undefined)?.call as Json | undefined)?.duration
    ?? (m.raw as Json | undefined)?.duration
    ?? (m.raw as Json | undefined)?.callDuration
    ?? m.duration
    ?? m.callDuration;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function msgStatus(m: Json): string {
  return String(((m.meta as Json | undefined)?.call as Json | undefined)?.status
    ?? (m.raw as Json | undefined)?.status
    ?? m.status
    ?? m.callStatus
    ?? "").toLowerCase();
}

function isCall(m: Json): boolean { return String((m.message_type ?? m.messageType) ?? "").toUpperCase() === "TYPE_CALL"; }
function isInbound(m: Json): boolean { return String(m.direction ?? "").toLowerCase() === "inbound"; }
function isAnsweredInboundCall(m: Json): boolean {
  return isCall(m) && isInbound(m) && ["completed", "answered", "in-progress"].includes(msgStatus(m)) && msgDuration(m) >= 30;
}

async function fetchConversationMessages(token: string, conversationId: string) {
  const MAX_PAGES = 25;
  const messages: Json[] = [];
  const seen = new Set<string>();
  let lastMessageId: string | null = null;
  let pages = 0;
  let capped = false;
  while (pages < MAX_PAGES) {
    const qs = new URLSearchParams({ limit: "100" });
    if (lastMessageId) qs.set("lastMessageId", lastMessageId);
    const page = messagesFromPayload(await ghl("GET", `/conversations/${conversationId}/messages?${qs.toString()}`, token));
    pages++;
    let added = 0;
    for (const m of page.messages) {
      const id = String((m as Json).id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id); added++; messages.push(m);
    }
    lastMessageId = page.lastMessageId;
    if (!page.messages.length || added === 0 || page.nextPage === false || (page.nextPage == null && page.messages.length < 100) || !lastMessageId) break;
  }
  if (pages >= MAX_PAGES) capped = true;
  return { messages, pages, capped };
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

  // ---- Pagination completeness checks --------------------------------
  const completeness: Json = { warnings: [] as string[] };
  const { data: exact100 } = await admin.from("ghl_messages")
    .select("conversation_id, contact_id")
    .eq("property_id", property_id)
    .not("conversation_id", "is", null)
    .limit(1000);
  const localConvCounts = new Map<string, { contact_id: string | null; n: number }>();
  for (const m of exact100 ?? []) {
    const id = String((m as Json).conversation_id ?? "");
    if (!id) continue;
    const prev = localConvCounts.get(id) ?? { contact_id: ((m as Json).contact_id as string | null) ?? null, n: 0 };
    prev.n += 1;
    localConvCounts.set(id, prev);
  }
  const suspicious100 = Array.from(localConvCounts.entries()).filter(([, v]) => v.n === 100).map(([conversation_id, v]) => ({ conversation_id, contact_id: v.contact_id, local_message_count: v.n }));
  completeness.conversations_with_exactly_100_messages = suspicious100;
  if (suspicious100.length) (completeness.warnings as string[]).push("Conversations with exactly 100 local messages need live pagination proof.");

  const { data: needsRows } = await admin.from("ghl_lead_facts")
    .select("contact_id, lead_created_at, stage_id, needs_first_response_reason")
    .eq("property_id", property_id)
    .eq("needs_first_response", true)
    .limit(25);
  const needContactIds = new Set((needsRows ?? []).map((r) => String((r as Json).contact_id ?? "")).filter(Boolean));
  const liveConvByContact = new Map<string, Json[]>();
  let convSkip = 0;
  let convPages = 0;
  let conversationSearchCapped = false;
  while (needContactIds.size && convPages < 100) {
    const j = await ghl("GET", `/conversations/search?locationId=${locationId}&limit=100&skip=${convSkip}`, token);
    const list = ((j.conversations as Json[]) ?? []);
    for (const c of list) {
      const cid = String((c as Json).contactId ?? "");
      if (!needContactIds.has(cid)) continue;
      liveConvByContact.set(cid, [...(liveConvByContact.get(cid) ?? []), c]);
    }
    convPages++;
    if (list.length < 100) break;
    convSkip += list.length;
  }
  if (convPages >= 100) conversationSearchCapped = true;

  const localVsLive: Json[] = [];
  const nfrWithLiveAnsweredCalls: Json[] = [];
  for (const row of needsRows ?? []) {
    const cid = String((row as Json).contact_id ?? "");
    let conversations = liveConvByContact.get(cid) ?? [];
    if (!conversations.length) {
      try {
        const targeted = await ghl("GET", `/conversations/search?locationId=${locationId}&contactId=${encodeURIComponent(cid)}&limit=100`, token);
        conversations = ((targeted.conversations as Json[]) ?? []).filter((c) => String((c as Json).contactId ?? "") === cid);
        if (conversations.length) liveConvByContact.set(cid, conversations);
      } catch (_e) { /* keep validation read-only and best-effort */ }
    }
    const liveMessages: Json[] = [];
    let capped = false;
    for (const c of conversations) {
      const fetched = await fetchConversationMessages(token, String((c as Json).id));
      capped = capped || fetched.capped;
      liveMessages.push(...fetched.messages.map((m) => ({ ...(m as Json), conversation_id: (c as Json).id, contact_id: cid })));
    }
    const { count: localN } = await admin.from("ghl_messages").select("*", { count: "exact", head: true }).eq("property_id", property_id).eq("contact_id", cid);
    if ((localN ?? 0) !== liveMessages.length) localVsLive.push({ contact_id: cid, local_message_count: localN ?? 0, live_message_count: liveMessages.length, live_conversation_count: conversations.length, pagination_capped: capped });
    const leadCreated = new Date(String((row as Json).lead_created_at ?? 0)).getTime();
    const answered = liveMessages.filter((m) => isAnsweredInboundCall(m) && new Date(String((m as Json).dateAdded ?? "")).getTime() >= leadCreated);
    if (answered.length) nfrWithLiveAnsweredCalls.push({ contact_id: cid, lead_created_at: (row as Json).lead_created_at, current_reason: (row as Json).needs_first_response_reason, answered_inbound_calls: answered.map((m) => ({ id: (m as Json).id, conversation_id: (m as Json).conversation_id, dateAdded: (m as Json).dateAdded, duration: msgDuration(m), status: msgStatus(m) })) });
  }

  const liveHandledOpps: Json[] = [];
  const liveOppsForNeeds: Json[] = [];
  let oppPage = 1;
  let oppPaginationCapped = false;
  while (needContactIds.size && oppPage <= 100) {
    const j = await ghl("POST", "/opportunities/search", token, { locationId, limit: 100, page: oppPage });
    const list = ((j.opportunities as Json[]) ?? []);
    liveOppsForNeeds.push(...list.filter((o) => needContactIds.has(String((o as Json).contactId ?? ""))));
    if (list.length < 100) break;
    oppPage++;
  }
  if (oppPage > 100) oppPaginationCapped = true;
  if (liveOppsForNeeds.length) {
    const liveStageIds = Array.from(new Set(liveOppsForNeeds.map((o) => String((o as Json).pipelineStageId ?? (o as Json).stageId ?? "")).filter(Boolean)));
    const { data: liveMappings } = liveStageIds.length ? await admin.from("property_pipeline_mapping").select("ghl_stage_id, canonical_stage, suppresses_needs_first_response, confirmed_by_user").eq("property_id", property_id).in("ghl_stage_id", liveStageIds) : { data: [] };
    const mapByStage = new Map((liveMappings ?? []).map((m) => [String((m as Json).ghl_stage_id), m as Json]));
    for (const o of liveOppsForNeeds) {
      const stageId = String((o as Json).pipelineStageId ?? (o as Json).stageId ?? "");
      const mapping = mapByStage.get(stageId);
      if (mapping?.suppresses_needs_first_response === true) liveHandledOpps.push({ contact_id: (o as Json).contactId, opportunity_id: (o as Json).id, live_stage_id: stageId, mapping });
    }
  }
  const noLocalButLive = localVsLive.filter((r) => Number((r as Json).local_message_count ?? 0) === 0 && Number((r as Json).live_message_count ?? 0) > 0);
  completeness.local_message_count_differs_from_live = localVsLive;
  completeness.lead_queue_rows_with_no_local_messages_but_live_conversation_exists = noLocalButLive;
  completeness.needs_first_response_with_live_answered_inbound_calls = nfrWithLiveAnsweredCalls;
  completeness.needs_first_response_with_live_handled_opportunities = liveHandledOpps;
  completeness.endpoint_pagination = { conversation_search_capped: conversationSearchCapped, opportunity_pagination_capped: oppPaginationCapped };
  if (conversationSearchCapped) (completeness.warnings as string[]).push("Conversation search pagination hit the validation safety cap.");
  if (oppPaginationCapped) (completeness.warnings as string[]).push("Opportunity pagination hit the validation safety cap.");
  if (localVsLive.length) (completeness.warnings as string[]).push("Some Needs First Response contacts have local/live message-count drift.");
  if (noLocalButLive.length) (completeness.warnings as string[]).push("Some Needs First Response rows have no local messages but live GHL conversations/messages exist.");
  if (nfrWithLiveAnsweredCalls.length) (completeness.warnings as string[]).push("Some Needs First Response contacts have live answered inbound calls.");
  if (liveHandledOpps.length) (completeness.warnings as string[]).push("Some Needs First Response contacts have live handled stages.");
  report.pagination_completeness = completeness;

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
  if ((db.outbound_unknown as number) > 0) {
    drift.push(`outbound messages with response_source=unknown: ${db.outbound_unknown} (review source_raw values)`);
  }
  const unmapped = (mapping ?? []).filter((m) => !(m as Json).confirmed_by_user).length;
  if (unmapped) drift.push(`pipeline mapping: ${unmapped} stages still unconfirmed (suggestions only)`);
  report.drift = drift;

  return new Response(JSON.stringify(report, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});