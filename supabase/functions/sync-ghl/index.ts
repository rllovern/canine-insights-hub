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
// Record caps are gone. Each invoke runs its phase until the cursor is
// exhausted or the wall-clock budget is spent, then hands the cursor back.
// The orchestrator loops. The only remaining rails are this budget, the rate
// limiter, and the orchestrator's max-invokes-per-phase.
const DEFAULT_BUDGET_MS = 55_000;   // 90s ceiling minus upsert/response headroom
const MAX_BUDGET_MS = 70_000;
const CONVERSATION_PAGE_SIZE = 50;  // fetch + message-hydrate as one atomic unit
const MAX_TARGETED_CONVERSATION_LOOKUPS = 20; // per-invoke fan-out guard only
const MAX_TAG_REFRESH = 75;         // per-invoke fan-out guard only

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
      const retryAfterRaw = res.headers.get("Retry-After");
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      // Cloudflare 1015 rate limits usually omit Retry-After. Use a longer
      // floor (min 10s, growing to 60s) so we clear the ban window instead of
      // hammering the API and failing the sync.
      const backoff = Math.min(60_000, Math.max(10_000, BACKOFF_BASE_MS * Math.pow(2, attempt + 1)));
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : backoff;
      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
      continue;
    }
    // Transient gateway errors from GHL: 5xx, or 401/408 bodies that say "Command timed out".
    // GHL occasionally returns a 401 envelope for upstream timeouts on /users — retry instead
    // of treating it as an auth failure.
    const transient =
      res.status >= 500 ||
      res.status === 408 ||
      ((res.status === 401 || res.status === 403) && /timed out|timeout/i.test(text)) ||
      // GHL periodically returns 400 { "Error occurred while searching for contact" }
      // from /contacts/search under load — identical payload succeeds seconds later.
      (res.status === 400 && /Error occurred while searching for contact/i.test(text));
    if (transient && attempt < MAX_RETRIES) {
      const waitMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
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
function classifyMessage(m: Json): "human" | "automation" | "system" | "customer" | "unknown" | "ai" {
  const dir = String(m.direction ?? "").toLowerCase();
  const mt = String(m.messageType ?? "").toUpperCase();
  const src = String(m.source ?? "").toLowerCase();
  const uid = m.userId ?? null;

  // Activity rows (created/assigned/note system events) are system, not a response.
  if (mt.startsWith("TYPE_ACTIVITY")) return "system";

  // Inbound messages come from the lead/customer themselves.
  // KPI aggregations only count outbound rows, but classifying these as
  // 'customer' (instead of 'unknown') keeps the drift signal clean.
  if (dir && dir !== "outbound") return "customer";

  // Outbound automation surfaces
  if (src.includes("ai") || mt.includes("ai")) return "ai";
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

function normalizedMessageMeta(m: Json): Json | null {
  const meta = ((m.meta as Json | undefined) ?? {}) as Json;
  const call = ((meta.call as Json | undefined) ?? {}) as Json;
  const duration = call.duration ?? m.duration ?? m.callDuration ?? m.call_duration ?? m.callDurationSeconds ?? m.call_duration_seconds;
  const status = call.status ?? m.status ?? m.callStatus ?? m.call_status;
  const nextCall = { ...call } as Json;
  if (duration != null) nextCall.duration = duration;
  if (status != null) nextCall.status = status;
  return Object.keys(nextCall).length ? { ...meta, call: nextCall } : (Object.keys(meta).length ? meta : null);
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

// Shared row shape for ghl_opportunities, used by both the deep oldest-first
// walk and the recent-first freshness pass.
function mapOppRow(property_id: string, o: Json): Json {
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
    won_at: a.status === "won" ? (a.lastStatusChangeAt ?? a.lastStageChangeAt ?? a.updatedAt ?? null) : null,
    lost_at: a.status === "lost" ? (a.lastStatusChangeAt ?? a.lastStageChangeAt ?? a.updatedAt ?? null) : null,
    ghl_created_at: a.createdAt ?? null,
    ghl_updated_at: a.updatedAt ?? null,
    raw: o,
  };
}

function isWithinWindow(iso: unknown, from: Date, to: Date): boolean {
  if (!iso) return true;
  const time = new Date(String(iso)).getTime();
  if (!Number.isFinite(time)) return true;
  return time >= from.getTime() && time <= to.getTime();
}

// ---------- Chunked upsert ------------------------------------------
// Postgres json/jsonb cannot store the NUL code point (\u0000), and lone
// surrogates are not valid JSON text either. GHL message bodies (DFW) contain
// both, which produced "invalid input syntax for type json" on every run.
function sanitizeJson<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/\u0000/g, "")
      // strip unpaired surrogates
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
      .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1") as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeJson(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[sanitizeJson(k)] = sanitizeJson(v);
    }
    return out as unknown as T;
  }
  return value;
}

