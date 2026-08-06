// Historical Go High Level backfill.
//
// The incremental sync (`sync-ghl`) defaults to a 30-day window and caps
// pagination hard so it always finishes inside the function time limit. That
// leaves locations connected recently (e.g. DFW) with no history before their
// connection date. This function walks the CRM back over a long range in
// resumable chunks: the caller invokes it repeatedly, passing the `next`
// cursor returned by the previous call until `next` is null.
//
// Phases: contacts -> opportunities -> finalize (rebuild derived lead facts).
// Every write is an upsert on the external id, so re-running is safe.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const MAX_RPS = 8;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1500;

// Per-invocation page budgets — keeps each call well inside the wall clock.
const CONTACT_PAGES_PER_CALL = 15;   // 100 contacts per page
const OPPORTUNITY_PAGES_PER_CALL = 15;
const MAX_OPPORTUNITY_PAGE = 300;

type Json = Record<string, unknown>;

const callTimes: number[] = [];
async function rateLimit() {
  const now = Date.now();
  while (callTimes.length && now - callTimes[0] > 1000) callTimes.shift();
  if (callTimes.length >= MAX_RPS) {
    await new Promise((r) => setTimeout(r, 1000 - (now - callTimes[0]) + 5));
    return rateLimit();
  }
  callTimes.push(Date.now());
}

