// Expanded Go High Level sync for the Lead Performance Overview.
// Order: users → pipelines+stages (+ seed mapping suggestions) → contacts
//        → conversations + messages (response_source classified at write)
//        → opportunities (+ stage-diff history) → calendar events / appointments
//        → tasks (opt-in via body.include_tasks, off by default)
//        → rebuild ghl_lead_facts via DB function.
//
// Returns a structured summary suitable for validation against the GHL UI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const MAX_RPS = 8;             // ceiling per probe report
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;  // 2s, 4s, 8s, 16s, 32s

type Json = Record<string, unknown>;

// ---------- Rate limiter (sliding window) ---------------------------
const callTimes: number[] = [];
async function rateLimit() {
  const now = Date.now();
  while (callTimes.length && now - callTimes[0] > 1000) callTimes.shift();
  if (callTimes.length >= MAX_RPS) {
    const wait = 1000 - (now - callTimes[0]) + 5;
    await new Promise((r) => setTimeout(r, wait));
    return rateLimit();
  }
  callTimes.push(Date.now());
}

class GhlError extends Error {
  status: number; path: string; bodyText: string;
  constructor(path: string, status: number, bodyText: string) {
    super(`GHL ${path} ${status}: ${bodyText.slice(0, 300)}`);
    this.status = status; this.path = path; this.bodyText = bodyText;
  }
}

async function ghlFetch(method: string, path: string, token: string, body?: Json): Promise<Json> {
  let attempt = 0;
  while (true) {
    await rateLimit();
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const res = await fetch(GHL_BASE + path, init);
    const text = await res.text();
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : BACKOFF_BASE_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
      continue;
    }
    if (!res.ok) throw new GhlError(path, res.status, text);
    try { return JSON.parse(text) as Json; } catch { return {}; }
  }
}

// ---------- Classification ------------------------------------------
// Returns one of: human | automation | system | unknown.
// AI is bucketed under 'automation' for v1.
function classifyMessage(m: Json): "human" | "automation" | "system" | "unknown" {
  const dir = String(m.direction ?? "").toLowerCase();
  const mt = String(m.messageType ?? "").toUpperCase();
  const src = String(m.source ?? "").toLowerCase();
  const uid = m.userId ?? null;

  // Activity rows (created/assigned/note system events) are system, not a response.
  if (mt.startsWith("TYPE_ACTIVITY")) return "system";

  // Inbound messages are not a response — leave classification as 'unknown'
  // (aggregations only count outbound rows for KPIs).
  if (dir && dir !== "outbound") return "unknown";

  // Outbound automation surfaces
  if (src === "workflow" || src === "campaign" || src === "bulk_actions") return "automation";

  // userId present + not flagged as automation = a real human action
  if (uid != null && uid !== "") return "human";

  // No userId, no automation source → most likely workflow/system we can't classify yet
  return "unknown";
}

function messageChannel(m: Json): string | null {
  const mt = String(m.messageType ?? "").toUpperCase();
  if (mt.includes("CALL")) return "call";
  if (mt.includes("SMS")) return "sms";
  if (mt.includes("EMAIL")) return "email";
  if (mt.includes("FB") || mt.includes("FACEBOOK")) return "facebook";
  if (mt.includes("IG") || mt.includes("INSTAGRAM")) return "instagram";
  if (mt.includes("GMB")) return "gmb";
  if (mt.includes("WEBCHAT") || mt.includes("LIVE_CHAT")) return "webchat";
  return mt ? mt.toLowerCase().replace(/^type_/, "") : null;
}

// ---------- Appointment status normalization ------------------------
type ApptStatus = "booked" | "confirmed" | "showed" | "no_show" | "cancelled" | "rescheduled" | "unknown";
function canonicalizeApptStatus(rawIn: unknown, endTimeIso: string | null): { status: ApptStatus; derived: boolean } {
  const raw = String(rawIn ?? "").toLowerCase();
  if (raw === "showed" || raw === "attended")           return { status: "showed",      derived: false };
  if (raw === "noshow"  || raw === "no_show" || raw === "no-show") return { status: "no_show", derived: false };
  if (raw === "cancelled" || raw === "canceled")        return { status: "cancelled",   derived: false };
  if (raw === "rescheduled")                            return { status: "rescheduled", derived: false };
  if (raw === "booked" || raw === "new")                return { status: "booked",      derived: false };
  if (raw === "confirmed") {
    // Provisional showed/no_show derivation: confirmed + endTime in the past.
    // status_is_derived = true so the dashboard can badge it as provisional.
    if (endTimeIso) {
      const ended = new Date(endTimeIso).getTime();
      if (Number.isFinite(ended) && ended < Date.now()) return { status: "showed", derived: true };
    }
    return { status: "confirmed", derived: false };
  }
  return { status: "unknown", derived: false };
}