async function upsertChunked(admin: ReturnType<typeof createClient>, table: string, rows: unknown[], onConflict: string, chunk = 200) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = sanitizeJson(rows.slice(i, i + chunk));
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

  let body: {
    property_id?: string;
    date_from?: string;
    date_to?: string;
    include_tasks?: boolean;
    phase?: string;
    cursor?: unknown;
    budget_ms?: number;
  } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const { property_id } = body;
  if (!property_id) {
    return new Response(JSON.stringify({ error: "property_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Phase chunking -------------------------------------------------
  // The orchestrator drives one phase per invoke and passes the cursor back
  // in, so a single phase can span many invokes without ever hitting the 90s
  // wall-time limit. `phase: "all"` (the default) preserves the legacy
  // single-invoke behaviour used by the manual sync button.
  const PHASES = [
    "users", "pipelines", "contacts", "opportunities_recent", "conversations",
    "opportunities", "appointments", "tasks", "finalize",
  ] as const;
  type Phase = typeof PHASES[number];
  const phase = String(body.phase ?? "all");
  if (phase !== "all" && !PHASES.includes(phase as Phase)) {
    return new Response(JSON.stringify({ error: `unknown phase: ${phase}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const runs = (p: Phase) => phase === "all" || phase === p;
  // Cursor carried across invokes of the same phase. Shape is phase-specific.
  const cursorIn = (body.cursor ?? null) as Record<string, unknown> | null;
  let cursorOut: Record<string, unknown> | null = null;
  let phaseDone = true;
  // Wall-clock budget for this invoke. Replaces every per-run record cap.
  const invokeStartedMs = Date.now();
  const budgetMs = Math.min(MAX_BUDGET_MS, Math.max(5_000, Number(body.budget_ms ?? DEFAULT_BUDGET_MS)));
  const budgetLeftMs = () => budgetMs - (Date.now() - invokeStartedMs);
  // Per-phase budget slices. In `phase: "all"` mode every phase used to share
  // one pool in code order, so conversations (a history-enrichment step) could
  // consume the entire budget and starve opportunities — which silently froze
  // the Won feed while the run still reported success. Each phase now gets a
  // capped slice; a dedicated phase invoke still gets the whole budget.
  const PHASE_SHARE: Record<string, number> = {
    contacts: 0.25,
    opportunities_recent: 0.2,
    conversations: 0.25,
    opportunities: 0.3,
    appointments: 0.15,
  };
  let phaseStartedMs = Date.now();
  let phaseCapMs = budgetMs;
  const beginPhase = (p: string) => {
    phaseStartedMs = Date.now();
    phaseCapMs = phase === "all" ? budgetMs * (PHASE_SHARE[p] ?? 1) : budgetMs;
  };
  const haveBudget = (reserveMs = 8_000) =>
    budgetLeftMs() > reserveMs && (Date.now() - phaseStartedMs) < phaseCapMs;

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
    phase,
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
  if (runs("users")) await safe("users", async () => {
    beginPhase("users");
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
  if (runs("pipelines")) await safe("pipelines", async () => {
    beginPhase("pipelines");
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

  // ===== 3. CONTACTS (deterministic cursor pagination) ==============
  const contactIds: string[] = [];
  const contactCreatedAt = new Map<string, string>();
  const contactLookup = new Map<string, { phone: string | null; email: string | null }>();
  if (runs("contacts")) await safe("contacts", async () => {
    beginPhase("contacts");
    // Resume from the cursor the previous invoke handed back.
    let cursor: unknown[] | null = Array.isArray(cursorIn?.searchAfter)
      ? (cursorIn!.searchAfter as unknown[]) : null;
    let pages = 0;
    const buffer: Json[] = [];
    let exhausted = false;
    while (haveBudget(12_000)) {
      // Explicit deterministic sort. Without it GHL's searchAfter cursor walks
      // an undefined order and which records a run sees is non-reproducible.
      const reqBody: Json = {
        locationId,
        pageLimit: 100,
        sort: [{ field: "dateUpdated", direction: "asc" }],
      };
      if (cursor) reqBody.searchAfter = cursor;
      const j = await ghlFetch("POST", "/contacts/search", token, reqBody);
      pages++;
      const list = ((j.contacts as Json[]) ?? []);
      if (!list.length) { exhausted = true; break; }
      buffer.push(...list);
      const last = list[list.length - 1] as Json;
      const sa = Array.isArray(last.searchAfter) ? last.searchAfter : null;
      if (!sa || list.length < 100) { exhausted = true; break; }
      cursor = sa;
    }
    counts.contact_pages = pages;
    counts.contact_budget_exhausted = !exhausted;
    if (phase === "contacts") {
      phaseDone = exhausted;
      cursorOut = exhausted ? null : { searchAfter: cursor };
    }

    const rows = buffer.map((c) => {
      const a = c as Json;
      const id = String(a.id);
      const createdAt = (a.dateAdded ?? a.createdAt) as string | null;
      if (!isWithinWindow(createdAt, dateFrom, dateTo)) return null;
      if (createdAt) contactCreatedAt.set(id, createdAt);
      contactLookup.set(id, { phone: (a.phone as string | null) ?? null, email: (a.email as string | null) ?? null });
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
    }).filter(Boolean) as Json[];
    counts.contacts_total_pulled = buffer.length;
    counts.contacts_synced = await upsertChunked(admin, "ghl_contacts", rows, "property_id,ghl_contact_id");
    samples.contact = buffer[0] ?? null;

    // Tag refresh fallback: /contacts/search sometimes returns stale or empty tags.
    // For contacts in the window whose tags came back empty, fetch the detail
    // endpoint (cap to avoid burning the API budget).
    const TAG_REFRESH_CAP = MAX_TAG_REFRESH;
    const needsTagRefresh = buffer
      .filter((c) => {
        const t = (c as Json).tags;
        return !Array.isArray(t) || t.length === 0;
      })
      .slice(0, TAG_REFRESH_CAP);
    let tagRefreshed = 0;
    for (const c of needsTagRefresh) {
      const id = String((c as Json).id);
      try {
        const d = await ghlFetch("GET", `/contacts/${id}`, token);
        const detail = (d.contact ?? d) as Json;
        const tags = Array.isArray(detail.tags) ? detail.tags : null;
        if (tags && tags.length > 0) {
          await admin
            .from("ghl_contacts")
            .update({ tags })
            .eq("property_id", property_id)
            .eq("ghl_contact_id", id);
          tagRefreshed++;
        }
      } catch (_e) { /* swallow per-contact errors */ }
    }
    counts.contacts_tag_refresh_attempted = needsTagRefresh.length;
    counts.contacts_tag_refresh_updated = tagRefreshed;
  }, undefined);

  // ===== 3b. RECENT-FIRST OPPORTUNITY REFRESH =======================
  // The deep walk below pages oldest-first, so on a large account it never
  // reaches today's deals before the budget runs out — which is exactly how
  // the Won feed froze. This pass pulls newest-updated-first and stops as soon
  // as it reaches records older than the last confirmed refresh (with an
  // overlap window), so current wins always land regardless of backfill state.
  if (runs("opportunities_recent")) await safe("opportunities_recent", async () => {
    beginPhase("opportunities_recent");
    const OVERLAP_MS = 6 * 3_600_000;
    const { data: wm } = await admin
      .from("sync_watermarks")
      .select("last_fresh_at")
      .eq("property_id", property_id).eq("source", "ghl").eq("phase", "opportunities_recent")
      .maybeSingle();
    const sinceMs = wm?.last_fresh_at
      ? new Date(wm.last_fresh_at as string).getTime() - OVERLAP_MS
      : Date.now() - 30 * 86400_000;

    let startAfter: string | null = null;
    let startAfterId: string | null = null;
    const pulled: Json[] = [];
    let pages = 0;
    let reachedWatermark = false;
    while (haveBudget(12_000)) {
      const qs = new URLSearchParams({ location_id: locationId, limit: "100", order: "last_updated_desc" });
      if (startAfter && startAfterId) { qs.set("startAfter", startAfter); qs.set("startAfterId", startAfterId); }
      const j = await ghlFetch("GET", `/opportunities/search?${qs.toString()}`, token);
      const list = ((j.opportunities as Json[]) ?? []);
      const meta = (j.meta ?? {}) as Json;
      pages++;
      pulled.push(...list);
      const oldestOnPage = list.length
        ? new Date(String((list[list.length - 1] as Json).updatedAt ?? 0)).getTime()
        : 0;
      if (list.length && Number.isFinite(oldestOnPage) && oldestOnPage < sinceMs) { reachedWatermark = true; break; }
      if (!list.length || meta.startAfter == null || list.length < 100) { reachedWatermark = true; break; }
      startAfter = String(meta.startAfter);
      startAfterId = String(meta.startAfterId ?? "");
    }
    counts.opportunities_recent_pulled = pulled.length;
    counts.opportunities_recent_pages = pages;
    counts.opportunities_recent_caught_up = reachedWatermark;

    if (pulled.length) {
      const rows = pulled.map((o) => mapOppRow(property_id, o));
      counts.opportunities_recent_written = await upsertChunked(
        admin, "ghl_opportunities", rows, "property_id,ghl_opportunity_id",
      );
    }
    // Only advance the freshness marker when we actually caught up to the
    // previous watermark; a budget-stop leaves it where it was so the next
    // run re-covers the gap.
    if (reachedWatermark) {
      await admin.from("sync_watermarks").upsert({
        property_id, source: "ghl", phase: "opportunities_recent",
        last_fresh_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        last_error: null,
        consecutive_failures: 0,
        paused_reason: null,
        next_attempt_at: null,
      } as never, { onConflict: "property_id,source,phase" });
    }
    if (phase === "opportunities_recent") phaseDone = true;
  }, undefined);

  // ===== 4. CONVERSATIONS + MESSAGES (classified) ===================
  if (runs("conversations")) await safe("conversations_messages", async () => {
    beginPhase("conversations");
    // When this phase runs on its own invoke the contacts phase lives in a
    // different process, so hydrate the in-window contact set from our copy.
    if (!contactIds.length) {
      const { data: storedContacts } = await admin
        .from("ghl_contacts")
        .select("ghl_contact_id, phone, email, ghl_created_at")
        .eq("property_id", property_id)
        .gte("ghl_created_at", dateFrom.toISOString())
        .order("ghl_created_at", { ascending: false })
        .limit(2000);
      for (const c of storedContacts ?? []) {
        const id = c.ghl_contact_id as string;
        contactIds.push(id);
        contactLookup.set(id, { phone: (c.phone as string | null) ?? null, email: (c.email as string | null) ?? null });
      }
    }
    // GHL's /conversations/search IGNORES `skip` entirely (verified live:
    // skip=0/35/70 return identical pages). The only working cursor is
    // startAfterDate, walked with an explicit deterministic sort.
    //
    // Messages are hydrated INSIDE the page loop so a page is an atomic unit:
    // either every conversation on it is message-synced and the cursor moves
    // past it, or the cursor stays put and the next invoke redoes the page.
    // Nothing can be skipped.
    const contactSet = new Set(contactIds);
    let startAfterDate: number | null = cursorIn?.startAfterDate != null
      ? Number(cursorIn.startAfterDate) : null;
    let conversationPages = 0;
    let conversationsExhausted = false;
    let conversationsSeen = 0;

    const msgRows: Json[] = [];
    let firstHumanSample: Json | null = null;
    let firstAutoSample: Json | null = null;
    let totalMessagePages = 0;
    let conversationsExactly100 = 0;
    let budgetStop = false;
    const perConversation: Json[] = [];
    const classCounts: Record<string, number> = { human: 0, automation: 0, ai: 0, system: 0, customer: 0, unknown: 0 };

    const hydrateMessages = async (convs: Json[]) => {
      for (const c of convs) {
        const cAny = c as Json;
        const conversationId = String(cAny.id ?? "");
        const contactId = String(cAny.contactId ?? "");
        if (!conversationId) continue;
        const lastMsgAt = cAny.lastMessageTimestamp
          ? new Date(Number(cAny.lastMessageTimestamp)).getTime()
          : Number(cAny.lastMessageDate ?? 0);
        const isRecent = lastMsgAt >= dateFrom.getTime();
        if (contactId && !contactSet.has(contactId) && !isRecent) continue;

        const seenMessageIds = new Set<string>();
        let lastMessageId: string | null = null;
        let messagePages = 0;

        // No page cap: walk the conversation to its end, budget permitting.
        while (haveBudget(4_000)) {
          const qs = new URLSearchParams({ limit: "100" });
          if (lastMessageId) qs.set("lastMessageId", lastMessageId);
          const mj = await ghlFetch("GET", `/conversations/${conversationId}/messages?${qs.toString()}`, token);
          const page = messagesFromPayload(mj);
          messagePages++;
          totalMessagePages++;

          for (const m of page.messages) {
            const mA = m as Json;
            const id = String(mA.id ?? "");
            if (!id || seenMessageIds.has(id)) continue;
            seenMessageIds.add(id);
            const cls = classifyMessage(mA);
            classCounts[cls] = (classCounts[cls] ?? 0) + 1;
            if (cls === "human" && !firstHumanSample) firstHumanSample = mA;
            if (cls === "automation" && !firstAutoSample) firstAutoSample = mA;
            msgRows.push({
              property_id,
              ghl_message_id: id,
              conversation_id: conversationId,
              contact_id: contactId || null,
              direction: mA.direction ?? null,
              channel: messageChannel(mA),
              message_type: mA.messageType ?? null,
              ghl_user_id: mA.userId ?? null,
              response_source: cls,
              source_raw: mA.source ?? null,
              sent_at: mA.dateAdded ?? null,
              body_preview: typeof mA.body === "string" ? (mA.body as string).slice(0, 280) : null,
              meta: normalizedMessageMeta(mA),
              raw: m,
            });
          }

          lastMessageId = page.lastMessageId;
          if (!page.messages.length || page.nextPage === false || (page.nextPage == null && page.messages.length < 100)) break;
          if (!lastMessageId) break;
        }

        if (seenMessageIds.size === 100) conversationsExactly100++;
        perConversation.push({ conversation_id: conversationId, contact_id: contactId || null, messages_fetched: seenMessageIds.size, pages: messagePages });
      }
    };

    // Targeted per-contact hydration runs only on the first invoke of the
    // phase; later invokes are walking the location-wide cursor.
    const targetedBudget = (phase === "all" || cursorIn?.startAfterDate == null)
      ? MAX_TARGETED_CONVERSATION_LOOKUPS : 0;
    let targetedConversationLookups = 0;
    let targetedConversationsAdded = 0;
    const targetedConvs = new Map<string, Json>();
    for (const cid of contactIds.slice(0, targetedBudget)) {
      if (!haveBudget(20_000)) break;
      targetedConversationLookups++;
      const found = new Map<string, Json>();
      const addMatches = (items: Json[]) => {
        for (const conv of items) {
          const id = String((conv as Json).id ?? "");
          if (id) found.set(id, conv);
        }
      };
      const j = await ghlFetch("GET", `/conversations/search?locationId=${locationId}&contactId=${encodeURIComponent(cid)}&limit=100`, token);
      addMatches(((j.conversations as Json[]) ?? []).filter((conv) => String((conv as Json).contactId ?? "") === cid));
      const contactInfo = contactLookup.get(cid);
      const phoneDigits = String(contactInfo?.phone ?? "").replace(/\D/g, "");
      const email = String(contactInfo?.email ?? "").trim().toLowerCase();
      if (!found.size && (phoneDigits || email)) {
        const q = encodeURIComponent(email || phoneDigits);
        const byQuery = await ghlFetch("GET", `/conversations/search?locationId=${locationId}&query=${q}&limit=100`, token).catch(() => ({ conversations: [] } as Json));
        addMatches(((byQuery.conversations as Json[]) ?? []).filter((conv) => {
          const convContactId = String((conv as Json).contactId ?? "");
          const convPhone = String((conv as Json).phone ?? (conv as Json).contactPhone ?? "").replace(/\D/g, "");
          const convEmail = String((conv as Json).email ?? (conv as Json).contactEmail ?? "").trim().toLowerCase();
          return convContactId === cid || (!!phoneDigits && convPhone.endsWith(phoneDigits.slice(-10))) || (!!email && convEmail === email);
        }));
      }
      for (const [id, conv] of found) {
        if (targetedConvs.has(id)) continue;
        targetedConvs.set(id, conv);
        targetedConversationsAdded++;
      }
    }
    if (targetedConvs.size) await hydrateMessages(Array.from(targetedConvs.values()));

    // Location-wide walk.
    while (haveBudget(20_000)) {
      const cursorParam = startAfterDate != null ? `&startAfterDate=${startAfterDate}` : "";
      const j = await ghlFetch(
        "GET",
        `/conversations/search?locationId=${locationId}&limit=${CONVERSATION_PAGE_SIZE}&sortBy=last_message_date&sort=desc${cursorParam}`,
        token,
      );
      const list = ((j.conversations as Json[]) ?? []);
      conversationPages++;
      if (!list.length) { conversationsExhausted = true; break; }
      conversationsSeen += list.length;

      await hydrateMessages(list);

      const tail = list[list.length - 1] as Json;
      const tailDate = Number(tail.lastMessageDate ?? tail.dateUpdated ?? NaN);
      if (Number.isFinite(tailDate)) startAfterDate = tailDate;
      // Sorted newest-first: once the page tail predates the window, done.
      if (Number.isFinite(tailDate) && tailDate < dateFrom.getTime()) { conversationsExhausted = true; break; }
      if (list.length < CONVERSATION_PAGE_SIZE) { conversationsExhausted = true; break; }
    }
    if (!conversationsExhausted) budgetStop = true;

    if (phase === "conversations") {
      phaseDone = conversationsExhausted;
      cursorOut = conversationsExhausted ? null : { startAfterDate };
    }

    counts.conversations = conversationsSeen;
    counts.conversation_pages = conversationPages;
    counts.conversation_budget_stop = budgetStop;
    counts.targeted_conversation_lookups = targetedConversationLookups;
    counts.targeted_conversations_added = targetedConversationsAdded;
    counts.messages = await upsertChunked(admin, "ghl_messages", msgRows, "property_id,ghl_message_id");
    counts.messages_by_source = classCounts;
    counts.conversation_message_pages = totalMessagePages;
    counts.conversations_exactly_100_messages = conversationsExactly100;
    samples.conversation_message_counts = perConversation.slice(0, 25);
    samples.message_human = firstHumanSample;
    samples.message_automation = firstAutoSample;
  }, undefined);

  // ===== 5. OPPORTUNITIES (+ stage-diff history) ====================
  if (runs("opportunities")) await safe("opportunities", async () => {
    beginPhase("opportunities");
    // /opportunities/search (POST) rejects any sort parameter with a 422, but
    // the GET form accepts `order=added_asc` plus a real cursor (startAfter +
    // startAfterId returned in meta). Verified live against DFW: the cursor
    // walk returned 891 unique of 891 reported, zero duplicates. No date
    // windowing needed.
    // The deep walk position is persisted so it resumes across runs instead of
    // restarting at the oldest record every cycle.
    let startAfter = cursorIn?.startAfter != null ? String(cursorIn.startAfter) : null;
    let startAfterId = cursorIn?.startAfterId != null ? String(cursorIn.startAfterId) : null;
    let storedCursor: Json | null = null;
    if (startAfter == null) {
      const { data: wmRow } = await admin
        .from("sync_watermarks")
        .select("cursor_json")
        .eq("property_id", property_id).eq("source", "ghl").eq("phase", "opportunities")
        .maybeSingle();
      storedCursor = (wmRow?.cursor_json ?? null) as Json | null;
      if (storedCursor?.startAfter != null) {
        startAfter = String(storedCursor.startAfter);
        startAfterId = String(storedCursor.startAfterId ?? "");
      }
    }
    const pulled: Json[] = [];
    let opportunityPages = 0;
    let opportunitiesExhausted = false;
    let reportedTotal: number | null = null;
    while (haveBudget(15_000)) {
      const qs = new URLSearchParams({ location_id: locationId, limit: "100", order: "added_asc" });
      if (startAfter && startAfterId) { qs.set("startAfter", startAfter); qs.set("startAfterId", startAfterId); }
      const j = await ghlFetch("GET", `/opportunities/search?${qs.toString()}`, token);
      const list = ((j.opportunities as Json[]) ?? []);
      const meta = (j.meta ?? {}) as Json;
      if (reportedTotal == null && meta.total != null) reportedTotal = Number(meta.total);
      pulled.push(...list);
      opportunityPages++;
      if (!list.length || meta.startAfter == null) { opportunitiesExhausted = true; break; }
      startAfter = String(meta.startAfter);
      startAfterId = String(meta.startAfterId ?? "");
      if (list.length < 100) { opportunitiesExhausted = true; break; }
    }
    counts.opportunities_reported_total = reportedTotal;
    if (phase === "opportunities") {
      phaseDone = opportunitiesExhausted;
      cursorOut = opportunitiesExhausted ? null : { startAfter, startAfterId };
    }
    counts.opportunities_pulled = pulled.length;
    counts.opportunity_pages = opportunityPages;
    counts.opportunity_budget_stop = !opportunitiesExhausted;

    // Persist the deep-walk position (null once the walk completes, so the
    // next cycle starts a fresh full pass).
    await admin.from("sync_watermarks").upsert({
      property_id, source: "ghl", phase: "opportunities",
      cursor_json: opportunitiesExhausted ? null : { startAfter, startAfterId },
      last_attempt_at: new Date().toISOString(),
      ...(opportunitiesExhausted ? { last_fresh_at: new Date().toISOString() } : {}),
    } as never, { onConflict: "property_id,source,phase" });

    // Existing rows for stage-diff
    const { data: existing } = await admin
      .from("ghl_opportunities")
      .select("id, ghl_opportunity_id, stage_id")
      .eq("property_id", property_id);
    const existingMap = new Map((existing ?? []).map((r) => [r.ghl_opportunity_id, { id: r.id as string, stage_id: r.stage_id as string | null }]));

    const rows = pulled.map((o) => mapOppRow(property_id, o));
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
  if (runs("appointments")) await safe("appointments", async () => {
    beginPhase("appointments");
    const cj = await ghlFetch("GET", `/calendars/?locationId=${locationId}`, token);
    const cals = ((cj.calendars as Json[]) ?? []);
    counts.calendars = cals.length;

    // Walk in 7-day windows per probe report.
    const apptRows: Json[] = [];
    const statusDist: Record<string, number> = {};
    const startMs = dateFrom.getTime();
    const endMs = dateTo.getTime();
    // 30-day windows, resumable. Over a multi-year backfill the old 7-day walk
    // was hundreds of sequential calls and blew the invoke timeout.
    const WINDOW = 30 * 86400_000;
    let calIndex = Number(cursorIn?.calIndex ?? 0) || 0;
    let windowStart = cursorIn?.windowStart != null ? Number(cursorIn.windowStart) : startMs;
    let apptExhausted = true;

    outer:
    for (; calIndex < cals.length; calIndex++) {
      const calId = String((cals[calIndex] as Json).id);
      for (let s = windowStart; s < endMs; s += WINDOW) {
        if (!haveBudget(15_000)) {
          apptExhausted = false;
          windowStart = s;
          break outer;
        }
        const e = Math.min(s + WINDOW, endMs);
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
      windowStart = startMs;
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
    counts.appointment_budget_stop = !apptExhausted;
    if (phase === "appointments") {
      phaseDone = apptExhausted;
      cursorOut = apptExhausted ? null : { calIndex, windowStart };
    }
    samples.appointment = apptRows[0] ?? null;
  }, undefined);

  // ===== 7. TASKS (opt-in) ==========================================
  if (runs("tasks") && includeTasks) {
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

  // ===== 8. REBUILD LEAD FACTS (finalize only) ======================
  if (runs("finalize")) await safe("rebuild_lead_facts", async () => {
    const { data, error } = await admin.rpc("rebuild_lead_facts", { _property_id: property_id });
    if (error) throw new Error(error.message);
    counts.lead_facts = (data as Json | null)?.facts_written ?? 0;
  }, undefined);

  // verified_sale is now sourced from CTM's "converted" toggle, written by
  // sync-ctm. GHL no longer overwrites daily_metrics.verified_sale.

  // ===== Bookkeeping ================================================
  summary.finished_at = new Date().toISOString();
  summary.phase_done = phaseDone;
  summary.next_cursor = cursorOut;
  const blockingErrors = errs.filter((msg) =>
    !msg.startsWith("rebuild_lead_facts:"),
  );
  // Do NOT demote status to "error" on transient sync failures — that would
  // cause the orchestrator and resync-failed (both filter status='connected')
  // to silently skip this pair forever. Reserve status='error' for auth /
  // config failures handled by the connection dialog. Transient issues are
  // still visible via last_error and sync_runs.
  const failedPhase = blockingErrors.length
    ? String(blockingErrors[0]).split(":")[0]
    : null;

  // ---- Freshness watermarks -------------------------------------------
  // The watchdog judges on these, not on run status, so a phase that silently
  // wrote nothing cannot masquerade as healthy.
  const nowIso = new Date().toISOString();
  const failedLabels = new Set(blockingErrors.map((m) => String(m).split(":")[0]));
  const ranPhases: string[] = [];
  if (runs("contacts") && !failedLabels.has("contacts")) ranPhases.push("contacts");
  if (runs("conversations") && !failedLabels.has("conversations_messages")) ranPhases.push("conversations");
  if (runs("appointments") && !failedLabels.has("appointments")) ranPhases.push("appointments");
  // Only a full run may refresh the "all" marker — a single-phase invoke must
  // not make the whole source look fresh to the watchdog.
  if (!blockingErrors.length && phase === "all") ranPhases.push("all");
  for (const p of ranPhases) {
    await admin.from("sync_watermarks").upsert({
      property_id, source: "ghl", phase: p,
      last_fresh_at: nowIso, last_attempt_at: nowIso,
      last_error: null, consecutive_failures: 0, paused_reason: null, next_attempt_at: null,
    } as never, { onConflict: "property_id,source,phase" });
  }
  if (blockingErrors.length && phase === "all") {
    await admin.from("sync_watermarks").upsert({
      property_id, source: "ghl", phase: "all",
      last_attempt_at: nowIso,
      last_error: blockingErrors.join(" | ").slice(0, 1000),
    } as never, { onConflict: "property_id,source,phase" });
  }

  await admin
    .from("property_data_sources")
    .update({
      last_synced_at: summary.finished_at,
      last_error: blockingErrors.length ? blockingErrors.join(" | ").slice(0, 1000) : null,
      status: "connected",
    })
    .eq("property_id", property_id).eq("source", "ghl");
  await admin.from("sync_runs").insert({
    property_id, source: "ghl",
    status: blockingErrors.length ? "failure" : "success",
    phase: blockingErrors.length ? failedPhase : (phase === "all" ? null : phase),
    error_message: blockingErrors.length ? blockingErrors.join(" | ").slice(0, 1000) : null,
    stats: {
      warnings: errs.filter((msg) => !blockingErrors.includes(msg)),
      phase, phase_done: phaseDone, next_cursor: cursorOut,
    } as never,
  });

  return new Response(JSON.stringify(summary, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});