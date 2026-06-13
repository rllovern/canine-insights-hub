import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  type UIMessage,
} from "npm:ai@6";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible@2";
import { z } from "npm:zod@4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-session-id",
};

const DEBUG = Deno.env.get("JARVIS_DEBUG") === "1";

const SYSTEM_PROMPT = `You are Jarvis, an AI Command Agent for an advertising/CRM analytics platform.

You operate the dashboard on behalf of an authenticated user. NEVER invent numbers. ALWAYS call a tool to get data before answering.

RULES:
- For any analytical question, call the relevant tool(s) first, then answer using only the tool output.
- Behave like a conversational command agent, not a report factory. If the exact ask cannot be answered, say that plainly first, show the lookup/filter reason, and offer concrete next actions instead of producing a polished report that misses the ask.
- For speed-to-lead questions, ALWAYS call get_speed_to_lead_breakdown. Respect the requested metric: if the user asks for average, compute/report average; do not substitute median. For a person name like "Taylor", resolve the name through the tool before saying unavailable. For "forms only", use the tool's lead_type:"form" filter.
- "Taylor" always refers to the human salesperson responding inside GHL (the only real human responder for Ridgeside K9). When a question mentions Taylor without further qualification, set filters.agent_name:"Taylor" on get_speed_to_lead_breakdown. Do NOT treat Taylor as automation, AI, or default-owner-only — always resolve through the GHL user lookup.
- When reporting any speed-to-lead duration to the user (average, median, p75, p90, or per-lead values), ALWAYS format the duration in human-readable units ("Xh Ym Zs", "Ym Zs", or "Zs") — never raw seconds. Use the *_human fields returned by the tool when present.
- When the user asks for speed-to-lead on forms (or any subset), ALWAYS also report the human response rate as a percentage (responded human leads / total matching leads) alongside the duration, using human_response_rate_pct from the tool output.
- If the user asks for "missing CTM leads in GHL", "reconciliation", "leads that didn't make it", etc., call reconcile_ctm_to_ghl, then save_visual_report with a complete report schema, then briefly describe what you found.
- When the user asks for account/property-specific analysis and the request context includes an active propertyId, use that propertyId automatically. Do not ask the user for a property ID if one is present in request context.
- Always include scope (property, date range, sources used) when reporting numbers.
- If a tool returns caveats or data-freshness warnings, surface them.
- If property access is denied, tell the user and stop.
- Keep prose concise — 2-5 sentences. Lead with the answer. Recommend next actions.
- Never claim you took a write action; you only have read+report tools in this phase.

REPORT SCHEMA (when calling save_visual_report):
The 'schema' arg must include type:"report", title, scope, summary_cards, charts, tables, recommendations, evidence.
CHART SHAPE (strict): each chart MUST be { type: "bar"|"line"|"area"|"stacked_bar"|"donut"|"timeline"|"funnel", title, x: "<dataKey>", y: ["<dataKey>", ...], data: [{...}] }.
- Use "x" (string) and "y" (array of strings), NOT "x_key" and NOT "series".
- Every key in "x" and "y" must exist on each row of "data".
TABLE SHAPE (strict): { title, columns: [{ key, label, type?, align? }], rows: [{...}] }. Every column.key must exist on each row. column.type can be "text"|"number"|"currency"|"percent"|"date"|"badge"|"link".

PHASE 2 — also include when available:
- status: { label, severity: "good"|"warning"|"critical"|"neutral", explanation? } — overall report verdict.
- comparison_range: { from, to } when comparing two periods.
- caveats: string[] — data freshness / coverage caveats.
- confidence: { level: "high"|"medium"|"low", explanation } — drives a confidence badge.
- recommendations: each item may include action_type ("open_queue"|"export"|"save_report"|"create_alert_later"|"review_mapping"|"resync_later") and severity ("low"|"medium"|"high"). "create_alert_later" renders as a disabled "Coming in Phase 3" button.
- actions: report-level actions. "create_alert_disabled" must be disabled with disabled_reason "Alerting ships in Phase 3".
- summary_cards may include action_payload. Only include action_payload when there is a real drill-in table/evidence target. For speed-to-lead cards, add drill-ins to matching lead rows, responded rows, never-responded rows, and unavailable diagnostics.
- speed-to-lead reports MUST include a lead-level table with: lead name / phone / email, lead type, created at, assigned/default owner, first human outbound at, first answered inbound at, first human engagement at, response type, response seconds, current stage, tags, GHL link.

REPORT TYPES (use these report_type strings):
- "performance_comparison" — compare two periods
- "lead_performance" — full lead funnel + agents + queues
- "account_stability" — Google Ads volatility / change impact
- "ctm_ghl_reconciliation" — refined CTM↔GHL match report
- "data_quality_audit" — trust / freshness audit
- "client_summary" — client-safe summary (executive tone, no internal blame language)

CLIENT-SAFE MODE: when the user asks for a client/external summary, never use raw debugging terms ("ghl_lead_facts", "stale", "unmatched"); translate to plain business language and preserve caveats professionally. Always lead with wins → risks → what's next.

CLARIFY FIRST when:
- "missing leads" is ambiguous (CTM↔GHL, GHL leads w/o opportunity, leads w/o human response?)
- date range is unspecified and not in context
- multiple report types could satisfy the request

SPEED-TO-LEAD UNAVAILABLE BEHAVIOR:
If get_speed_to_lead_breakdown returns answerable:false, do NOT pretend the report answered the question. Say exactly why, using unavailable_reasons/diagnostics. Offer these next actions as short buttons/choices in prose: Diagnose Taylor mapping, Show form lead records, Show available agent metrics, Create missing tool support.`;

function svc() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function authUser(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const apikeyHeader = req.headers.get("apikey") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (DEBUG) {
    console.log("[Jarvis Edge Auth Debug]", {
      hasAuthHeader: !!authHeader,
      authHeaderStartsBearer: authHeader.startsWith("Bearer "),
      hasApikeyHeader: !!apikeyHeader,
      supabaseHost: supabaseUrl ? new URL(supabaseUrl).host : null,
      hasAnonKey: !!supabaseAnonKey,
      hasServiceRoleKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    });
  }

  if (!token || !authHeader.startsWith("Bearer ")) {
    return { user: null, error: "Missing Authorization Bearer token", detail: null };
  }

  const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser();

  if (DEBUG) {
    console.log("[Jarvis Edge User Debug]", {
      hasUser: !!user,
      userId: user?.id,
      userErrorMessage: userError?.message,
    });
  }

  if (userError || !user) {
    return { user: null, error: "Invalid user session", detail: userError?.message ?? null };
  }
  return { user: { id: user.id }, error: null, detail: null };
}

function normPhone(s: string | null | undefined) {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}
function normEmail(s: string | null | undefined) {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  return t.includes("@") ? t : null;
}

async function assertPropertyAccess(
  supabase: ReturnType<typeof svc>,
  userId: string,
  propertyId: string,
) {
  const { data, error } = await supabase.rpc("user_can_access_property", {
    _user_id: userId,
    _property_id: propertyId,
  });
  if (error) throw new Error(`access check failed: ${error.message}`);
  if (!data) throw new Error("access denied for property");
}

type Ctx = {
  supabase: ReturnType<typeof svc>;
  userSupabase: ReturnType<typeof svc>;
  userId: string;
  sessionId: string;
  defaultPropertyId: string | null;
  defaultFrom: string | null;
  defaultTo: string | null;
};

type ToolPropertyInput = {
  property_id?: string | null;
  propertyId?: string | null;
};

async function logToolRun(
  ctx: Ctx,
  name: string,
  input: unknown,
  output: unknown,
  status: "success" | "error",
  durationMs: number,
  err?: string,
) {
  await ctx.supabase.from("ai_agent_tool_runs").insert({
    session_id: ctx.sessionId,
    tool_name: name,
    input_json: input,
    output_json: output,
    status,
    duration_ms: durationMs,
    error_message: err ?? null,
  });
}

function wrap<I, O>(
  ctx: Ctx,
  name: string,
  fn: (input: I) => Promise<O>,
) {
  return async (input: I) => {
    const start = Date.now();
    try {
      const out = await fn(input);
      await logToolRun(ctx, name, input, out, "success", Date.now() - start);
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logToolRun(ctx, name, input, null, "error", Date.now() - start, msg);
      return { error: msg };
    }
  };
}

function logToolContext(name: string, input: ToolPropertyInput, ctx: Ctx) {
  if (!DEBUG) return;
  console.log("[Jarvis Tool Context]", {
    toolName: name,
    inputPropertyId: input?.property_id ?? input?.propertyId ?? null,
    fallbackPropertyIdFromSession: ctx.defaultPropertyId,
  });
}

function resolveProperty(ctx: Ctx, input?: string | ToolPropertyInput | null, toolName?: string) {
  const raw = typeof input === "string" || input == null
    ? input
    : input.property_id ?? input.propertyId ?? null;
  if (toolName && typeof input !== "string") logToolContext(toolName, input ?? {}, ctx);
  const id = raw ?? ctx.defaultPropertyId;
  if (!id) throw new Error("no property specified and no active property in context");
  return id;
}
function resolveRange(ctx: Ctx, from?: string, to?: string, days?: number) {
  if (from && to) return { from, to };
  if (days) {
    const t = new Date();
    const f = new Date(t.getTime() - days * 86400_000);
    return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) };
  }
  if (ctx.defaultFrom && ctx.defaultTo) {
    return { from: ctx.defaultFrom, to: ctx.defaultTo };
  }
  const t = new Date();
  const f = new Date(t.getTime() - 30 * 86400_000);
  return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) };
}