function canonicalizeOppStatus(raw: unknown): "open" | "won" | "lost" | "abandoned" | "unknown" {
  const s = String(raw ?? "").toLowerCase();
  if (s === "open") return "open";
  if (s === "won")  return "won";
  if (s === "lost") return "lost";
  if (s === "abandoned") return "abandoned";
  return "unknown";
}

// ---------- Chunked upsert ------------------------------------------
async function upsertChunked(admin: ReturnType<typeof createClient>, table: string, rows: unknown[], onConflict: string, chunk = 200) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await admin.from(table).upsert(slice as never, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
    n += slice.length;
  }
  return n;
}

// ---------- Main handler --------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { property_id?: string; date_from?: string; date_to?: string; include_tasks?: boolean } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const { property_id } = body;
  if (!property_id) {
    return new Response(JSON.stringify({ error: "property_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: pds, error: pdsErr } = await admin
    .from("property_data_sources")
    .select("config, secret_token")
    .eq("property_id", property_id)
    .eq("source", "ghl")
    .maybeSingle();
  if (pdsErr || !pds) {
    return new Response(JSON.stringify({ error: pdsErr?.message ?? "GHL not configured" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const locationId = (pds.config as Json)?.location_id as string | undefined;
  const token = (pds.secret_token as string | undefined) ?? "";
  if (!locationId || !token) {
    return new Response(JSON.stringify({ error: "Missing GHL location_id or token" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const dateFrom = body.date_from ? new Date(body.date_from) : new Date(Date.now() - 30 * 86400_000);
  const dateTo = body.date_to ? new Date(body.date_to) : new Date();
  const includeTasks = body.include_tasks === true;

  const summary: Json = {
    property_id, location_id: locationId,
    window: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
    include_tasks: includeTasks,
    started_at: new Date().toISOString(),
    counts: {} as Json,
    samples: {} as Json,
    errors: [] as string[],
  };
  const errs = summary.errors as string[];
  const counts = summary.counts as Json;
  const samples = summary.samples as Json;

  async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try { return await fn(); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errs.push(`${label}: ${msg}`);
      console.error("sync-ghl", label, msg);
      return fallback;
    }
  }

  // ===== 1. USERS ===================================================
  await safe("users", async () => {
    const j = await ghlFetch("GET", `/users/?locationId=${locationId}`, token);
    const users = ((j.users as Json[]) ?? []);
    const rows = users.map((u) => ({
      property_id, ghl_user_id: String((u as Json).id),
      name: [(u as Json).firstName, (u as Json).lastName].filter(Boolean).join(" ") || (u as Json).name || null,
      email: (u as Json).email ?? null,
      role: (u as Json).type ?? (u as Json).role ?? null,
      is_active: (u as Json).deleted === true ? false : true,
      raw: u,
    }));
    counts.users = await upsertChunked(admin, "ghl_users", rows, "property_id,ghl_user_id");
    samples.user = users[0] ?? null;
  }, undefined);

  // ===== 2. PIPELINES + STAGES + MAPPING SEED =======================
  await safe("pipelines", async () => {
    const j = await ghlFetch("GET", `/opportunities/pipelines?locationId=${locationId}`, token);
    const pipelines = ((j.pipelines as Json[]) ?? []);

    const pipeRows = pipelines.map((p) => ({
      property_id, ghl_pipeline_id: String((p as Json).id),
      name: (p as Json).name ?? null, raw: p,
    }));
    counts.pipelines = await upsertChunked(admin, "ghl_pipelines", pipeRows, "property_id,ghl_pipeline_id");

    // Need the local pipeline.id for stage FK.
    const { data: pipeIds } = await admin
      .from("ghl_pipelines").select("id, ghl_pipeline_id")
      .eq("property_id", property_id);
    const idMap = new Map((pipeIds ?? []).map((r) => [r.ghl_pipeline_id as string, r.id as string]));

    const stageRows: Json[] = [];
    for (const p of pipelines) {
      const stages = (((p as Json).stages as Json[]) ?? []);
      const pid = idMap.get(String((p as Json).id));
      if (!pid) continue;
      for (const s of stages) {
        stageRows.push({
          property_id, pipeline_id: pid,
          ghl_pipeline_id: String((p as Json).id),
          ghl_stage_id: String((s as Json).id),
          name: (s as Json).name ?? null,
          position: (s as Json).position ?? null,
          raw: s,
        });
      }
    }
    counts.stages = await upsertChunked(admin, "ghl_pipeline_stages", stageRows, "property_id,ghl_stage_id");

    // Seed mapping suggestions (only inserts rows that don't exist yet).
    const { data: seeded } = await admin.rpc("seed_pipeline_mapping_suggestions", { _property_id: property_id });
    counts.mapping_suggestions_added = seeded ?? 0;
  }, undefined);

  // ===== 3. CONTACTS (cursor pagination) ============================
  const contactIds: string[] = [];
  const contactCreatedAt = new Map<string, string>();
  await safe("contacts", async () => {
    let cursor: unknown[] | null = null;
    let pages = 0;
    const buffer: Json[] = [];
    while (pages < 100) {
      const reqBody: Json = { locationId, pageLimit: 100 };
      if (cursor) reqBody.searchAfter = cursor;
      const j = await ghlFetch("POST", "/contacts/search", token, reqBody);
      const list = ((j.contacts as Json[]) ?? []);
      if (!list.length) break;
      buffer.push(...list);
      const last = list[list.length - 1] as Json;
      const sa = Array.isArray(last.searchAfter) ? last.searchAfter : null;
      if (!sa || list.length < 100) break;
      cursor = sa;
      pages++;
    }

    const inRange = buffer.filter((c) => {
      const d = (c.dateAdded ?? c.createdAt) as string | undefined;
      if (!d) return true;
      const t = new Date(d).getTime();
      return t >= dateFrom.getTime() && t <= dateTo.getTime();
    });

    const rows = inRange.map((c) => {
      const a = c as Json;
      const id = String(a.id);
      const createdAt = (a.dateAdded ?? a.createdAt) as string | null;
      if (createdAt) contactCreatedAt.set(id, createdAt);
      contactIds.push(id);
      return {
        property_id, ghl_location_id: locationId, ghl_contact_id: id,
        first_name: a.firstName ?? null,
        last_name: a.lastName ?? null,
        email: a.email ?? null,
        phone: a.phone ?? null,
        source: a.source ?? null,
        assigned_to: a.assignedTo ?? null,
        assigned_user_id: a.assignedTo ?? null,
        tags: Array.isArray(a.tags) ? a.tags : null,
        ghl_created_at: createdAt,
        raw: c,
      };
    });
    counts.contacts_total_pulled = buffer.length;
    counts.contacts_in_window = await upsertChunked(admin, "ghl_contacts", rows, "property_id,ghl_contact_id");
    samples.contact = inRange[0] ?? null;
  }, undefined);

  // ===== 4. CONVERSATIONS + MESSAGES (classified) ===================
  await safe("conversations_messages", async () => {
    // Pull conversations for the location, then walk each one for in-window contacts.
    const j = await ghlFetch("GET", `/conversations/search?locationId=${locationId}&limit=100`, token);
    const convs = ((j.conversations as Json[]) ?? []);
    counts.conversations = convs.length;

    const contactSet = new Set(contactIds);
    const msgRows: Json[] = [];
    let firstHumanSample: Json | null = null;
    let firstAutoSample: Json | null = null;
    const classCounts: Record<string, number> = { human: 0, automation: 0, system: 0, unknown: 0 };

    for (const c of convs) {
      const cAny = c as Json;
      const contactId = String(cAny.contactId ?? "");
      if (contactId && !contactSet.has(contactId)) continue;
      const mj = await ghlFetch("GET", `/conversations/${cAny.id}/messages?limit=100`, token);
      const inner = mj.messages as Json | undefined;
      const messages: Json[] = Array.isArray(inner) ? inner as Json[]
        : Array.isArray((inner as Json | undefined)?.messages) ? ((inner as Json).messages as Json[])
        : [];
      for (const m of messages) {
        const mA = m as Json;
        const cls = classifyMessage(mA);
        classCounts[cls] = (classCounts[cls] ?? 0) + 1;
        if (cls === "human" && !firstHumanSample) firstHumanSample = mA;
        if (cls === "automation" && !firstAutoSample) firstAutoSample = mA;
        msgRows.push({
          property_id,
          ghl_message_id: String(mA.id),
          conversation_id: String(cAny.id),
          contact_id: contactId || null,
          direction: mA.direction ?? null,
          channel: messageChannel(mA),
          message_type: mA.messageType ?? null,
          ghl_user_id: mA.userId ?? null,
          response_source: cls,
          source_raw: mA.source ?? null,
          sent_at: mA.dateAdded ?? null,
          body_preview: typeof mA.body === "string" ? (mA.body as string).slice(0, 280) : null,
          meta: mA.meta ?? null,
          raw: m,
        });
      }
    }
    counts.messages = await upsertChunked(admin, "ghl_messages", msgRows, "property_id,ghl_message_id");
    counts.messages_by_source = classCounts;
    samples.message_human = firstHumanSample;
    samples.message_automation = firstAutoSample;
  }, undefined);

  // ===== 5. OPPORTUNITIES (+ stage-diff history) ====================
  await safe("opportunities", async () => {
    let page = 1;
    const pulled: Json[] = [];
    while (page <= 50) {
      const j = await ghlFetch("POST", "/opportunities/search", token, { locationId, limit: 100, page });
      const list = ((j.opportunities as Json[]) ?? []);
      pulled.push(...list);
      if (list.length < 100) break;
      page++;
    }
    counts.opportunities_pulled = pulled.length;

    // Existing rows for stage-diff
    const { data: existing } = await admin
      .from("ghl_opportunities")
      .select("id, ghl_opportunity_id, stage_id")
      .eq("property_id", property_id);
    const existingMap = new Map((existing ?? []).map((r) => [r.ghl_opportunity_id, { id: r.id as string, stage_id: r.stage_id as string | null }]));

    const rows = pulled.map((o) => {
      const a = o as Json;
      return {
        property_id,
        ghl_opportunity_id: String(a.id),
        contact_id: a.contactId ?? null,
        pipeline_id: a.pipelineId ?? null,
        stage_id: a.pipelineStageId ?? a.stageId ?? null,
        status: canonicalizeOppStatus(a.status),
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
    counts.opportunities = await upsertChunked(admin, "ghl_opportunities", rows, "property_id,ghl_opportunity_id");

    // Stage-diff history (only when current stage differs from prior).
    const historyRows: Json[] = [];
    // Re-read to get local ids for newly-inserted rows.
    const { data: localOpps } = await admin
      .from("ghl_opportunities")
      .select("id, ghl_opportunity_id, stage_id, ghl_updated_at")
      .eq("property_id", property_id);
    const localMap = new Map((localOpps ?? []).map((r) => [r.ghl_opportunity_id, r]));
    for (const o of pulled) {
      const a = o as Json;
      const newStage = (a.pipelineStageId ?? a.stageId ?? null) as string | null;
      const prior = existingMap.get(String(a.id));
      if (!prior || prior.stage_id === newStage) continue;
      const local = localMap.get(String(a.id));
      if (!local) continue;
      historyRows.push({
        property_id, opportunity_id: local.id,
        from_stage_id: prior.stage_id, to_stage_id: newStage,
        changed_at: a.updatedAt ?? a.lastStageChangeAt ?? new Date().toISOString(),
        source: "sync_diff",
      });
    }
    if (historyRows.length) {
      const { error } = await admin.from("ghl_opportunity_stage_history").insert(historyRows as never);
      if (error) throw new Error(error.message);
    }
    counts.stage_history_appended = historyRows.length;
    samples.opportunity = pulled[0] ?? null;
  }, undefined);

  // ===== 6. CALENDARS + APPOINTMENTS ================================
  await safe("appointments", async () => {
    const cj = await ghlFetch("GET", `/calendars/?locationId=${locationId}`, token);
    const cals = ((cj.calendars as Json[]) ?? []);
    counts.calendars = cals.length;

    // Walk in 7-day windows per probe report.
    const apptRows: Json[] = [];
    const statusDist: Record<string, number> = {};
    const startMs = dateFrom.getTime();
    const endMs = dateTo.getTime();
    const SEVEN = 7 * 86400_000;

    for (const c of cals) {
      const calId = String((c as Json).id);
      for (let s = startMs; s < endMs; s += SEVEN) {
        const e = Math.min(s + SEVEN, endMs);
        const j = await ghlFetch(
          "GET",
          `/calendars/events?locationId=${locationId}&calendarId=${calId}&startTime=${s}&endTime=${e}`,
          token,
        );
        const events = ((j.events as Json[]) ?? []);
        for (const ev of events) {
          const a = ev as Json;
          const rawStatus = a.appointmentStatus;
          const endIso = (a.endTime as string | null) ?? null;
          const { status, derived } = canonicalizeApptStatus(rawStatus, endIso);
          statusDist[String(rawStatus ?? "null")] = (statusDist[String(rawStatus ?? "null")] ?? 0) + 1;
          apptRows.push({
            property_id, ghl_event_id: String(a.id),
            calendar_id: calId,
            contact_id: a.contactId ?? null,
            opportunity_id: a.opportunityId ?? null,
            assigned_user_id: a.assignedUserId ?? a.userId ?? null,
            starts_at: a.startTime ?? null,
            ends_at: a.endTime ?? null,
            appointment_status: status,
            appointment_status_raw: rawStatus ?? null,
            status_is_derived: derived,
            raw: ev,
          });
        }
      }
    }
    // Dedupe — same event can be returned across overlapping windows/calendars.
    const seen = new Set<string>();
    const deduped = apptRows.filter((r) => {
      const k = `${(r as Json).property_id}:${(r as Json).ghl_event_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    counts.appointments = await upsertChunked(admin, "ghl_appointments", deduped, "property_id,ghl_event_id");
    counts.appointment_status_distribution = statusDist;
    samples.appointment = apptRows[0] ?? null;
  }, undefined);

  // ===== 7. TASKS (opt-in) ==========================================
  if (includeTasks) {
    await safe("tasks", async () => {
      const taskRows: Json[] = [];
      // Cap to in-window contacts.
      for (const cid of contactIds.slice(0, 500)) {
        const j = await ghlFetch("GET", `/contacts/${cid}/tasks`, token).catch(() => ({} as Json));
        const list = ((j.tasks as Json[]) ?? []);
        for (const t of list) {
          const a = t as Json;
          const status = String(a.status ?? "").toLowerCase();
          const isCompleted = a.completed === true || status === "completed";
          const title = String(a.title ?? "").toLowerCase();
          const taskType = String(a.taskType ?? "").toLowerCase();
          const looksLikeAttempt = /(call|text|sms|email|follow.?up|reach.?out|contact)/.test(title + " " + taskType);
          taskRows.push({
            property_id, ghl_task_id: String(a.id),
            contact_id: cid,
            assigned_user_id: a.assignedTo ?? null,
            status: a.status ?? null,
            task_type: a.taskType ?? null,
            title: a.title ?? null,
            due_at: a.dueDate ?? null,
            completed_at: isCompleted ? (a.completedAt ?? a.dateUpdated ?? null) : null,
            counts_as_attempt: isCompleted && looksLikeAttempt,
            raw: t,
          });
        }
      }
      counts.tasks = await upsertChunked(admin, "ghl_tasks", taskRows, "property_id,ghl_task_id");
    }, undefined);
  }

  // ===== 8. REBUILD LEAD FACTS ======================================
  await safe("rebuild_lead_facts", async () => {
    const { data, error } = await admin.rpc("rebuild_lead_facts", { _property_id: property_id });
    if (error) throw new Error(error.message);
    counts.lead_facts = (data as Json | null)?.facts_written ?? 0;
  }, undefined);

  // ===== Bookkeeping ================================================
  summary.finished_at = new Date().toISOString();
  await admin
    .from("property_data_sources")
    .update({ last_synced_at: summary.finished_at, last_error: errs.length ? errs.join(" | ").slice(0, 1000) : null, status: errs.length ? "error" : "connected" })
    .eq("property_id", property_id).eq("source", "ghl");
  await admin.from("sync_runs").insert({
    property_id, source: "ghl",
    status: errs.length ? "failure" : "success",
    error_message: errs.length ? errs.join(" | ").slice(0, 1000) : null,
  });

  return new Response(JSON.stringify(summary, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});