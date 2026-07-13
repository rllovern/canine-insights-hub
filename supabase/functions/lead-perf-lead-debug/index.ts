// Admin-only lead diagnostic + targeted GHL resync for one contact.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const MAX_CONVERSATION_SEARCH_PAGES = 100;
const MAX_MESSAGE_PAGES_PER_CONVERSATION = 25;
const MAX_OPPORTUNITY_PAGES = 100;
type Json = Record<string, unknown>;

async function ghl(method: string, path: string, token: string, body?: Json): Promise<Json> {
  const res = await fetch(GHL_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GHL ${path} ${res.status}: ${text.slice(0, 400)}`);
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

function classifyMessage(m: Json): "human" | "automation" | "system" | "customer" | "unknown" {
  const dir = String(m.direction ?? "").toLowerCase();
  const mt = String(m.messageType ?? "").toUpperCase();
  const src = String(m.source ?? "").toLowerCase();
  const uid = m.userId ?? null;
  if (mt.startsWith("TYPE_ACTIVITY")) return "system";
  if (dir && dir !== "outbound") return "customer";
  if (src === "workflow" || src === "campaign" || src === "bulk_actions") return "automation";
  if (uid != null && uid !== "") return "human";
  return "unknown";
}

function channel(m: Json): string | null {
  const mt = String(m.messageType ?? "").toUpperCase();
  if (mt.includes("CALL")) return "call";
  if (mt.includes("SMS")) return "sms";
  if (mt.includes("EMAIL")) return "email";
  return mt ? mt.toLowerCase().replace(/^type_/, "") : null;
}

function normalizedMeta(m: Json): Json | null {
  const meta = ((m.meta as Json | undefined) ?? {}) as Json;
  const call = ((meta.call as Json | undefined) ?? {}) as Json;
  const duration = call.duration ?? m.duration ?? m.callDuration ?? m.call_duration ?? m.callDurationSeconds ?? m.call_duration_seconds;
  const status = call.status ?? m.status ?? m.callStatus ?? m.call_status;
  const nextCall = { ...call } as Json;
  if (duration != null) nextCall.duration = duration;
  if (status != null) nextCall.status = status;
  return Object.keys(nextCall).length ? { ...meta, call: nextCall } : (Object.keys(meta).length ? meta : null);
}

function duration(m: Json): number {
  const raw = ((m.meta as Json | undefined)?.call as Json | undefined)?.duration
    ?? (m.raw as Json | undefined)?.duration
    ?? (m.raw as Json | undefined)?.callDuration
    ?? (m.raw as Json | undefined)?.call_duration
    ?? m.duration
    ?? m.callDuration
    ?? m.call_duration;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function status(m: Json): string {
  return String(((m.meta as Json | undefined)?.call as Json | undefined)?.status
    ?? (m.raw as Json | undefined)?.status
    ?? m.status
    ?? m.callStatus
    ?? "").toLowerCase();
}

function isTypeCall(m: Json): boolean {
  return String((m.message_type ?? m.messageType) ?? "").toUpperCase() === "TYPE_CALL";
}

function isInbound(m: Json): boolean {
  return String(m.direction ?? "").toLowerCase() === "inbound";
}

function isAnsweredInboundCall(m: Json): boolean {
  return isTypeCall(m) && isInbound(m) && ["completed", "answered", "in-progress"].includes(status(m)) && duration(m) >= 30;
}

function summarizeMessages(messages: Json[]) {
  const calls = messages.filter(isTypeCall);
  const inbound = calls.filter(isInbound);
  const answered = inbound.filter(isAnsweredInboundCall);
  return {
    total_messages: messages.length,
    type_call_count: calls.length,
    inbound_call_count: inbound.length,
    answered_inbound_call_count: answered.length,
    longest_call_duration: calls.reduce((max, m) => Math.max(max, duration(m)), 0),
    latest_call_timestamp: calls.map((m) => String((m.sent_at ?? m.dateAdded) ?? "")).filter(Boolean).sort().at(-1) ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userRes } = await userClient.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: isInternal } = await admin.rpc("is_all_properties_reader", { _user_id: user.id });
  if (!isInternal) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({}));
  const property_id = body.property_id as string | undefined;
  const contact_id = body.contact_id as string | undefined;
  const resync = body.resync !== false;
  if (!property_id || !contact_id) {
    return new Response(JSON.stringify({ error: "property_id and contact_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: pds } = await admin.from("property_data_sources").select("config, secret_token").eq("property_id", property_id).eq("source", "ghl").maybeSingle();
  const locationId = (pds?.config as Json | undefined)?.location_id as string | undefined;
  const token = (pds?.secret_token as string | undefined) ?? "";
  if (!locationId || !token) return new Response(JSON.stringify({ error: "GHL not configured for property" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const report: Json = { property_id, contact_id, location_id: locationId, resync, warnings: [] as string[] };

  const { data: localContact } = await admin.from("ghl_contacts")
    .select("ghl_contact_id, first_name, last_name, phone, email, tags, ghl_created_at, updated_at")
    .eq("property_id", property_id).eq("ghl_contact_id", contact_id).maybeSingle();
  let liveContact: Json | null = null;
  try {
    const d = await ghl("GET", `/contacts/${contact_id}`, token);
    liveContact = ((d.contact as Json | undefined) ?? d) as Json;
  } catch (e) {
    (report.warnings as string[]).push(`live_contact_fetch_failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  report.contact = {
    local: localContact ?? null,
    live: liveContact ? {
      id: liveContact.id,
      firstName: liveContact.firstName,
      lastName: liveContact.lastName,
      phone: liveContact.phone,
      email: liveContact.email,
      tags: liveContact.tags,
      dateAdded: liveContact.dateAdded ?? liveContact.createdAt,
    } : null,
  };

  const { data: beforeFact } = await admin.from("ghl_lead_facts")
    .select("id, contact_id, opportunity_id, lead_created_at, needs_first_response, needs_first_response_reason, stage_id, canonical_stage, handled_by_stage, first_human_answered_inbound_at, first_human_engagement_at, human_call_duration_seconds")
    .eq("property_id", property_id).eq("contact_id", contact_id).maybeSingle();

  const { data: localMessagesRaw } = await admin.from("ghl_messages")
    .select("ghl_message_id, conversation_id, contact_id, direction, message_type, sent_at, meta, raw")
    .eq("property_id", property_id).eq("contact_id", contact_id);
  const localMessages = (localMessagesRaw ?? []) as Json[];

  // Find every live conversation for this contact, then walk all message pages.
  // Prefer contact-scoped search so a one-lead diagnostic does not scan the whole location.
  const conversations: Json[] = [];
  const conversationIds = new Set<string>();
  const addConversations = (items: Json[]) => {
    for (const c of items) {
      const id = String((c as Json).id ?? "");
      if (!id || conversationIds.has(id)) continue;
      conversationIds.add(id);
      conversations.push(c);
    }
  };
  let conversationPages = 0;
  let usedContactScopedConversationSearch = true;
  try {
    const j = await ghl("GET", `/conversations/search?locationId=${locationId}&contactId=${encodeURIComponent(contact_id)}&limit=100`, token);
    const list = ((j.conversations as Json[]) ?? []);
    addConversations(list.filter((c) => String((c as Json).contactId ?? "") === contact_id));
    conversationPages++;
  } catch (_e) {
    usedContactScopedConversationSearch = false;
  }
  const phoneDigits = String((liveContact?.phone ?? localContact?.phone) ?? "").replace(/\D/g, "");
  const email = String((liveContact?.email ?? localContact?.email) ?? "").trim().toLowerCase();
  if (!conversations.length && (phoneDigits || email)) {
    const q = encodeURIComponent(email || phoneDigits);
    try {
      const j = await ghl("GET", `/conversations/search?locationId=${locationId}&query=${q}&limit=100`, token);
      const list = ((j.conversations as Json[]) ?? []).filter((c) => {
        const convContactId = String((c as Json).contactId ?? "");
        const convPhone = String((c as Json).phone ?? (c as Json).contactPhone ?? "").replace(/\D/g, "");
        const convEmail = String((c as Json).email ?? (c as Json).contactEmail ?? "").trim().toLowerCase();
        return convContactId === contact_id || (!!phoneDigits && convPhone.endsWith(phoneDigits.slice(-10))) || (!!email && convEmail === email);
      });
      addConversations(list);
    } catch (_e) { /* fall through to location scan */ }
  }
  if (!conversations.length) {
    usedContactScopedConversationSearch = false;
    let skip = 0;
    conversationPages = 0;
    while (conversationPages < MAX_CONVERSATION_SEARCH_PAGES) {
      const j = await ghl("GET", `/conversations/search?locationId=${locationId}&limit=100&skip=${skip}`, token);
      const list = ((j.conversations as Json[]) ?? []);
      addConversations(list.filter((c) => String((c as Json).contactId ?? "") === contact_id));
      conversationPages++;
      if (list.length < 100) break;
      skip += list.length;
    }
    if (conversationPages >= MAX_CONVERSATION_SEARCH_PAGES) (report.warnings as string[]).push("conversation_search_capped");
  }
  report.conversation_search = { used_contact_scoped_search: usedContactScopedConversationSearch, pages: conversationPages, conversations_found: conversations.length };

  const liveMessages: Json[] = [];
  const liveMessageIds = new Set<string>();
  const cappedConversations: Json[] = [];
  for (const conv of conversations) {
    const conversationId = String((conv as Json).id ?? "");
    let lastMessageId: string | null = null;
    let pages = 0;
    let stopped = false;
    while (pages < MAX_MESSAGE_PAGES_PER_CONVERSATION) {
      const qs = new URLSearchParams({ limit: "100" });
      if (lastMessageId) qs.set("lastMessageId", lastMessageId);
      const j = await ghl("GET", `/conversations/${conversationId}/messages?${qs.toString()}`, token);
      const page = messagesFromPayload(j);
      pages++;
      let newOnPage = 0;
      for (const m of page.messages) {
        const id = String((m as Json).id ?? "");
        if (!id || liveMessageIds.has(id)) continue;
        liveMessageIds.add(id);
        newOnPage++;
        liveMessages.push({ ...(m as Json), conversation_id: conversationId, contact_id });
      }
      lastMessageId = page.lastMessageId;
      if (!page.messages.length || newOnPage === 0 || page.nextPage === false || (page.nextPage == null && page.messages.length < 100)) { stopped = true; break; }
      if (!lastMessageId) break;
    }
    console.log("lead-perf-lead-debug messages", JSON.stringify({ property_id, contact_id, conversation_id: conversationId, messages_fetched: liveMessages.length, pages }));
    if (!stopped && pages >= MAX_MESSAGE_PAGES_PER_CONVERSATION) cappedConversations.push({ conversation_id: conversationId, pages });
  }

  // Live opportunities are verified against the full opportunity list, not a date window.
  const liveOpportunities: Json[] = [];
  let oppPage = 1;
  let opportunityPaginationCapped = false;
  while (oppPage <= MAX_OPPORTUNITY_PAGES) {
    const j = await ghl("POST", "/opportunities/search", token, { locationId, limit: 100, page: oppPage });
    const list = ((j.opportunities as Json[]) ?? []);
    liveOpportunities.push(...list.filter((o) => String((o as Json).contactId ?? "") === contact_id));
    if (list.length < 100) break;
    oppPage++;
  }
  if (oppPage > MAX_OPPORTUNITY_PAGES) opportunityPaginationCapped = true;

  if (resync) {
    if (liveContact) {
      await admin.from("ghl_contacts").upsert({
        property_id,
        ghl_location_id: locationId,
        ghl_contact_id: contact_id,
        first_name: liveContact.firstName ?? null,
        last_name: liveContact.lastName ?? null,
        email: liveContact.email ?? null,
        phone: liveContact.phone ?? null,
        source: liveContact.source ?? null,
        assigned_to: liveContact.assignedTo ?? null,
        assigned_user_id: liveContact.assignedTo ?? null,
        tags: Array.isArray(liveContact.tags) ? liveContact.tags : null,
        ghl_created_at: liveContact.dateAdded ?? liveContact.createdAt ?? null,
        raw: liveContact,
      } as never, { onConflict: "property_id,ghl_contact_id" });
    }

    const messageRows = liveMessages.map((m) => {
      const mA = m as Json;
      return {
        property_id,
        ghl_message_id: String(mA.id),
        conversation_id: String(mA.conversation_id),
        contact_id,
        direction: mA.direction ?? null,
        channel: channel(mA),
        message_type: mA.messageType ?? null,
        ghl_user_id: mA.userId ?? null,
        response_source: classifyMessage(mA),
        source_raw: mA.source ?? null,
        sent_at: mA.dateAdded ?? null,
        body_preview: typeof mA.body === "string" ? (mA.body as string).slice(0, 280) : null,
        meta: normalizedMeta(mA),
        raw: m,
      };
    });
    if (messageRows.length) await admin.from("ghl_messages").upsert(messageRows as never, { onConflict: "property_id,ghl_message_id" });

    const oppRows = liveOpportunities.map((o) => {
      const a = o as Json;
      return {
        property_id,
        ghl_opportunity_id: String(a.id),
        contact_id: a.contactId ?? null,
        pipeline_id: a.pipelineId ?? null,
        stage_id: a.pipelineStageId ?? a.stageId ?? null,
        status: ["open", "won", "lost", "abandoned"].includes(String(a.status ?? "").toLowerCase()) ? String(a.status).toLowerCase() : "unknown",
        status_raw: a.status ?? null,
        monetary_value: a.monetaryValue ?? a.monetary_value ?? null,
        assigned_to: a.assignedTo ?? null,
        lost_reason_raw: a.lostReasonName ?? a.lostReasonId ?? null,
        lost_reason_normalized: a.lostReasonName ?? null,
        won_at: a.status === "won" ? (a.updatedAt ?? a.lastStageChangeAt ?? null) : null,
        lost_at: a.status === "lost" ? (a.updatedAt ?? a.lastStageChangeAt ?? null) : null,
        ghl_created_at: a.createdAt ?? null,
        ghl_updated_at: a.updatedAt ?? null,
        raw: o,
      };
    });
    if (oppRows.length) await admin.from("ghl_opportunities").upsert(oppRows as never, { onConflict: "property_id,ghl_opportunity_id" });
    await admin.rpc("rebuild_lead_facts", { _property_id: property_id });
  }

  const { data: afterFact } = await admin.from("ghl_lead_facts")
    .select("id, contact_id, opportunity_id, lead_created_at, needs_first_response, needs_first_response_reason, stage_id, canonical_stage, handled_by_stage, first_human_answered_inbound_at, first_human_engagement_at, human_call_duration_seconds")
    .eq("property_id", property_id).eq("contact_id", contact_id).maybeSingle();
  const fact = (afterFact ?? beforeFact) as Json | null;

  const { data: dbOpps } = await admin.from("ghl_opportunities").select("ghl_opportunity_id, contact_id, stage_id, status, ghl_created_at, ghl_updated_at").eq("property_id", property_id).eq("contact_id", contact_id);
  const stageIds = Array.from(new Set([...(dbOpps ?? []).map((o) => o.stage_id).filter(Boolean), ...liveOpportunities.map((o) => ((o as Json).pipelineStageId ?? (o as Json).stageId) as string).filter(Boolean)]));
  const { data: stages } = stageIds.length ? await admin.from("ghl_pipeline_stages").select("ghl_stage_id, name").eq("property_id", property_id).in("ghl_stage_id", stageIds) : { data: [] };
  const { data: mappings } = stageIds.length ? await admin.from("property_pipeline_mapping").select("ghl_stage_id, canonical_stage, suppresses_needs_first_response, confirmed_by_user").eq("property_id", property_id).in("ghl_stage_id", stageIds) : { data: [] };

  const localIds = new Set(localMessages.map((m) => String(m.ghl_message_id)));
  const liveIds = new Set(liveMessages.map((m) => String(m.id)));
  const localCallIds = new Set(localMessages.filter(isTypeCall).map((m) => String(m.ghl_message_id)));
  const liveCalls = liveMessages.filter(isTypeCall);
  const liveCallIds = new Set(liveCalls.map((m) => String(m.id)));
  const localHas354 = localMessages.some((m) => isTypeCall(m) && duration(m) === 354);
  const liveHas354 = liveMessages.some((m) => isTypeCall(m) && duration(m) === 354);
  const liveAnsweredAfterLead = liveMessages.filter((m) => {
    const leadCreated = fact?.lead_created_at ? new Date(String(fact.lead_created_at)).getTime() : 0;
    const sent = new Date(String((m as Json).dateAdded ?? "")).getTime();
    return isAnsweredInboundCall(m as Json) && (!leadCreated || sent >= leadCreated);
  });

  const localSummary = { ...summarizeMessages(localMessages), five_min_54_call_exists_locally_before_resync: localHas354 };
  const liveSummary = {
    ...summarizeMessages(liveMessages),
    conversations: conversations.map((c) => ({ id: (c as Json).id, contact_id: (c as Json).contactId })),
    five_min_54_call_exists_live: liveHas354,
  };
  report.contact_lead_fact = fact;
  report.local_db_messages = localSummary;
  report.live_ghl_messages = liveSummary;
  report.opportunity_verification = {
    live_opportunity_exists: liveOpportunities.length > 0,
    db_opportunity_exists: (dbOpps ?? []).length > 0,
    live_opportunities: liveOpportunities.map((o) => ({ id: (o as Json).id, stage_id: (o as Json).pipelineStageId ?? (o as Json).stageId, status: (o as Json).status })),
    db_opportunities: dbOpps ?? [],
    stages: stages ?? [],
    mappings: mappings ?? [],
    opportunity_pages_scanned: oppPage,
    opportunity_pagination_capped: opportunityPaginationCapped,
  };
  report.drift_result = {
    missing_message_ids: Array.from(liveIds).filter((id) => !localIds.has(id)),
    missing_call_ids: Array.from(liveCallIds).filter((id) => !localCallIds.has(id)),
    pagination_truncated: cappedConversations.length > 0 || opportunityPaginationCapped || conversationPages >= MAX_CONVERSATION_SEARCH_PAGES,
    conversation_message_pagination_capped: cappedConversations.length > 0,
    capped_conversations: cappedConversations,
    reason_call_not_linked_to_lead_fact: liveAnsweredAfterLead.length === 0
      ? "No live answered inbound call after lead created timestamp"
      : localMessages.length === 0
        ? "Conversation/messages were missing locally before targeted resync"
        : localHas354 ? "Call existed locally; lead fact needed rebuild or linkage review" : "Answered call was missing from local messages before targeted resync",
  };

  return new Response(JSON.stringify(report, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});