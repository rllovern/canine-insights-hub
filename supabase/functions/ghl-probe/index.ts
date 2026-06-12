// One-shot read-only probe against a connected GHL sub-account.
// Runs the 10 feasibility probes from .lovable/plan.md and returns a structured
// report. Does not write to the database.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

type Json = Record<string, unknown>;

type Call = {
  label: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  latency_ms: number;
  retry_after?: string | null;
  error?: string;
};

async function ghlFetch(
  method: string,
  path: string,
  token: string,
  body?: Json,
): Promise<{ res: Response; bodyText: string; latency: number }> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (body) init.body = JSON.stringify(body);
  const t0 = Date.now();
  const res = await fetch(GHL_BASE + path, init);
  const bodyText = await res.text();
  return { res, bodyText, latency: Date.now() - t0 };
}

function parseJson(s: string): Json | null {
  try { return JSON.parse(s) as Json; } catch { return null; }
}

function take<T>(arr: unknown, n: number): T[] {
  return Array.isArray(arr) ? (arr.slice(0, n) as T[]) : [];
}

function fieldsOf(o: unknown): string[] {
  if (!o || typeof o !== "object") return [];
  return Object.keys(o as Json).sort();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userRes } = await userClient.auth.getUser(jwt);
  const user = userRes?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isInternal } = await admin.rpc("has_role", { _user_id: user.id, _role: "internal" });
  if (!isInternal) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const propertyId = body.property_id as string | undefined;
  if (!propertyId) {
    return new Response(JSON.stringify({ error: "property_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: pds, error: pdsErr } = await admin
    .from("property_data_sources")
    .select("config, secret_token")
    .eq("property_id", propertyId)
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
    return new Response(JSON.stringify({ error: "Missing location_id or token" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const calls: Call[] = [];
  async function call(label: string, method: string, path: string, body?: Json) {
    try {
      const { res, bodyText, latency } = await ghlFetch(method, path, token, body);
      calls.push({
        label, method, path,
        status: res.status, ok: res.ok, latency_ms: latency,
        retry_after: res.headers.get("Retry-After"),
      });
      return { res, bodyText, latency };
    } catch (e) {
      calls.push({ label, method, path, status: 0, ok: false, latency_ms: 0, error: e instanceof Error ? e.message : String(e) });
      return { res: null, bodyText: "", latency: 0 };
    }
  }

  const report: Json = { property_id: propertyId, location_id: locationId, ran_at: new Date().toISOString() };

  // ============ Probe: Users (pagination + roster) ============
  {
    const { bodyText } = await call("users.list", "GET", `/users/?locationId=${locationId}`);
    const j = parseJson(bodyText);
    const users = Array.isArray(j?.users) ? (j!.users as Json[]) : [];
    report.users = {
      count: users.length,
      sample_fields: fieldsOf(users[0]),
      pagination_keys_present: j ? Object.keys(j).filter((k) => k !== "users") : [],
      deleted_present: users.some((u) => "deleted" in (u as Json)),
      sample: users[0] ?? null,
    };
  }

  // ============ Probe: Pipelines ============
  let firstPipelineStageIds: string[] = [];
  {
    const { bodyText } = await call("pipelines", "GET", `/opportunities/pipelines?locationId=${locationId}`);
    const j = parseJson(bodyText);
    const pipelines = Array.isArray(j?.pipelines) ? (j!.pipelines as Json[]) : [];
    const summary = pipelines.map((p) => ({
      id: (p as Json).id,
      name: (p as Json).name,
      stage_count: Array.isArray((p as Json).stages) ? ((p as Json).stages as Json[]).length : 0,
      stages: (((p as Json).stages as Json[]) ?? []).map((s) => ({ id: (s as Json).id, name: (s as Json).name, position: (s as Json).position })),
    }));
    if (summary[0] && Array.isArray((pipelines[0] as Json).stages)) {
      firstPipelineStageIds = ((pipelines[0] as Json).stages as Json[]).map((s) => String((s as Json).id));
    }
    report.pipelines = { count: pipelines.length, summary };
  }

  // ============ Probe: Contacts (page+cursor) ============
  let contactIdsForTaskProbe: string[] = [];
  {
    const { bodyText: p1 } = await call("contacts.search.page1", "POST", "/contacts/search", { locationId, pageLimit: 100, page: 1 });
    const j1 = parseJson(p1) ?? {};
    const list1 = (j1.contacts as Json[]) ?? [];
    contactIdsForTaskProbe = list1.slice(0, 10).map((c) => String((c as Json).id));

    // page 2 (only if there's more)
    let page2Info: Json | null = null;
    const total = (j1.total as number) ?? null;
    if (list1.length === 100) {
      const { bodyText: p2 } = await call("contacts.search.page2", "POST", "/contacts/search", { locationId, pageLimit: 100, page: 2 });
      const j2 = parseJson(p2) ?? {};
      const list2 = (j2.contacts as Json[]) ?? [];
      page2Info = {
        returned: list2.length,
        first_id_overlap: list2.some((c) => list1.some((x) => (x as Json).id === (c as Json).id)),
      };
    }

    // Cursor probe: contacts list returns a per-row `searchAfter: [ts, id]`.
    // The API accepts this as `searchAfter` on the next request.
    let cursorInfo: Json | null = null;
    const lastContact = list1[list1.length - 1] as Json | undefined;
    const lastSearchAfter = lastContact && Array.isArray(lastContact.searchAfter) ? lastContact.searchAfter : null;
    if (lastSearchAfter) {
      const { bodyText: pc, res: rcr } = await call("contacts.search.cursor", "POST", "/contacts/search", {
        locationId, pageLimit: 10, searchAfter: lastSearchAfter,
      });
      const jc = parseJson(pc) ?? {};
      cursorInfo = {
        status: rcr?.status,
        returned: ((jc.contacts as Json[]) ?? []).length,
        cursor_used: lastSearchAfter,
        overlap_with_page1: ((jc.contacts as Json[]) ?? []).some((c) => list1.some((x) => (x as Json).id === (c as Json).id)),
      };
    } else {
      cursorInfo = { note: "no searchAfter cursor returned on contacts" };
    }

    report.contacts = {
      total,
      page1_returned: list1.length,
      page1_response_keys: Object.keys(j1).filter((k) => k !== "contacts"),
      page2: page2Info,
      cursor_probe: cursorInfo,
      sample_fields: fieldsOf(list1[0]),
      assigned_to_present: list1.some((c) => (c as Json).assignedTo != null),
      sample: list1[0] ?? null,
    };
  }

  // ============ Probe: Conversations search ============
  let firstConversation: Json | null = null;
  {
    const { bodyText } = await call("conversations.search", "GET", `/conversations/search?locationId=${locationId}&limit=20`);
    const j = parseJson(bodyText) ?? {};
    const convs = (j.conversations as Json[]) ?? [];
    firstConversation = convs[0] ?? null;
    report.conversations = {
      total: j.total ?? null,
      returned: convs.length,
      response_keys: Object.keys(j).filter((k) => k !== "conversations"),
      sample_fields: fieldsOf(convs[0]),
      types_seen: Array.from(new Set(convs.map((c) => String((c as Json).type)))),
      sample: convs[0] ?? null,
    };
  }

  // ============ Probe: Single conversation GET (createdAt presence) ============
  if (firstConversation?.id) {
    const { bodyText } = await call("conversation.get", "GET", `/conversations/${firstConversation.id}`);
    const j = parseJson(bodyText) ?? {};
    report.conversation_single = {
      keys: fieldsOf(j),
      has_dateAdded: "dateAdded" in j,
      has_createdAt: "createdAt" in j,
      sample: j,
    };
  }

  // ============ Probe: Messages (source classification, calls, AI) ============
  // Pull messages from up to 5 conversations and aggregate.
  if (firstConversation) {
    const convResAll = await ghlFetch("GET", `/conversations/search?locationId=${locationId}&limit=20`, token);
    const convList = ((parseJson(convResAll.bodyText)?.conversations as Json[]) ?? []).slice(0, 5);
    const allMessages: Json[] = [];
    let messagesCalls = 0;
    const msgLatencies: number[] = [];
    for (const c of convList) {
      const { bodyText, latency } = await call(`messages.${c.id}`, "GET", `/conversations/${c.id}/messages?limit=100`);
      msgLatencies.push(latency);
      messagesCalls++;
      const inner = parseJson(bodyText) ?? {};
      const msgs = ((inner.messages as Json)?.messages as Json[]) ?? (inner.messages as Json[]) ?? [];
      allMessages.push(...msgs);
    }
    // Aggregate
    const combos = new Map<string, number>();
    const distinctSource = new Set<string>();
    const distinctMessageType = new Set<string>();
    const distinctContentType = new Set<string>();
    const distinctStatus = new Set<string>();
    const fieldHist = new Map<string, number>();
    let outboundCount = 0;
    let outboundHumanLike = 0;
    let outboundNoUser = 0;
    let callRows: Json[] = [];
    let aiSuspects: Json[] = [];
    let withWorkflowField = 0;
    for (const m of allMessages) {
      for (const k of Object.keys(m as Json)) fieldHist.set(k, (fieldHist.get(k) ?? 0) + 1);
      const dir = String((m as Json).direction ?? "");
      const src = String((m as Json).source ?? "");
      const mt = String((m as Json).messageType ?? "");
      const ct = String((m as Json).contentType ?? "");
      const st = String((m as Json).status ?? "");
      const uidPresent = (m as Json).userId != null && (m as Json).userId !== "";
      distinctSource.add(src);
      distinctMessageType.add(mt);
      distinctContentType.add(ct);
      distinctStatus.add(st);
      const key = `${dir}|${src}|${mt}|userId=${uidPresent ? "yes" : "no"}`;
      combos.set(key, (combos.get(key) ?? 0) + 1);
      if (dir === "outbound") {
        outboundCount++;
        if (uidPresent) outboundHumanLike++; else outboundNoUser++;
      }
      if (/CALL/i.test(mt)) callRows.push(m);
      if (/AI|ai|conversation.?ai|employee/i.test(src) || /AI|EMPLOYEE/.test(mt)) aiSuspects.push(m);
      if ("workflowId" in (m as Json) || ((m as Json).meta && typeof (m as Json).meta === "object" && "workflowId" in ((m as Json).meta as Json))) withWorkflowField++;
    }
    report.messages = {
      conversations_sampled: convList.length,
      total_messages: allMessages.length,
      avg_messages_endpoint_latency_ms: msgLatencies.length ? Math.round(msgLatencies.reduce((a, b) => a + b, 0) / msgLatencies.length) : 0,
      distinct_source: Array.from(distinctSource),
      distinct_messageType: Array.from(distinctMessageType),
      distinct_contentType: Array.from(distinctContentType),
      distinct_status: Array.from(distinctStatus),
      combos: Object.fromEntries(Array.from(combos.entries()).sort((a, b) => b[1] - a[1])),
      field_presence: Object.fromEntries(Array.from(fieldHist.entries())),
      outbound_count: outboundCount,
      outbound_with_userId: outboundHumanLike,
      outbound_without_userId: outboundNoUser,
      workflow_id_field_seen_count: withWorkflowField,
      call_messages: {
        count: callRows.length,
        sample: callRows[0] ?? null,
        sample_meta_keys: callRows[0] ? fieldsOf((callRows[0] as Json).meta) : [],
      },
      ai_suspects: {
        count: aiSuspects.length,
        samples: aiSuspects.slice(0, 3),
      },
      sample_outbound_human: allMessages.find((m) => (m as Json).direction === "outbound" && (m as Json).userId) ?? null,
      sample_outbound_automation: allMessages.find((m) => (m as Json).direction === "outbound" && !(m as Json).userId) ?? null,
    };
    report._messages_endpoint_calls = messagesCalls;
  }

  // ============ Probe: Opportunities ============
  {
    // POST body uses camelCase `locationId` (the GET version takes snake_case)
    const { bodyText } = await call("opportunities.search", "POST", "/opportunities/search", { locationId, limit: 100, page: 1 });
    const j = parseJson(bodyText) ?? {};
    const ops = (j.opportunities as Json[]) ?? [];
    const lostWithReason = ops.filter((o) => (o as Json).status === "lost" && (o as Json).lostReasonId).length;
    const lostTotal = ops.filter((o) => (o as Json).status === "lost").length;
    report.opportunities = {
      total: j.total ?? null,
      returned: ops.length,
      response_keys: Object.keys(j).filter((k) => k !== "opportunities"),
      sample_fields: fieldsOf(ops[0]),
      distinct_status: Array.from(new Set(ops.map((o) => String((o as Json).status)))),
      lost_total: lostTotal,
      lost_with_reason: lostWithReason,
      assigned_to_present: ops.some((o) => (o as Json).assignedTo != null),
      has_lastStageChangeAt: ops[0] ? "lastStageChangeAt" in (ops[0] as Json) : null,
      sample: ops[0] ?? null,
    };
  }

  // ============ Probe: Calendars + 7-day window + appointmentStatus enum ============
  {
    // Try listing calendars
    const { bodyText: cb } = await call("calendars.list", "GET", `/calendars/?locationId=${locationId}`);
    const cj = parseJson(cb) ?? {};
    const calendars = (cj.calendars as Json[]) ?? [];
    const now = Date.now();
    // 90-day historical window so appointmentStatus values get a meaningful sample.
    // (The 7-day operational sync window is a separate concern from this probe.)
    const endTime = now;
    const startTime = now - 90 * 86400_000;

    const windowResults: Json[] = [];
    const statusCounts = new Map<string, number>();
    let totalEvents = 0;

    // Probe by calendarId first (preferred). Fallback to userId-scoped if calendars empty.
    const ids = calendars.slice(0, 5).map((c) => String((c as Json).id));
    if (ids.length) {
      for (const calId of ids) {
        const { bodyText, latency } = await call(`calendars.events.${calId}`, "GET",
          `/calendars/events?locationId=${locationId}&calendarId=${calId}&startTime=${startTime}&endTime=${endTime}`);
        const j = parseJson(bodyText) ?? {};
        const events = (j.events as Json[]) ?? [];
        totalEvents += events.length;
        for (const e of events) {
          const s = String((e as Json).appointmentStatus ?? "unknown");
          statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
        }
        windowResults.push({ calendarId: calId, events: events.length, latency_ms: latency, sample: events[0] ?? null });
      }
    } else {
      // Fallback: try a single userId scope using first user
      const firstUser = (((report.users as Json | undefined)?.sample) as Json | undefined)?.id;
      if (firstUser) {
        const { bodyText, latency } = await call("calendars.events.byUser", "GET",
          `/calendars/events?locationId=${locationId}&userId=${firstUser}&startTime=${startTime}&endTime=${endTime}`);
        const j = parseJson(bodyText) ?? {};
        const events = (j.events as Json[]) ?? [];
        totalEvents = events.length;
        for (const e of events) {
          const s = String((e as Json).appointmentStatus ?? "unknown");
          statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
        }
        windowResults.push({ userId: firstUser, events: events.length, latency_ms: latency, sample: events[0] ?? null });
      }
    }

    // "Showed via fallback" check: confirmed + endTime < now
    let fallbackPastConfirmed = 0;
    for (const w of windowResults) {
      const sample = (w as Json).sample as Json | null;
      if (sample && sample.appointmentStatus === "confirmed" && sample.endTime) {
        if (new Date(String(sample.endTime)).getTime() < now) fallbackPastConfirmed++;
      }
    }

    report.calendars = {
      calendars_count: calendars.length,
      calendars_sample_fields: fieldsOf(calendars[0]),
      window_days: 90,
      total_events_in_window: totalEvents,
      distinct_appointment_status: Object.fromEntries(statusCounts.entries()),
      per_calendar_results: windowResults,
      past_confirmed_in_sample: fallbackPastConfirmed,
    };
  }

  // ============ Probe: Tasks volume ============
  {
    if (contactIdsForTaskProbe.length === 0) {
      report.tasks = { sampled: 0, note: "no contacts available" };
    } else {
      const sample = contactIdsForTaskProbe.slice(0, 10);
      const t0 = Date.now();
      const results: Json[] = [];
      const taskFieldHist = new Map<string, number>();
      let totalTasks = 0;
      for (const cid of sample) {
        const { bodyText } = await call(`tasks.${cid}`, "GET", `/contacts/${cid}/tasks`);
        const j = parseJson(bodyText) ?? {};
        const list = (j.tasks as Json[]) ?? [];
        totalTasks += list.length;
        for (const t of list) for (const k of Object.keys(t as Json)) taskFieldHist.set(k, (taskFieldHist.get(k) ?? 0) + 1);
        results.push({ contact_id: cid, task_count: list.length });
      }
      const elapsed = Date.now() - t0;
      report.tasks = {
        sampled_contacts: sample.length,
        total_tasks: totalTasks,
        avg_tasks_per_contact: +(totalTasks / sample.length).toFixed(2),
        total_elapsed_ms: elapsed,
        avg_call_ms: Math.round(elapsed / sample.length),
        task_field_presence: Object.fromEntries(taskFieldHist.entries()),
        per_contact: results,
      };
    }
  }

  // ============ Probe: Rate-limit burst on /users/ ============
  {
    const burst = 15;
    const t0 = Date.now();
    const out = await Promise.all(
      Array.from({ length: burst }, () => ghlFetch("GET", `/users/?locationId=${locationId}`, token)),
    );
    const elapsed = Date.now() - t0;
    const statuses = out.map((r) => r.res.status);
    const retryAfters = out.map((r) => r.res.headers.get("Retry-After")).filter(Boolean);
    // Consume bodies
    for (const o of out) await o.bodyText;
    report.rate_limit_probe = {
      burst,
      elapsed_ms: elapsed,
      effective_rps: +(burst / (elapsed / 1000)).toFixed(2),
      statuses,
      throttled_count: statuses.filter((s) => s === 429).length,
      retry_after_values: retryAfters,
      note: "Burst test against /users/. If no 429s seen, real ceiling is above this rate.",
    };
  }

  report._calls = calls;
  report._provisional_recommendations = {
    ai_classification: "If messages.distinct_source contains a value other than {app,api,workflow,campaign,bulk_actions}, that may be the AI marker. Otherwise bucket AI into automation for v1.",
    appointment_showed: "If calendars.distinct_appointment_status contains 'showed' or 'noshow', adopt directly. Otherwise rely on confirmed + endTime<now() + webhooks later.",
    calendar_pagination: "If any per_calendar_results entry has events near a suspiciously round number (e.g. 100/500/1000), suspect undocumented cap and narrow windows further.",
    task_strategy: "If tasks.total_tasks / sampled_contacts is high or avg_call_ms > 250, restrict task sync to a hot-set (in-window contacts only).",
    rate_limit: "If rate_limit_probe.throttled_count = 0, 8 req/s cap is safe. If > 0, lower cap below effective_rps.",
  };

  return new Response(JSON.stringify(report, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});