async function ghlFetch(method: string, path: string, token: string, body?: Json): Promise<Json> {
  let attempt = 0;
  while (true) {
    await rateLimit();
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
    if (res.ok) {
      try { return text ? JSON.parse(text) as Json : {}; } catch { return {}; }
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** attempt));
      attempt++;
      continue;
    }
    throw new Error(`GHL ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
}

function canonicalizeOppStatus(raw: unknown): "open" | "won" | "lost" | "abandoned" | "unknown" {
  const s = String(raw ?? "").toLowerCase();
  if (s === "open" || s === "won" || s === "lost" || s === "abandoned") return s;
  return "unknown";
}

async function upsertChunked(admin: ReturnType<typeof createClient>, table: string, rows: unknown[], onConflict: string, chunk = 200) {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await admin.from(table).upsert(slice as never, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
    n += slice.length;
  }
  return n;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- auth: internal roles only ----
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const { data: userRes } = await admin.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: isInternal } = await admin.rpc("is_all_properties_reader", { _user_id: user.id });
  if (!isInternal) return json({ error: "Forbidden" }, 403);

  let body: {
    property_id?: string;
    start_date?: string;
    phase?: string;
    cursor?: unknown[] | null;
    page?: number;
    contacts_imported?: number;
    opportunities_imported?: number;
    chunks_done?: number;
  } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const propertyId = body.property_id;
  if (!propertyId) return json({ error: "property_id required" }, 400);

  const startDate = body.start_date ? new Date(body.start_date) : new Date(Date.now() - 730 * 86400_000);
  if (!Number.isFinite(startDate.getTime())) return json({ error: "invalid start_date" }, 400);
  const startMs = startDate.getTime();

  const { data: pds, error: pdsErr } = await admin
    .from("property_data_sources")
    .select("config, secret_token")
    .eq("property_id", propertyId)
    .eq("source", "ghl")
    .maybeSingle();
  if (pdsErr || !pds) return json({ error: pdsErr?.message ?? "GHL not configured for this property" }, 400);

  const locationId = (pds.config as Json | null)?.location_id as string | undefined;
  const token = (pds.secret_token as string | undefined) ?? "";
  if (!locationId || !token) return json({ error: "Missing GHL location_id or token" }, 400);

  const phase = body.phase ?? "contacts";
  const totals = {
    contacts_imported: Number(body.contacts_imported ?? 0),
    opportunities_imported: Number(body.opportunities_imported ?? 0),
    chunks_done: Number(body.chunks_done ?? 0) + 1,
  };

  try {
    // ================= PHASE: CONTACTS =================
    if (phase === "contacts") {
      let cursor = (Array.isArray(body.cursor) ? body.cursor : null) as unknown[] | null;
      let pages = 0;
      let reachedStart = false;
      let exhausted = false;
      const rows: Json[] = [];
      let earliest: string | null = null;

      while (pages < CONTACT_PAGES_PER_CALL) {
        const reqBody: Json = {
          locationId,
          pageLimit: 100,
          sort: [{ field: "dateAdded", direction: "desc" }],
        };
        if (cursor) reqBody.searchAfter = cursor;
        const j = await ghlFetch("POST", "/contacts/search", token, reqBody);
        pages++;
        const list = ((j.contacts as Json[]) ?? []);
        if (!list.length) { exhausted = true; break; }

        for (const c of list) {
          const a = c as Json;
          const createdAt = (a.dateAdded ?? a.createdAt) as string | null;
          const createdMs = createdAt ? new Date(String(createdAt)).getTime() : NaN;
          if (Number.isFinite(createdMs) && createdMs < startMs) { reachedStart = true; continue; }
          if (createdAt && (!earliest || createdAt < earliest)) earliest = createdAt;
          rows.push({
            property_id: propertyId,
            ghl_location_id: locationId,
            ghl_contact_id: String(a.id),
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
          });
        }

        const last = list[list.length - 1] as Json;
        const sa = Array.isArray(last.searchAfter) ? last.searchAfter : null;
        if (reachedStart) break;
        if (!sa || list.length < 100) { exhausted = true; break; }
        cursor = sa;
      }

      totals.contacts_imported += await upsertChunked(admin, "ghl_contacts", rows, "property_id,ghl_contact_id");
      const done = reachedStart || exhausted;
      return json({
        phase: "contacts",
        pages_this_call: pages,
        earliest_contact_created_at: earliest,
        totals,
        next: done
          ? { phase: "opportunities", page: 1, ...totals }
          : { phase: "contacts", cursor, ...totals },
      });
    }

    // ================= PHASE: OPPORTUNITIES =================
    if (phase === "opportunities") {
      let page = Math.max(1, Number(body.page ?? 1));
      let pages = 0;
      let exhausted = false;
      const pulled: Json[] = [];

      while (pages < OPPORTUNITY_PAGES_PER_CALL && page <= MAX_OPPORTUNITY_PAGE) {
        const j = await ghlFetch("POST", "/opportunities/search", token, { locationId, limit: 100, page });
        const list = ((j.opportunities as Json[]) ?? []);
        pulled.push(...list);
        pages++;
        if (list.length < 100) { exhausted = true; break; }
        page++;
      }
      if (page > MAX_OPPORTUNITY_PAGE) exhausted = true;

      const rows = pulled.map((o) => {
        const a = o as Json;
        return {
          property_id: propertyId,
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
      });
      totals.opportunities_imported += await upsertChunked(admin, "ghl_opportunities", rows, "property_id,ghl_opportunity_id");

      return json({
        phase: "opportunities",
        pages_this_call: pages,
        totals,
        next: exhausted
          ? { phase: "finalize", ...totals }
          : { phase: "opportunities", page: page + 1, ...totals },
      });
    }

    // ================= PHASE: FINALIZE =================
    const { data: factsData, error: factsErr } = await admin.rpc("rebuild_lead_facts", { _property_id: propertyId });
    if (factsErr) throw new Error(factsErr.message);

    const { data: earliestRow } = await admin
      .from("ghl_contacts")
      .select("ghl_created_at")
      .eq("property_id", propertyId)
      .not("ghl_created_at", "is", null)
      .order("ghl_created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    await admin.from("sync_runs").insert({
      property_id: propertyId,
      source: "ghl",
      status: "success",
      trigger_source: "backfill",
      stats: { backfill: true, ...totals } as never,
    });

    return json({
      phase: "finalize",
      totals,
      lead_facts: (factsData as Json | null)?.facts_written ?? 0,
      earliest_contact_created_at: (earliestRow as Json | null)?.ghl_created_at ?? null,
      next: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("ghl-backfill", message);
    // Backfill never demotes the connection — incremental sync must keep running.
    return json({ error: message, phase, totals, next: null }, 500);
  }
});