function secondsBetween(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return null;
  const diff = new Date(a).getTime() - new Date(b).getTime();
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff / 1000)) : null;
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function normText(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function textIncludes(haystack: unknown, needle: unknown) {
  const h = normText(haystack);
  const n = normText(needle);
  return !!h && !!n && h.includes(n);
}

function levenshtein(a: string, b: string) {
  const aa = normText(a);
  const bb = normText(b);
  const dp = Array.from({ length: aa.length + 1 }, (_, i) => [i, ...Array(bb.length).fill(0)]);
  for (let j = 1; j <= bb.length; j++) dp[0][j] = j;
  for (let i = 1; i <= aa.length; i++) {
    for (let j = 1; j <= bb.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (aa[i - 1] === bb[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[aa.length][bb.length];
}

function detectLeadType(contact: Record<string, unknown> | undefined, firstChannel?: string | null) {
  const raw = (contact?.raw ?? {}) as Record<string, unknown>;
  const attr = (raw.attributionSource ?? {}) as Record<string, unknown>;
  const lastAttr = (raw.lastAttributionSource ?? {}) as Record<string, unknown>;
  const hay = [
    contact?.source, firstChannel,
    attr.medium, attr.mediumId, attr.sessionSource, attr.url,
    lastAttr.medium, lastAttr.mediumId, lastAttr.sessionSource, lastAttr.url,
    raw.source, raw.formId, raw.formName, raw.source_event_type,
  ].map((v) => String(v ?? "").toLowerCase()).join(" ");
  if (/external[_\s-]?form|\bform\b|formid|formname|submission/.test(hay)) return "form";
  if (/\bcall\b|phone|type_call/.test(hay)) return "call";
  if (/\bchat\b|webchat/.test(hay)) return "chat";
  if (/\bsms\b|text message/.test(hay)) return "sms";
  return "unknown";
}

function sourceBundle(contact: Record<string, unknown> | undefined) {
  const raw = (contact?.raw ?? {}) as Record<string, unknown>;
  const attr = (raw.attributionSource ?? {}) as Record<string, unknown>;
  const lastAttr = (raw.lastAttributionSource ?? {}) as Record<string, unknown>;
  return [contact?.source, raw.source, attr.medium, attr.mediumId, attr.sessionSource, attr.url, lastAttr.medium, lastAttr.mediumId, lastAttr.sessionSource, lastAttr.url]
    .filter((v) => v != null && String(v).trim() !== "")
    .join(" · ");
}

function buildTools(ctx: Ctx) {
  return {
    get_property_context: tool({
      description:
        "Get the active property's name, connected data sources, and sync freshness. Always call this first when starting a new line of inquiry about a property.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional().describe("Defaults to active dashboard property"),
        propertyId: z.string().uuid().optional().describe("Alias for property_id; defaults to active dashboard property"),
      }),
      execute: wrap(ctx, "get_property_context", async (input) => {
        logToolContext("get_property_context", input, ctx);
        const id = input.property_id ?? input.propertyId ?? ctx.defaultPropertyId;
        if (!id) {
          return {
            ok: false,
            error: "missing_property_id",
            message: "No property selected.",
          };
        }
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const [{ data: p }, { data: srcs }] = await Promise.all([
          ctx.supabase.from("properties").select("id,name,slug,timezone").eq("id", id).maybeSingle(),
          ctx.supabase.from("property_data_sources").select("source,is_connected,last_synced_at").eq("property_id", id),
        ]);
        return { property: p, sources: srcs ?? [] };
      }),
    }),

    get_account_summary: tool({
      description: "Aggregate totals (cost, calls, leads, admissions) by ad source for the date range.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(1).max(365).optional(),
      }),
      execute: wrap(ctx, "get_account_summary", async (i) => {
        const id = resolveProperty(ctx, i.property_id);
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const { data, error } = await ctx.supabase.rpc("ai_assistant_context", {
          _property_id: id, _from: from, _to: to,
        });
        if (error) throw new Error(error.message);
        return { property_id: id, from, to, data };
      }),
    }),

    get_lead_performance_snapshot: tool({
      description: "Speed-to-lead, response stats, and currently waiting leads for a property. Human response means outbound human follow-up; answered inbound calls are reported separately and must not be described as response speed.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        days: z.number().int().min(1).max(180).default(30),
      }),
      execute: wrap(ctx, "get_lead_performance_snapshot", async (i) => {
        const id = resolveProperty(ctx, i.property_id);
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const to = new Date();
        const from = new Date(to.getTime() - i.days * 86400_000);
        const [speed, handling] = await Promise.all([
          ctx.userSupabase.rpc("lead_perf_speed", {
            _property_ids: [id], _from: from.toISOString(), _to: to.toISOString(),
          }),
          ctx.userSupabase.rpc("lead_perf_handling", {
            _property_ids: [id], _from: from.toISOString(), _to: to.toISOString(),
          }),
        ]);
        return { property_id: id, days: i.days, speed: speed.data, handling: handling.data };
      }),
    }),

    get_speed_to_lead_breakdown: tool({
      description:
        "Dedicated command tool for speed-to-lead questions. Resolves agent names/IDs (including default owner), supports form/call/chat/sms/all lead segmentation, computes average/median/p75/p90, and returns lead-level rows plus unavailable diagnostics. Use this for every speed-to-lead question, especially 'average', named agents, or 'forms only'.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(1).max(180).optional(),
        filters: z.object({
          agent_name: z.string().optional(),
          user_name: z.string().optional(),
          agent_user_id: z.string().optional(),
          user_id: z.string().optional(),
          default_owner: z.boolean().optional(),
          lead_type: z.enum(["form", "call", "chat", "sms", "all"]).default("all"),
          source_channel: z.string().optional(),
          assigned_user_id: z.string().optional(),
          responded_only: z.boolean().optional(),
          include_answered_inbound_calls: z.boolean().default(false),
          metric_type: z.enum(["average", "median", "p75", "p90"]).default("average"),
          time_basis: z.enum(["raw", "business_hours"]).default("raw"),
        }).default({}),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      execute: wrap(ctx, "get_speed_to_lead_breakdown", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_speed_to_lead_breakdown");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const fromISO = `${from}T00:00:00Z`;
        const toISO = `${to}T23:59:59Z`;
        const filters = i.filters ?? {};
        const requestedAgent = filters.agent_name ?? filters.user_name ?? filters.agent_user_id ?? filters.user_id ?? filters.assigned_user_id ?? null;

        const [propertyRes, usersRes, factsRes, srcRes] = await Promise.all([
          ctx.supabase.from("properties").select("id,name,default_lead_owner_user_id").eq("id", id).maybeSingle(),
          ctx.supabase.from("ghl_users").select("ghl_user_id,name,email,is_active,raw").eq("property_id", id).limit(1000),
          ctx.supabase.from("ghl_lead_facts").select("contact_id,assigned_user_id,stage_id,canonical_stage,lead_created_at,first_human_outbound_at,first_human_answered_inbound_at,first_human_engagement_at,first_human_engagement_type,first_human_response_channel,human_speed_to_lead_seconds_raw,human_speed_to_lead_seconds_business,human_attempt_count,tag_names,last_synced_at").eq("property_id", id).gte("lead_created_at", fromISO).lte("lead_created_at", toISO).limit(5000),
          ctx.supabase.from("property_data_sources").select("config,last_synced_at").eq("property_id", id).eq("source", "ghl").maybeSingle(),
        ]);
        if (propertyRes.error) throw new Error(propertyRes.error.message);
        if (usersRes.error) throw new Error(usersRes.error.message);
        if (factsRes.error) throw new Error(factsRes.error.message);

        const property = propertyRes.data;
        const facts = (factsRes.data ?? []) as Array<Record<string, unknown>>;
        const users = (usersRes.data ?? []) as Array<Record<string, unknown>>;
        const userById = new Map(users.map((u) => [String(u.ghl_user_id), u]));
        const defaultOwnerId = String(property?.default_lead_owner_user_id ?? "") || null;

        const assignedIds = [...new Set(facts.map((f) => String(f.assigned_user_id ?? "")).filter(Boolean))];
        const contactIds = [...new Set(facts.map((f) => String(f.contact_id ?? "")).filter(Boolean))];
        const [contactsRes, stagesRes, msgUsersRes] = await Promise.all([
          contactIds.length
            ? ctx.supabase.from("ghl_contacts").select("ghl_contact_id,first_name,last_name,email,phone,source,tags,raw").eq("property_id", id).in("ghl_contact_id", contactIds).limit(5000)
            : Promise.resolve({ data: [], error: null }),
          ctx.supabase.from("ghl_pipeline_stages").select("ghl_stage_id,name").eq("property_id", id).limit(1000),
          ctx.supabase.from("ghl_messages").select("ghl_user_id,raw").eq("property_id", id).gte("sent_at", fromISO).lte("sent_at", toISO).not("ghl_user_id", "is", null).limit(1000),
        ]);
        if (contactsRes.error) throw new Error(contactsRes.error.message);
        if (stagesRes.error) throw new Error(stagesRes.error.message);
        if (msgUsersRes.error) throw new Error(msgUsersRes.error.message);

        const contacts = new Map(((contactsRes.data ?? []) as Array<Record<string, unknown>>).map((c) => [String(c.ghl_contact_id), c]));
        const stages = new Map(((stagesRes.data ?? []) as Array<Record<string, unknown>>).map((s) => [String(s.ghl_stage_id), String(s.name ?? "")]));
        const msgUserIds = [...new Set(((msgUsersRes.data ?? []) as Array<Record<string, unknown>>).map((m) => String(m.ghl_user_id ?? "")).filter(Boolean))];

        const candidates = new Map<string, Record<string, unknown>>();
        for (const u of users) candidates.set(String(u.ghl_user_id), { ...u, match_sources: ["ghl_users"] });
        for (const aid of assignedIds) if (!candidates.has(aid)) candidates.set(aid, { ghl_user_id: aid, name: null, email: null, match_sources: ["lead assigned_user_id"] });
        for (const mid of msgUserIds) if (!candidates.has(mid)) candidates.set(mid, { ghl_user_id: mid, name: null, email: null, match_sources: ["message user_id"] });
        if (defaultOwnerId) {
          const prev = candidates.get(defaultOwnerId) ?? { ghl_user_id: defaultOwnerId, name: null, email: null, match_sources: [] };
          candidates.set(defaultOwnerId, { ...prev, is_default_owner: true, match_sources: [...((prev.match_sources as string[]) ?? []), "default property owner"] });
        }

        let resolvedUserId: string | null = filters.assigned_user_id ?? filters.agent_user_id ?? filters.user_id ?? null;
        let agentResolution: Record<string, unknown> | null = null;
        const unavailableReasons: string[] = [];
        if (requestedAgent) {
          const q = normText(requestedAgent);
          const candidateList = [...candidates.values()];
          const exact = candidateList.filter((u) => {
            const uid = normText(u.ghl_user_id);
            const name = normText(u.name);
            const email = normText(u.email);
            const nameTokens = name.split(/\s+/).filter(Boolean);
            return uid === q || email === q || name === q || nameTokens.includes(q);
          });
          const scored = candidateList
            .map((u) => {
              const name = String(u.name ?? u.ghl_user_id ?? "");
              const email = String(u.email ?? "");
              const score = Math.min(levenshtein(q, name), levenshtein(q, email), levenshtein(q, String(u.ghl_user_id ?? "")));
              return { user_id: u.ghl_user_id, name: u.name, email: u.email, is_default_owner: !!u.is_default_owner, score };
            })
            .sort((a, b) => a.score - b.score)
            .slice(0, 5);
          if (exact.length === 1) {
            resolvedUserId = String(exact[0].ghl_user_id);
            agentResolution = { requested: requestedAgent, status: "resolved", matched_user: exact[0], lookup_sources: ["ghl_users.name", "ghl_users.email", "default property owner", "lead assigned_user_id", "message user_id"] };
          } else if (exact.length > 1) {
            unavailableReasons.push(`${requestedAgent} matched multiple GHL users; choose one before calculating speed-to-lead.`);
            agentResolution = { requested: requestedAgent, status: "ambiguous", matches: exact };
          } else {
            unavailableReasons.push(`${requestedAgent} was not found as a GHL user.`);
            agentResolution = { requested: requestedAgent, status: "not_found", message: `${requestedAgent} was not found as a GHL user. Did you mean ${scored[0]?.name ?? scored[0]?.user_id ?? "one of the available users"}?`, suggestions: scored, lookup_sources: ["ghl_users.name", "ghl_users.email", "default property owner", "lead assigned_user_id", "message user_id"] };
          }
        } else if (filters.default_owner && defaultOwnerId) {
          resolvedUserId = defaultOwnerId;
          agentResolution = { requested: "default owner", status: "resolved", matched_user: candidates.get(defaultOwnerId) ?? { ghl_user_id: defaultOwnerId } };
        }

        const decorated = facts.map((f) => {
          const contact = contacts.get(String(f.contact_id ?? ""));
          const assignedId = String(f.assigned_user_id ?? "") || null;
          const effectiveOwnerId = assignedId ?? defaultOwnerId;
          const owner = effectiveOwnerId ? userById.get(effectiveOwnerId) ?? candidates.get(effectiveOwnerId) : null;
          const leadType = detectLeadType(contact, String(f.first_human_response_channel ?? ""));
          const source = sourceBundle(contact);
          const outboundSeconds = filters.time_basis === "business_hours"
            ? (f.human_speed_to_lead_seconds_business == null ? null : Number(f.human_speed_to_lead_seconds_business))
            : (f.human_speed_to_lead_seconds_raw == null ? null : Number(f.human_speed_to_lead_seconds_raw));
          const engagementSeconds = filters.include_answered_inbound_calls
            ? secondsBetween(String(f.first_human_engagement_at ?? ""), String(f.lead_created_at ?? ""))
            : null;
          const responseSeconds = filters.include_answered_inbound_calls ? (engagementSeconds ?? outboundSeconds) : outboundSeconds;
          const responseType = responseSeconds == null ? "none"
            : filters.include_answered_inbound_calls && f.first_human_engagement_type ? String(f.first_human_engagement_type)
            : "outbound_human_follow_up";
          const firstName = String(contact?.first_name ?? "").trim();
          const lastName = String(contact?.last_name ?? "").trim();
          const name = `${firstName} ${lastName}`.trim() || null;
          const locId = ((srcRes.data?.config ?? {}) as Record<string, unknown>).location_id as string | undefined;
          return {
            contact_id: f.contact_id,
            lead_name: name,
            phone: contact?.phone ?? null,
            email: contact?.email ?? null,
            lead_type: leadType,
            source_channel: source,
            created_at: f.lead_created_at,
            assigned_user_id: assignedId,
            default_owner_user_id: defaultOwnerId,
            owner_user_id: effectiveOwnerId,
            owner_name: owner?.name ?? effectiveOwnerId ?? null,
            first_human_outbound_at: f.first_human_outbound_at,
            first_answered_inbound_at: f.first_human_answered_inbound_at,
            first_human_engagement_at: f.first_human_engagement_at,
            response_type: responseType,
            response_seconds: responseSeconds,
            current_stage: stages.get(String(f.stage_id ?? "")) ?? f.canonical_stage ?? null,
            tags: Array.isArray(f.tag_names) ? f.tag_names : [],
            ghl_link: locId && f.contact_id ? `https://app.gohighlevel.com/v2/location/${locId}/contacts/detail/${f.contact_id}` : null,
          };
        });

        const leadTypeCoverage = decorated.filter((r) => r.lead_type !== "unknown").length;
        const formSignals = decorated.filter((r) => r.lead_type === "form").length;
        if (filters.lead_type === "form" && formSignals === 0 && facts.length > 0) {
          unavailableReasons.push("I cannot isolate form leads because form-source tagging is missing.");
        }

        let rows = decorated;
        if (resolvedUserId) rows = rows.filter((r) => filters.assigned_user_id ? r.assigned_user_id === resolvedUserId : r.owner_user_id === resolvedUserId);
        if (filters.default_owner && defaultOwnerId) rows = rows.filter((r) => r.owner_user_id === defaultOwnerId);
        if (filters.lead_type && filters.lead_type !== "all") rows = rows.filter((r) => r.lead_type === filters.lead_type);
        if (filters.source_channel) rows = rows.filter((r) => textIncludes(r.source_channel, filters.source_channel));
        if (filters.responded_only === true) rows = rows.filter((r) => r.response_seconds != null);
        if (filters.responded_only === false) rows = rows.filter((r) => true);

        const responseValues = rows.map((r) => r.response_seconds).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        const total = rows.length;
        const responded = responseValues.length;
        const never = Math.max(0, total - responded);
        const average = responded ? responseValues.reduce((a, b) => a + b, 0) / responded : null;
        const median = percentile(responseValues, 0.5);
        const p75 = percentile(responseValues, 0.75);
        const p90 = percentile(responseValues, 0.9);
        const under = (s: number) => responseValues.filter((v) => v <= s).length;

        const fmtDur = (s: number | null): string | null => {
          if (s == null || !Number.isFinite(Number(s))) return null;
          const n = Math.max(0, Math.round(Number(s)));
          if (n < 60) return `${n}s`;
          if (n < 3600) {
            const m = Math.floor(n / 60);
            const rs = n % 60;
            return rs ? `${m}m ${rs}s` : `${m}m`;
          }
          const h = Math.floor(n / 3600);
          const m = Math.floor((n % 3600) / 60);
          const rs = n % 60;
          const parts = [`${h}h`];
          if (m) parts.push(`${m}m`);
          if (rs) parts.push(`${rs}s`);
          return parts.join(" ");
        };
        const humanResponseRatePct = total > 0 ? (responded / total) * 100 : null;
        const requestedMetricSeconds = filters.metric_type === "median" ? median : filters.metric_type === "p75" ? p75 : filters.metric_type === "p90" ? p90 : average;

        if (requestedAgent && agentResolution?.status === "resolved" && total === 0) {
          unavailableReasons.push(`${requestedAgent} has no matching leads in this date range after filters were applied.`);
        }
        if (total > 0 && responded === 0) unavailableReasons.push("Lead rows exist, but response timestamps are missing for the requested response definition.");
        if (filters.time_basis === "business_hours" && filters.include_answered_inbound_calls) {
          unavailableReasons.push("Business-hours adjustment is only stored for outbound human follow-up; answered inbound calls use raw elapsed time in this breakdown.");
        }

        const answerable = unavailableReasons.length === 0 || (total > 0 && !(requestedAgent && agentResolution?.status !== "resolved") && !(filters.lead_type === "form" && formSignals === 0));
        const dataQualityIssues = [
          filters.lead_type === "form" && formSignals === 0 ? { issue: "Form-source tagging unavailable", severity: "critical", detail: "No reliable form markers were found in contact source or attribution metadata for this window." } : null,
          leadTypeCoverage < decorated.length ? { issue: "Some leads have unknown lead type", severity: "warning", detail: `${decorated.length - leadTypeCoverage} of ${decorated.length} leads lack clear source/channel tagging.` } : null,
        ].filter(Boolean);

        return {
          answerable,
          property_id: id,
          property_name: property?.name ?? null,
          from,
          to,
          filters: { ...filters, resolved_user_id: resolvedUserId },
          agent_resolution: agentResolution,
          total_matching_leads: total,
          responded_leads: responded,
          never_responded: never,
          average_speed_to_lead_seconds: average,
          median_speed_to_lead_seconds: median,
          p75_speed_to_lead_seconds: p75,
          p90_speed_to_lead_seconds: p90,
          average_speed_to_lead_human: fmtDur(average),
          median_speed_to_lead_human: fmtDur(median),
          p75_speed_to_lead_human: fmtDur(p75),
          p90_speed_to_lead_human: fmtDur(p90),
          human_response_rate_pct: humanResponseRatePct,
          human_response_rate_label: humanResponseRatePct == null ? null : `${humanResponseRatePct.toFixed(1)}%`,
          under_1_min: under(60),
          under_5_min: under(300),
          under_15_min: under(900),
          requested_metric_type: filters.metric_type ?? "average",
          requested_metric_value_seconds: requestedMetricSeconds,
          requested_metric_value_human: fmtDur(requestedMetricSeconds),
          response_definition: filters.include_answered_inbound_calls ? "first human engagement: outbound human follow-up or answered inbound call" : "first outbound human follow-up only",
          time_basis: filters.time_basis ?? "raw",
          lead_level_rows: rows.slice(0, i.limit),
          row_count_returned: Math.min(rows.length, i.limit),
          caveats: [
            rows.length > i.limit ? `Lead rows capped at ${i.limit}.` : null,
            facts.length === 5000 ? "Source facts capped at 5000 rows; narrow the date range for exhaustive analysis." : null,
            average != null ? "Average can be skewed by outliers; median and p75/p90 are included for context." : null,
          ].filter(Boolean),
          unavailable_reasons: unavailableReasons,
          diagnostics: {
            data_quality_issues: dataQualityIssues,
            lead_type_counts: decorated.reduce((acc, r) => ({ ...acc, [r.lead_type]: ((acc as Record<string, number>)[r.lead_type] ?? 0) + 1 }), {} as Record<string, number>),
            available_agents: [...candidates.values()].map((u) => ({ user_id: u.ghl_user_id, name: u.name, email: u.email, is_default_owner: !!u.is_default_owner })).slice(0, 100),
            possible_unavailable_reasons_checked: [
              "person not found in GHL users/default owner/assigned user IDs/message user IDs",
              "person has no assigned/default-owned leads in the date range",
              "form leads cannot be identified",
              "lead rows exist but response timestamps are missing",
            ],
          },
          confidence: {
            level: !answerable ? "low" : dataQualityIssues.length ? "medium" : "high",
            explanation: !answerable ? unavailableReasons.join(" ") : dataQualityIssues.length ? "Some lead source tagging is incomplete." : "Computed from lead-level CRM facts and contact attribution metadata.",
          },
          sources_used: ["ghl_lead_facts", "ghl_contacts", "ghl_users", "ghl_messages", "ghl_pipeline_stages"],
          sync_freshness: { ghl: srcRes.data?.last_synced_at ?? null },
        };
      }),
    }),

    get_account_stability: tool({
      description: "Recent daily metrics (spend, leads) to gauge whether the account looks stable.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        days: z.number().int().min(7).max(90).default(30),
      }),
      execute: wrap(ctx, "get_account_stability", async (i) => {
        const id = resolveProperty(ctx, i.property_id);
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const to = new Date();
        const from = new Date(to.getTime() - i.days * 86400_000);
        const { data, error } = await ctx.supabase
          .from("daily_metrics")
          .select("date,ad_source,cost,clicks,impressions,record_count,good_leads")
          .eq("property_id", id)
          .gte("date", from.toISOString().slice(0, 10))
          .lte("date", to.toISOString().slice(0, 10))
          .order("date");
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        const byDate = new Map<string, { cost: number; clicks: number; impressions: number; calls: number; good_leads: number }>();
        const bySource = new Map<string, { cost: number; clicks: number; impressions: number; calls: number; good_leads: number }>();
        for (const r of rows) {
          const date = r.date;
          const source = r.ad_source ?? "Unknown";
          const add = (bucket: { cost: number; clicks: number; impressions: number; calls: number; good_leads: number }) => {
            bucket.cost += Number(r.cost ?? 0);
            bucket.clicks += Number(r.clicks ?? 0);
            bucket.impressions += Number(r.impressions ?? 0);
            bucket.calls += Number(r.record_count ?? 0);
            bucket.good_leads += Number(r.good_leads ?? 0);
          };
          if (!byDate.has(date)) byDate.set(date, { cost: 0, clicks: 0, impressions: 0, calls: 0, good_leads: 0 });
          if (!bySource.has(source)) bySource.set(source, { cost: 0, clicks: 0, impressions: 0, calls: 0, good_leads: 0 });
          add(byDate.get(date)!);
          add(bySource.get(source)!);
        }
        const daily = [...byDate.entries()].map(([date, v]) => ({ date, ...v }));
        const totals = daily.reduce((a, r) => ({
          cost: a.cost + r.cost,
          clicks: a.clicks + r.clicks,
          impressions: a.impressions + r.impressions,
          calls: a.calls + r.calls,
          good_leads: a.good_leads + r.good_leads,
        }), { cost: 0, clicks: 0, impressions: 0, calls: 0, good_leads: 0 });
        return {
          property_id: id,
          days: i.days,
          row_count: rows.length,
          totals,
          by_source: [...bySource.entries()].map(([source, v]) => ({ source, ...v })),
          daily,
        };
      }),
    }),

    reconcile_ctm_to_ghl: tool({
      description:
        "Reconcile CTM calls against GHL contacts/messages/lead_facts/opportunities. Phone-or-email identity match, ±15min strong activity, same-day loose activity. Returns full classification.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        propertyId: z.string().uuid().optional(),
        days: z.number().int().min(1).max(90).default(7),
      }),
      execute: wrap(ctx, "reconcile_ctm_to_ghl", async (i) => {
        logToolContext("reconcile_ctm_to_ghl", i, ctx);
        const id = i.property_id ?? i.propertyId ?? ctx.defaultPropertyId;
        if (!id) {
          return {
            ok: false,
            error: "missing_property_id",
            message: "No property selected.",
          };
        }
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const cpuStart = Date.now();
        const CPU_BUDGET_MS = 8000;
        const toD = new Date();
        const fromD = new Date(toD.getTime() - i.days * 86400_000);
        const fromISO = fromD.toISOString();
        const toISO = toD.toISOString();

        const [ctmRes, ctSrc, gaSrc, contactsRes, factsRes, oppsRes] = await Promise.all([
          ctx.supabase.from("ctm_calls")
            .select("id,ctm_call_id,called_at,caller_number,campaign_name,channel,tracking_source,raw_payload")
            .eq("property_id", id).gte("called_at", fromISO).lte("called_at", toISO)
            .order("called_at", { ascending: false }).limit(1000),
          ctx.supabase.from("property_data_sources")
            .select("last_synced_at").eq("property_id", id).eq("source", "ctm").maybeSingle(),
          ctx.supabase.from("property_data_sources")
            .select("last_synced_at").eq("property_id", id).eq("source", "ghl").maybeSingle(),
          ctx.supabase.from("ghl_contacts")
            .select("ghl_contact_id,first_name,last_name,phone,email,ghl_created_at")
            .eq("property_id", id).limit(10000),
          ctx.supabase.from("ghl_lead_facts")
            .select("contact_id,lead_created_at,canonical_stage")
            .eq("property_id", id).gte("lead_created_at", fromISO).lte("lead_created_at", toISO).limit(5000),
          ctx.supabase.from("ghl_opportunities")
            .select("contact_id,ghl_created_at,status")
            .eq("property_id", id).gte("ghl_created_at", fromISO).lte("ghl_created_at", toISO).limit(5000),
        ]);

        if (ctmRes.error) throw new Error(ctmRes.error.message);
        if (contactsRes.error) throw new Error(contactsRes.error.message);

        const ctmCalls = ctmRes.data ?? [];
        const contacts = contactsRes.data ?? [];
        const facts = factsRes.data ?? [];
        const opps = oppsRes.data ?? [];

        // Index GHL contacts by phone and email.
        const byPhone = new Map<string, typeof contacts>();
        const byEmail = new Map<string, typeof contacts>();
        for (const c of contacts) {
          const p = normPhone(c.phone);
          const e = normEmail(c.email);
          if (p) { const arr = byPhone.get(p) ?? []; arr.push(c); byPhone.set(p, arr); }
          if (e) { const arr = byEmail.get(e) ?? []; arr.push(c); byEmail.set(e, arr); }
        }
        const factsByContact = new Map<string, typeof facts>();
        for (const f of facts) {
          if (!f.contact_id) continue;
          const arr = factsByContact.get(f.contact_id) ?? []; arr.push(f); factsByContact.set(f.contact_id, arr);
        }
        const oppsByContact = new Map<string, typeof opps>();
        for (const o of opps) {
          if (!o.contact_id) continue;
          const arr = oppsByContact.get(o.contact_id) ?? []; arr.push(o); oppsByContact.set(o.contact_id, arr);
        }

        // Identify candidate contact_ids for messages query.
        const candidateContactIds = new Set<string>();
        for (const call of ctmCalls) {
          const p = normPhone(call.caller_number);
          const e = normEmail((call.raw_payload as Record<string, unknown> | null)?.["caller_email"] as string | undefined);
          for (const m of [...(p ? byPhone.get(p) ?? [] : []), ...(e ? byEmail.get(e) ?? [] : [])]) {
            candidateContactIds.add(m.ghl_contact_id);
          }
        }

        // Pull GHL messages for those contacts in window (cap aggressively).
        const msgsByContact = new Map<string, { ts: number; day: string; direction: string | null }[]>();
        if (candidateContactIds.size > 0) {
          const ids = Array.from(candidateContactIds).slice(0, 5000);
          const { data: msgs } = await ctx.supabase.from("ghl_messages")
            .select("contact_id,sent_at,direction")
            .eq("property_id", id).in("contact_id", ids)
            .gte("sent_at", fromISO).lte("sent_at", toISO).limit(10000);
          for (const m of msgs ?? []) {
            if (!m.contact_id || !m.sent_at) continue;
            const ts = new Date(m.sent_at).getTime();
            if (Number.isNaN(ts)) continue;
            const arr = msgsByContact.get(m.contact_id) ?? [];
            arr.push({ ts, day: m.sent_at.slice(0, 10), direction: m.direction });
            msgsByContact.set(m.contact_id, arr);
          }
        }

        type Cls = "unmatchable" | "missing" | "contact_only" | "activity_loose" | "activity_strong" | "lead_fact" | "opportunity";
        const classified: Array<{
          ctm_call_id: string; called_at: string; caller_number: string | null;
          campaign_name: string | null; channel: string | null; tracking_source: string | null;
          classification: Cls; matched_contact_id: string | null; reason: string;
        }> = [];
        let stoppedEarly = 0;

        for (let ci = 0; ci < ctmCalls.length; ci++) {
          if (Date.now() - cpuStart > CPU_BUDGET_MS) {
            stoppedEarly = ctmCalls.length - ci;
            break;
          }
          const call = ctmCalls[ci];
          const p = normPhone(call.caller_number);
          const e = normEmail((call.raw_payload as Record<string, unknown> | null)?.["caller_email"] as string | undefined);
          if (!p && !e) {
            classified.push({
              ctm_call_id: call.ctm_call_id, called_at: call.called_at,
              caller_number: call.caller_number, campaign_name: call.campaign_name,
              channel: call.channel, tracking_source: call.tracking_source,
              classification: "unmatchable", matched_contact_id: null,
              reason: "CTM record has no phone or email to match on",
            });
            continue;
          }
          const candidates = [...(p ? byPhone.get(p) ?? [] : []), ...(e ? byEmail.get(e) ?? [] : [])];
          if (candidates.length === 0) {
            classified.push({
              ctm_call_id: call.ctm_call_id, called_at: call.called_at,
              caller_number: call.caller_number, campaign_name: call.campaign_name,
              channel: call.channel, tracking_source: call.tracking_source,
              classification: "missing", matched_contact_id: null,
              reason: "No GHL contact found with matching phone or email",
            });
            continue;
          }

          let best: { cls: Cls; cid: string; reason: string } | null = null;
          const rank: Record<Cls, number> = {
            unmatchable: 0, missing: 1, contact_only: 2,
            activity_loose: 3, activity_strong: 4, lead_fact: 5, opportunity: 6,
          };
          const callTs = new Date(call.called_at).getTime();
          const callDay = call.called_at.slice(0, 10);

          for (const cand of candidates) {
            const cid = cand.ghl_contact_id;
            let cls: Cls = "contact_only";
            let reason = "Matched GHL contact, no in-window activity";

            if ((oppsByContact.get(cid) ?? []).length > 0) {
              cls = "opportunity"; reason = "GHL opportunity created in window";
            } else if ((factsByContact.get(cid) ?? []).length > 0) {
              cls = "lead_fact"; reason = "GHL lead_fact present in window";
            } else {
              const msgs = msgsByContact.get(cid) ?? [];
              if (msgs.length > 0) {
                let strong = false; let sameDay = false;
                for (const m of msgs) {
                  if (!strong && Math.abs(m.ts - callTs) <= 15 * 60_000) strong = true;
                  if (!sameDay && m.day === callDay) sameDay = true;
                  if (strong && sameDay) break;
                }
                if (strong) { cls = "activity_strong"; reason = "GHL message within ±15 minutes of CTM call"; }
                else if (sameDay) { cls = "activity_loose"; reason = "GHL message same day as CTM call"; }
                else { cls = "contact_only"; reason = "Matched contact, but activity is outside the call's day"; }
              }
            }
            if (!best || rank[cls] > rank[best.cls]) best = { cls, cid, reason };
            if (best.cls === "opportunity") break;
          }

          classified.push({
            ctm_call_id: call.ctm_call_id, called_at: call.called_at,
            caller_number: call.caller_number, campaign_name: call.campaign_name,
            channel: call.channel, tracking_source: call.tracking_source,
            classification: best!.cls, matched_contact_id: best!.cid, reason: best!.reason,
          });
        }

        const counts: Record<string, number> = {
          unmatchable: 0, missing: 0, contact_only: 0,
          activity_loose: 0, activity_strong: 0, lead_fact: 0, opportunity: 0,
        };
        const byDay = new Map<string, { date: string; ctm: number; matched: number }>();
        const missingBySource = new Map<string, number>();
        for (const r of classified) {
          counts[r.classification]++;
          const day = r.called_at.slice(0, 10);
          const d = byDay.get(day) ?? { date: day, ctm: 0, matched: 0 };
          d.ctm++;
          if (["activity_strong", "activity_loose", "lead_fact", "opportunity"].includes(r.classification)) d.matched++;
          byDay.set(day, d);
          if (r.classification === "missing" || r.classification === "contact_only" || r.classification === "unmatchable") {
            const k = r.campaign_name || r.tracking_source || r.channel || "(unknown)";
            missingBySource.set(k, (missingBySource.get(k) ?? 0) + 1);
          }
        }
        const matched = counts.activity_strong + counts.activity_loose + counts.lead_fact + counts.opportunity;
        const total = classified.length;
        const matchRate = total > 0 ? matched / total : 0;

        return {
          property_id: id,
          from: fromISO, to: toISO, days: i.days,
          totals: { ctm_total: total, matched, ...counts, match_rate: matchRate },
          daily: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
          missing_by_source: Array.from(missingBySource.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
          missing_rows: classified
            .filter(r => r.classification === "missing" || r.classification === "contact_only" || r.classification === "unmatchable")
            .slice(0, 200),
          sources_used: ["ctm_calls", "ghl_contacts", "ghl_messages", "ghl_lead_facts", "ghl_opportunities"],
          sync_freshness: {
            ctm: ctSrc.data?.last_synced_at ?? null,
            ghl: gaSrc.data?.last_synced_at ?? null,
          },
          matching_method: "phone-or-email exact (normalized); ±15min strong, same-day loose for activity",
          caveats: [
            ctmCalls.length >= 1000 ? "CTM result capped at 1000 calls in window" : null,
            contacts.length >= 10000 ? "ghl_contacts capped at 10000; try a narrower window" : null,
            facts.length >= 5000 ? "ghl_lead_facts capped at 5000" : null,
            opps.length >= 5000 ? "ghl_opportunities capped at 5000" : null,
            stoppedEarly > 0 ? `Partial result: stopped after ${classified.length} of ${ctmCalls.length} calls due to compute budget. Try a smaller 'days' value.` : null,
          ].filter(Boolean),
        };
      }),
    }),

    compare_periods: tool({
      description:
        "Compare two date ranges on the same property: spend, clicks, impressions, CTR, CPC, leads, CPL, conversion rate, CTM calls, GHL leads. Returns deltas, campaign breakdown, and daily trends. Use for 'this month vs last month', 'why are leads down', performance-comparison reports.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        current_from: z.string(),
        current_to: z.string(),
        previous_from: z.string(),
        previous_to: z.string(),
        campaign: z.string().optional(),
      }),
      execute: wrap(ctx, "compare_periods", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "compare_periods");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const fetchRange = async (from: string, to: string) => {
          let q = ctx.supabase.from("daily_metrics")
            .select("date,ad_source,campaign,cost,impressions,clicks,record_count,leads,good_leads,admissions")
            .eq("property_id", id).gte("date", from).lte("date", to);
          if (i.campaign) q = q.eq("campaign", i.campaign);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          return data ?? [];
        };
        const [cur, prev] = await Promise.all([
          fetchRange(i.current_from, i.current_to),
          fetchRange(i.previous_from, i.previous_to),
        ]);
        const totals = (rows: typeof cur) => {
          const t = { cost: 0, impressions: 0, clicks: 0, calls: 0, leads: 0, good_leads: 0, admissions: 0 };
          for (const r of rows) {
            t.cost += Number(r.cost ?? 0);
            t.impressions += Number(r.impressions ?? 0);
            t.clicks += Number(r.clicks ?? 0);
            t.calls += Number(r.record_count ?? 0);
            t.leads += Number(r.leads ?? 0);
            t.good_leads += Number(r.good_leads ?? 0);
            t.admissions += Number(r.admissions ?? 0);
          }
          return t;
        };
        const derive = (t: ReturnType<typeof totals>) => ({
          ...t,
          ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
          cpc: t.clicks > 0 ? t.cost / t.clicks : 0,
          cpl: t.leads > 0 ? t.cost / t.leads : 0,
          conv_rate: t.clicks > 0 ? t.leads / t.clicks : 0,
        });
        const c = derive(totals(cur));
        const p = derive(totals(prev));
        const delta = (a: number, b: number) => ({ abs: a - b, pct: b !== 0 ? (a - b) / b : null });
        const metrics = {
          cost: { current: c.cost, previous: p.cost, ...delta(c.cost, p.cost) },
          impressions: { current: c.impressions, previous: p.impressions, ...delta(c.impressions, p.impressions) },
          clicks: { current: c.clicks, previous: p.clicks, ...delta(c.clicks, p.clicks) },
          ctr: { current: c.ctr, previous: p.ctr, ...delta(c.ctr, p.ctr) },
          cpc: { current: c.cpc, previous: p.cpc, ...delta(c.cpc, p.cpc) },
          calls: { current: c.calls, previous: p.calls, ...delta(c.calls, p.calls) },
          leads: { current: c.leads, previous: p.leads, ...delta(c.leads, p.leads) },
          good_leads: { current: c.good_leads, previous: p.good_leads, ...delta(c.good_leads, p.good_leads) },
          cpl: { current: c.cpl, previous: p.cpl, ...delta(c.cpl, p.cpl) },
          conv_rate: { current: c.conv_rate, previous: p.conv_rate, ...delta(c.conv_rate, p.conv_rate) },
          admissions: { current: c.admissions, previous: p.admissions, ...delta(c.admissions, p.admissions) },
        };
        const byCampaign = new Map<string, { current: ReturnType<typeof totals>; previous: ReturnType<typeof totals> }>();
        for (const r of cur) {
          const k = r.campaign || r.ad_source || "(unknown)";
          const e = byCampaign.get(k) ?? { current: totals([]), previous: totals([]) };
          e.current = totals([...cur.filter(x => (x.campaign || x.ad_source) === k)]);
          byCampaign.set(k, e);
        }
        for (const r of prev) {
          const k = r.campaign || r.ad_source || "(unknown)";
          const e = byCampaign.get(k) ?? { current: totals([]), previous: totals([]) };
          e.previous = totals([...prev.filter(x => (x.campaign || x.ad_source) === k)]);
          byCampaign.set(k, e);
        }
        const campaign_breakdown = [...byCampaign.entries()].map(([campaign, v]) => ({
          campaign,
          spend_current: v.current.cost, spend_previous: v.previous.cost,
          leads_current: v.current.leads, leads_previous: v.previous.leads,
          cpl_current: v.current.leads > 0 ? v.current.cost / v.current.leads : 0,
          cpl_previous: v.previous.leads > 0 ? v.previous.cost / v.previous.leads : 0,
          spend_delta_pct: v.previous.cost > 0 ? (v.current.cost - v.previous.cost) / v.previous.cost : null,
          leads_delta_pct: v.previous.leads > 0 ? (v.current.leads - v.previous.leads) / v.previous.leads : null,
        })).sort((a, b) => b.spend_current - a.spend_current).slice(0, 50);
        const dailyMap = new Map<string, { date: string; cost: number; leads: number }>();
        for (const r of cur) {
          const d = dailyMap.get(r.date) ?? { date: r.date, cost: 0, leads: 0 };
          d.cost += Number(r.cost ?? 0); d.leads += Number(r.leads ?? 0);
          dailyMap.set(r.date, d);
        }
        const daily_current = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
        return {
          property_id: id,
          current_range: { from: i.current_from, to: i.current_to },
          previous_range: { from: i.previous_from, to: i.previous_to },
          metrics, campaign_breakdown, daily_current,
          sources_used: ["daily_metrics"],
          caveats: cur.length === 0 ? ["No daily_metrics rows for current period"] :
                   prev.length === 0 ? ["No daily_metrics rows for previous period — deltas vs zero baseline"] : [],
        };
      }),
    }),

    get_google_ads_performance: tool({
      description:
        "Google Ads (or all-source) performance over a window: spend, impressions, clicks, CTR, CPC, leads, CPL, conversion rate, by-campaign breakdown, daily trend.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(1).max(365).optional(),
        campaign: z.string().optional(),
        ad_source: z.string().optional().describe("e.g. 'google_ads'. Omit to include all sources."),
      }),
      execute: wrap(ctx, "get_google_ads_performance", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_google_ads_performance");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        let q = ctx.supabase.from("daily_metrics")
          .select("date,ad_source,campaign,cost,impressions,clicks,record_count,leads,good_leads,admissions")
          .eq("property_id", id).gte("date", from).lte("date", to);
        if (i.ad_source) q = q.eq("ad_source", i.ad_source);
        if (i.campaign) q = q.eq("campaign", i.campaign);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        const tot = { cost: 0, impressions: 0, clicks: 0, leads: 0, good_leads: 0, admissions: 0 };
        const byCampaign = new Map<string, { campaign: string; cost: number; clicks: number; impressions: number; leads: number }>();
        const byDate = new Map<string, { date: string; cost: number; clicks: number; leads: number }>();
        for (const r of rows) {
          tot.cost += Number(r.cost ?? 0); tot.impressions += Number(r.impressions ?? 0);
          tot.clicks += Number(r.clicks ?? 0); tot.leads += Number(r.leads ?? 0);
          tot.good_leads += Number(r.good_leads ?? 0); tot.admissions += Number(r.admissions ?? 0);
          const ck = r.campaign || "(unknown)";
          const c = byCampaign.get(ck) ?? { campaign: ck, cost: 0, clicks: 0, impressions: 0, leads: 0 };
          c.cost += Number(r.cost ?? 0); c.clicks += Number(r.clicks ?? 0);
          c.impressions += Number(r.impressions ?? 0); c.leads += Number(r.leads ?? 0);
          byCampaign.set(ck, c);
          const d = byDate.get(r.date) ?? { date: r.date, cost: 0, clicks: 0, leads: 0 };
          d.cost += Number(r.cost ?? 0); d.clicks += Number(r.clicks ?? 0); d.leads += Number(r.leads ?? 0);
          byDate.set(r.date, d);
        }
        return {
          property_id: id, from, to,
          totals: {
            ...tot,
            ctr: tot.impressions > 0 ? tot.clicks / tot.impressions : 0,
            cpc: tot.clicks > 0 ? tot.cost / tot.clicks : 0,
            cpl: tot.leads > 0 ? tot.cost / tot.leads : 0,
            conv_rate: tot.clicks > 0 ? tot.leads / tot.clicks : 0,
          },
          campaigns: [...byCampaign.values()]
            .map(c => ({ ...c, cpl: c.leads > 0 ? c.cost / c.leads : 0, ctr: c.impressions > 0 ? c.clicks / c.impressions : 0 }))
            .sort((a, b) => b.cost - a.cost),
          daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
          sources_used: ["daily_metrics"],
          caveats: rows.length === 0 ? ["No metrics rows in window"] : [],
        };
      }),
    }),

    get_google_ads_change_impact: tool({
      description:
        "Estimate account stability from spend/lead volatility on daily_metrics. Returns volatility score, daily timeline, and a stabilization heuristic. NOTE: This is an internal volatility estimate, NOT official Google learning-phase status.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(7).max(90).default(30),
      }),
      execute: wrap(ctx, "get_google_ads_change_impact", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_google_ads_change_impact");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const { data, error } = await ctx.supabase.from("daily_metrics")
          .select("date,ad_source,campaign,cost,clicks,leads")
          .eq("property_id", id).gte("date", from).lte("date", to).order("date");
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        const byDate = new Map<string, { date: string; cost: number; leads: number; clicks: number }>();
        for (const r of rows) {
          const d = byDate.get(r.date) ?? { date: r.date, cost: 0, leads: 0, clicks: 0 };
          d.cost += Number(r.cost ?? 0); d.leads += Number(r.leads ?? 0); d.clicks += Number(r.clicks ?? 0);
          byDate.set(r.date, d);
        }
        const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
        const std = (xs: number[]) => {
          const m = mean(xs); if (!xs.length) return 0;
          return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
        };
        const costs = daily.map(d => d.cost);
        const leads = daily.map(d => d.leads);
        const costMean = mean(costs); const costStd = std(costs);
        const cv = costMean > 0 ? costStd / costMean : 0;
        let severity: "good" | "warning" | "critical" | "neutral" = "good";
        if (cv > 0.6) severity = "critical";
        else if (cv > 0.35) severity = "warning";
        else if (cv > 0) severity = "good";
        else severity = "neutral";
        const recentMean = mean(costs.slice(-7));
        const priorMean = mean(costs.slice(0, -7));
        const spendShift = priorMean > 0 ? (recentMean - priorMean) / priorMean : 0;
        const structuralChange = Math.abs(spendShift) > 0.3;
        return {
          property_id: id, from, to,
          volatility_score: cv,
          severity,
          structural_change_detected: structuralChange,
          spend_shift_pct_last_7d_vs_prior: spendShift,
          totals: { cost: costs.reduce((a, b) => a + b, 0), leads: leads.reduce((a, b) => a + b, 0) },
          daily,
          stabilization_window_days: 14,
          stabilization_estimate: severity === "critical" || structuralChange
            ? "Volatility elevated — recommend ~14 days of stability before further optimization."
            : severity === "warning"
            ? "Moderate volatility — partial review possible; avoid stacked changes."
            : "Account looks stable — safe to review optimizations.",
          sources_used: ["daily_metrics"],
          caveats: [
            "Stabilization estimate is an internal volatility heuristic, not official Google Ads learning-phase status.",
            rows.length === 0 ? "No daily_metrics rows in window." : null,
          ].filter(Boolean),
        };
      }),
    }),

    get_lead_performance_report: tool({
      description:
        "Full Lead Performance state: speed-to-lead, handling, pipeline conversion, agents, data quality. Human response means outbound human follow-up; answered inbound calls are reported separately and must not be described as response speed.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        days: z.number().int().min(1).max(180).default(30),
      }),
      execute: wrap(ctx, "get_lead_performance_report", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_lead_performance_report");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const to = new Date();
        const from = new Date(to.getTime() - i.days * 86400_000);
        const args = { _property_ids: [id], _from: from.toISOString(), _to: to.toISOString() };
        const [speed, handling, pipeline, agents, quality] = await Promise.all([
          ctx.userSupabase.rpc("lead_perf_speed", args),
          ctx.userSupabase.rpc("lead_perf_handling", args),
          ctx.userSupabase.rpc("lead_perf_pipeline", args),
          ctx.userSupabase.rpc("lead_perf_agents", args),
          ctx.userSupabase.rpc("lead_perf_quality", args),
        ]);
        const { data: ghlSrc } = await ctx.supabase.from("property_data_sources")
          .select("last_synced_at").eq("property_id", id).eq("source", "ghl").maybeSingle();
        return {
          property_id: id,
          days: i.days,
          speed: speed.data, handling: handling.data, pipeline: pipeline.data,
          agents: agents.data, quality: quality.data,
          sources_used: ["ghl_lead_facts", "ghl_contacts", "ghl_messages", "ghl_appointments"],
          sync_freshness: { ghl: ghlSrc?.last_synced_at ?? null },
          caveats: [
            speed.error?.message, handling.error?.message, pipeline.error?.message,
            agents.error?.message, quality.error?.message,
          ].filter(Boolean),
        };
      }),
    }),

    get_action_queue_summary: tool({
      description:
        "Summarize one actionable lead queue (counts, oldest age, top records with reasons and GHL deep links).",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        days: z.number().int().min(1).max(180).default(30),
        queue_type: z.enum([
          "never_responded", "currently_waiting", "stale", "critical_stale",
          "unassigned", "missing_opportunity", "lost_without_reason",
          "slow_response", "disqualified_by_tag", "duplicate_contacts",
          "duplicate_opportunities", "unknown_response_source",
        ]).default("currently_waiting"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: wrap(ctx, "get_action_queue_summary", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_action_queue_summary");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const to = new Date();
        const from = new Date(to.getTime() - i.days * 86400_000);
        const { data, error } = await ctx.userSupabase.rpc("lead_perf_drill", {
          _issue_type: i.queue_type, _property_ids: [id],
          _from: from.toISOString(), _to: to.toISOString(), _limit: i.limit,
        });
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        const oldest = rows.reduce((acc, r) => {
          const t = r.lead_created_at ? new Date(r.lead_created_at as string).getTime() : 0;
          return t && (!acc || t < acc) ? t : acc;
        }, 0);
        return {
          property_id: id,
          queue_type: i.queue_type,
          count: rows.length,
          oldest_lead_at: oldest ? new Date(oldest).toISOString() : null,
          oldest_age_hours: oldest ? Math.round((Date.now() - oldest) / 3600_000) : null,
          rows: rows.slice(0, i.limit),
          sources_used: ["lead_perf_drill"],
          caveats: rows.length === i.limit ? [`Result capped at ${i.limit}`] : [],
        };
      }),
    }),

    get_ctm_performance: tool({
      description:
        "CTM call performance: total/answered/missed calls, good/bad leads, disposition + source breakdown, daily trend, avg duration.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(1).max(180).optional(),
      }),
      execute: wrap(ctx, "get_ctm_performance", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_ctm_performance");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const fromISO = `${from}T00:00:00Z`; const toISO = `${to}T23:59:59Z`;
        const [callsRes, srcRes] = await Promise.all([
          ctx.supabase.from("ctm_calls")
            .select("ctm_call_id,called_at,caller_number,campaign_name,channel,tracking_source,raw_payload")
            .eq("property_id", id).gte("called_at", fromISO).lte("called_at", toISO).limit(5000),
          ctx.supabase.from("property_data_sources")
            .select("last_synced_at").eq("property_id", id).eq("source", "ctm").maybeSingle(),
        ]);
        if (callsRes.error) throw new Error(callsRes.error.message);
        const calls = callsRes.data ?? [];
        const uniquePhones = new Set<string>();
        const bySource = new Map<string, number>();
        const byDisposition = new Map<string, number>();
        const byDate = new Map<string, { date: string; calls: number }>();
        let answered = 0, missed = 0, durSum = 0, durCount = 0;
        let good = 0, bad = 0;
        for (const c of calls) {
          const p = normPhone(c.caller_number); if (p) uniquePhones.add(p);
          const raw = (c.raw_payload ?? {}) as Record<string, unknown>;
          const status = String(raw["call_status"] ?? raw["status"] ?? "").toLowerCase();
          if (["completed", "answered"].includes(status)) answered++;
          else if (["missed", "no-answer", "voicemail", "busy", "failed"].includes(status)) missed++;
          const dur = Number(raw["duration"] ?? raw["call_duration"] ?? 0);
          if (dur > 0) { durSum += dur; durCount++; }
          const score = String(raw["score"] ?? raw["call_score"] ?? "").toLowerCase();
          if (score === "good") good++; else if (score === "bad" || score === "spam") bad++;
          const k = c.campaign_name || c.tracking_source || c.channel || "(unknown)";
          bySource.set(k, (bySource.get(k) ?? 0) + 1);
          const disp = String(raw["disposition"] ?? raw["call_disposition"] ?? "uncategorized").toLowerCase();
          byDisposition.set(disp, (byDisposition.get(disp) ?? 0) + 1);
          const day = c.called_at.slice(0, 10);
          const d = byDate.get(day) ?? { date: day, calls: 0 }; d.calls++; byDate.set(day, d);
        }
        return {
          property_id: id, from, to,
          totals: {
            total_calls: calls.length,
            unique_leads: uniquePhones.size,
            answered, missed,
            good_leads: good, bad_leads: bad,
            avg_duration_seconds: durCount > 0 ? Math.round(durSum / durCount) : null,
          },
          dispositions: [...byDisposition.entries()].map(([disposition, count]) => ({ disposition, count })).sort((a, b) => b.count - a.count),
          sources: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
          daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
          sources_used: ["ctm_calls"],
          sync_freshness: { ctm: srcRes.data?.last_synced_at ?? null },
          caveats: [
            calls.length >= 5000 ? "CTM result capped at 5000 calls" : null,
            durCount === 0 ? "No call durations present in raw_payload — duration field may not be ingested." : null,
            good + bad === 0 ? "No call score present — transcript/AI scoring may not be enabled." : null,
          ].filter(Boolean),
        };
      }),
    }),

    get_data_quality_audit: tool({
      description:
        "Audit data trustworthiness for a property: sync freshness, failed syncs, pagination caps, unconfirmed pipeline mappings, derived appointment statuses, unknown outbound messages, duplicate contacts/opportunities. Returns overall confidence and per-issue rows.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(1).max(180).default(30),
      }),
      execute: wrap(ctx, "get_data_quality_audit", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_data_quality_audit");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const [sources, syncs, qualityRpc, stages, mapping, dupContacts, unknownMsgs] = await Promise.all([
          ctx.supabase.from("property_data_sources")
            .select("source,is_connected,last_synced_at,status,error_message")
            .eq("property_id", id),
          ctx.supabase.from("sync_runs")
            .select("source,status,error_message,started_at")
            .eq("property_id", id).order("started_at", { ascending: false }).limit(50),
          ctx.userSupabase.rpc("lead_perf_quality", {
            _property_ids: [id],
            _from: new Date(from).toISOString(), _to: new Date(to + "T23:59:59Z").toISOString(),
          }),
          ctx.supabase.from("ghl_pipeline_stages").select("ghl_stage_id").eq("property_id", id),
          ctx.supabase.from("property_pipeline_mapping")
            .select("ghl_stage_id,confirmed_by_user").eq("property_id", id),
          ctx.supabase.from("ghl_contacts")
            .select("duplicate_group_id", { count: "exact", head: true })
            .eq("property_id", id).not("duplicate_group_id", "is", null),
          ctx.supabase.from("ghl_messages")
            .select("id", { count: "exact", head: true })
            .eq("property_id", id).eq("direction", "outbound").is("response_source", null),
        ]);
        const recentFailures = (syncs.data ?? []).filter(s => s.status === "failure").slice(0, 10);
        const stageCount = (stages.data ?? []).length;
        const confirmedStageIds = new Set((mapping.data ?? []).filter(m => m.confirmed_by_user).map(m => m.ghl_stage_id));
        const unconfirmedStages = (stages.data ?? []).filter(s => !confirmedStageIds.has(s.ghl_stage_id)).length;
        const issues: Array<{ category: string; severity: "low" | "medium" | "high"; detail: string; count?: number }> = [];
        const now = Date.now();
        for (const s of sources.data ?? []) {
          const last = s.last_synced_at ? new Date(s.last_synced_at).getTime() : 0;
          const ageH = last ? (now - last) / 3600_000 : Infinity;
          if (!s.is_connected) issues.push({ category: "sync", severity: "high", detail: `${s.source} is not connected` });
          else if (ageH > 48) issues.push({ category: "sync", severity: "high", detail: `${s.source} last synced ${Math.round(ageH)}h ago` });
          else if (ageH > 24) issues.push({ category: "sync", severity: "medium", detail: `${s.source} last synced ${Math.round(ageH)}h ago` });
        }
        if (recentFailures.length) issues.push({ category: "sync_failures", severity: "high", detail: `${recentFailures.length} recent sync failures`, count: recentFailures.length });
        if (unconfirmedStages > 0) issues.push({ category: "mapping", severity: "medium", detail: `${unconfirmedStages} unconfirmed pipeline stage mappings`, count: unconfirmedStages });
        if ((dupContacts.count ?? 0) > 0) issues.push({ category: "duplicates", severity: "medium", detail: `${dupContacts.count} contacts in duplicate groups`, count: dupContacts.count ?? 0 });
        if ((unknownMsgs.count ?? 0) > 0) issues.push({ category: "messaging", severity: "low", detail: `${unknownMsgs.count} outbound messages with unknown source (human/automation/ai)`, count: unknownMsgs.count ?? 0 });
        const highCount = issues.filter(i => i.severity === "high").length;
        const medCount = issues.filter(i => i.severity === "medium").length;
        const confidence: "high" | "medium" | "low" =
          highCount > 0 ? "low" : medCount > 1 ? "medium" : "high";
        return {
          property_id: id, from, to,
          confidence,
          confidence_explanation:
            highCount > 0 ? "One or more high-severity data issues detected; treat numbers as approximate."
            : medCount > 0 ? "Some medium-severity issues — numbers usable but flagged."
            : "Sources are fresh and coverage looks clean.",
          sync_freshness: Object.fromEntries((sources.data ?? []).map(s => [s.source, s.last_synced_at])),
          recent_sync_failures: recentFailures,
          unconfirmed_pipeline_mappings: unconfirmedStages,
          duplicate_contacts: dupContacts.count ?? 0,
          unknown_outbound_messages: unknownMsgs.count ?? 0,
          lead_perf_quality: qualityRpc.data ?? null,
          issues,
          sources_used: ["property_data_sources", "sync_runs", "ghl_*", "lead_perf_quality"],
          caveats: [
            "Stabilization/learning-phase status is not surfaced from Google Ads directly.",
            qualityRpc.error ? `lead_perf_quality: ${qualityRpc.error.message}` : null,
          ].filter(Boolean),
        };
      }),
    }),

    get_client_summary_context: tool({
      description:
        "Collect the facts needed to write a CLIENT-SAFE summary: wins, risks, performance deltas, lead flow, lead handling summary, account stability, planned next steps, internal caveats. Use BEFORE writing a client_summary report.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        days: z.number().int().min(7).max(90).default(30),
      }),
      execute: wrap(ctx, "get_client_summary_context", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "get_client_summary_context");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const to = new Date();
        const from = new Date(to.getTime() - i.days * 86400_000);
        const prevFrom = new Date(from.getTime() - i.days * 86400_000);
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = to.toISOString().slice(0, 10);
        const prevFromStr = prevFrom.toISOString().slice(0, 10);
        const prevToStr = from.toISOString().slice(0, 10);
        const [summary, speed, handling, pipeline, prev] = await Promise.all([
          ctx.supabase.rpc("ai_assistant_context", { _property_id: id, _from: fromStr, _to: toStr }),
          ctx.userSupabase.rpc("lead_perf_speed", { _property_ids: [id], _from: from.toISOString(), _to: to.toISOString() }),
          ctx.userSupabase.rpc("lead_perf_handling", { _property_ids: [id], _from: from.toISOString(), _to: to.toISOString() }),
          ctx.userSupabase.rpc("lead_perf_pipeline", { _property_ids: [id], _from: from.toISOString(), _to: to.toISOString() }),
          ctx.supabase.rpc("ai_assistant_context", { _property_id: id, _from: prevFromStr, _to: prevToStr }),
        ]);
        return {
          property_id: id,
          current_range: { from: fromStr, to: toStr },
          previous_range: { from: prevFromStr, to: prevToStr },
          current_summary: summary.data, previous_summary: prev.data,
          speed: speed.data, handling: handling.data, pipeline: pipeline.data,
          sources_used: ["daily_metrics", "ghl_lead_facts"],
          internal_caveats_examples: [
            "Do not surface raw table names to the client.",
            "Translate 'stale' → 'awaiting follow-up'.",
            "Translate 'never responded' → 'pending first outreach'.",
            "Avoid blame language about agents in the client tone.",
          ],
        };
      }),
    }),

    save_visual_report: tool({
      description:
        "Persist a generated report so the user can open it from the report drawer. Always call this after producing analytical findings. Return the report_id.",
      inputSchema: z.object({
        title: z.string(),
        report_type: z.string(),
        property_id: z.string().uuid().optional(),
        date_range: z.object({ from: z.string(), to: z.string() }).optional(),
        schema: z.record(z.string(), z.any()).describe("Full ReportSchema JSON to render"),
        evidence: z.record(z.string(), z.any()).optional(),
      }),
      execute: wrap(ctx, "save_visual_report", async (i) => {
        const pid = i.property_id ?? ctx.defaultPropertyId;
        if (pid) await assertPropertyAccess(ctx.supabase, ctx.userId, pid);
        const s = (i.schema ?? {}) as Record<string, unknown>;
        const cmp = s["comparison_range"] as { from?: string; to?: string } | undefined;
        const { data, error } = await ctx.supabase
          .from("ai_agent_reports")
          .insert({
            user_id: ctx.userId,
            session_id: ctx.sessionId,
            property_id: pid,
            report_type: i.report_type,
            title: i.title,
            date_range_start: i.date_range?.from ?? null,
            date_range_end: i.date_range?.to ?? null,
            comparison_range_start: cmp?.from ?? null,
            comparison_range_end: cmp?.to ?? null,
            schema_json: i.schema,
            evidence_json: i.evidence ?? null,
            scope_json: s["scope"] ?? null,
            status_json: s["status"] ?? null,
            caveats_json: s["caveats"] ?? null,
            confidence_json: s["confidence"] ?? null,
            saved: false,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        return { report_id: data.id, schema: i.schema };
      }),
    }),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const auth = await authUser(req);
    if (!auth.user) {
      return new Response(JSON.stringify({ error: auth.error, detail: auth.detail }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = auth.user;
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    if (DEBUG) console.log("jarvis body keys:", Object.keys(body));
    const rawMessages = body.messages ?? body.uiMessages ?? (body.message ? [body.message] : null);
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Request body missing 'messages' array", got: Object.keys(body) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const messages = rawMessages as UIMessage[];
    const activePropertyId =
      (body.propertyId as string | undefined) ??
      (body.property_id as string | undefined) ??
      (body.context?.propertyId as string | undefined) ??
      (body.context?.property_id as string | undefined) ??
      null;
    const propertyId = activePropertyId;
    const bodyDateRange = body.dateRange ?? body.context?.dateRange ?? null;
    const from = (body.from as string | undefined) ?? (bodyDateRange?.from as string | undefined) ?? null;
    const to = (body.to as string | undefined) ?? (bodyDateRange?.to as string | undefined) ?? null;
    let sessionId = body.sessionId as string | undefined;

    if (DEBUG) {
      console.log("[Jarvis Edge Context Debug]", {
        propertyId,
        propertyName: body.propertyName ?? body.context?.propertyName ?? null,
        from,
        to,
        sessionId: sessionId ?? null,
        messageCount: body?.messages?.length,
      });
    }

    const supabase = svc();
    const userJwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${userJwt}` } } },
    );

    // Verify property access if provided
    if (propertyId) {
      const { data: ok } = await supabase.rpc("user_can_access_property", {
        _user_id: user.id, _property_id: propertyId,
      });
      if (!ok) {
        return new Response(JSON.stringify({ error: "Property access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Create or update session
    if (!sessionId) {
      const firstUser = messages.find(m => m.role === "user");
      const titleText = firstUser?.parts?.find((p) => p.type === "text")?.text ?? "New session";
      const { data: sess, error: sessErr } = await supabase
        .from("ai_agent_sessions")
        .insert({
          user_id: user.id,
          property_id: propertyId,
          title: titleText.slice(0, 80),
          date_range_start: from,
          date_range_end: to,
        })
        .select("id")
        .single();
      if (sessErr) throw new Error(sessErr.message);
      sessionId = sess.id;
    } else {
      await supabase.from("ai_agent_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId).eq("user_id", user.id);
    }

    // Persist newest user message
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (lastUser) {
      const text = lastUser.parts?.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("\n");
      await supabase.from("ai_agent_messages").insert({
        session_id: sessionId,
        role: "user",
        content: text ?? "",
        parts_json: lastUser.parts,
      });
    }

    const ctx: Ctx = {
      supabase,
      userSupabase,
      userId: user.id,
      sessionId: sessionId!,
      defaultPropertyId: propertyId,
      defaultFrom: from,
      defaultTo: to,
    };

    const gateway = createOpenAICompatible({
      name: "lovable-ai",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: { "Lovable-API-Key": key },
    });

    const contextHeader = `\n\nACTIVE CONTEXT:\n- property_id: ${propertyId ?? "(none)"}\n- date_range: ${from ?? "?"} → ${to ?? "?"}`;

    const result = streamText({
      model: gateway("openai/gpt-5.5"),
      system: SYSTEM_PROMPT + contextHeader,
      messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
      tools: buildTools(ctx),
      stopWhen: stepCountIs(50),
    });

    const streamResponse = result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ responseMessage }) => {
        try {
          const text = responseMessage.parts
            ?.filter(p => p.type === "text")
            .map(p => (p as { text: string }).text)
            .join("\n");
          await supabase.from("ai_agent_messages").insert({
            session_id: sessionId,
            role: "assistant",
            content: text ?? "",
            parts_json: responseMessage.parts,
          });
        } catch (e) {
          console.error("persist assistant failed", e);
        }
      },
    });
    const responseHeaders = new Headers(streamResponse.headers);
    for (const [key, value] of Object.entries(corsHeaders)) responseHeaders.set(key, value);
    responseHeaders.set("x-session-id", sessionId!);
    return new Response(streamResponse.body, {
      status: streamResponse.status,
      statusText: streamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("jarvis error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});