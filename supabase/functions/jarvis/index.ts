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

const SYSTEM_PROMPT = `You are Bob, the friendly in-house marketing analyst for Ridgeside K9 dog-training locations.

WHO YOU TALK TO
The person reading you owns or runs a dog-training business. They are NOT a marketer. They do not know what CTR, CPC, attribution, or a conversion rate is unless you explain it in the same breath. Talk to them like a trusted friend who happens to be great at marketing: warm, calm, plain English, short conversational paragraphs. No bullet lists unless they ask for a list. No tables. No markdown bold, headings, or backticks. No jargon or acronym without a five-word plain explanation next to it. Never mention table names, column names, tool names, or internal identifiers.

WHAT YOU ARE EXPERT IN
- Dog training as a business: board-and-train, day training, puppy programs, behavior/aggression cases. High-ticket purchases with a long decision window — people call, think, talk to a spouse, and buy weeks later.
- Seasonality of that business: puppy demand spikes in spring and after the holidays; summer travel drives boarding and board-and-train; late November through December is almost always slow because people are traveling, spending on gifts, and postponing training to January; back-to-school in August/September is a reliable pickup.
- Paid search and lead generation: how ad spend, impressions, clicks, click-through rate, cost per click, and call volume relate to each other, and how a change upstream shows up downstream days later.
- Macro conditions: consumer discretionary spending softens with rate and price pressure, and premium services like board-and-train feel it before basic obedience does.

HOW YOU WORK (agentic)
- Never invent a number. Always pull real data with your tools before answering.
- Use the ONE-CALL diagnosis lookups first. For any "why are my leads down / is this normal / how are we doing" question, call diagnose_leads once — it already returns the current window, the same-length prior window, the same period last year, the last six months, the breakdown by source, and feed freshness. For any spend, budget, cost or "are the ads working" question, call diagnose_ad_spend once. For all-locations questions, call get_portfolio_trend once.
- Two to three lookups is the ceiling for a normal answer. Do NOT chain compare_periods, get_trend_windows, the ads tool, the call-tracking tool and the source-health tool one after another — the one-call lookups cover all of that. Reach for a specialist tool only when the diagnosis leaves one specific question open.
- ALWAYS finish with a written answer. Never end your turn on a lookup with nothing said.
- Always know which location and which date range you are talking about, and name them naturally in the answer.
- You only read data. You never change anything, and you never claim you did.

DIAGNOSE BEFORE YOU ALARM
When a number looks down, work through this before you characterize it:
1. Is it real? Compare same-length windows, not a partial month against a full one. Check the same period last year and the trailing twelve months.
2. Is the top of the funnel intact? If impressions, clicks, and click-through rate are steady, demand and the ads are fine and the dip is timing or noise.
3. Did spend or budget move? A pause, a budget cap, or a drop in spend explains a drop in calls all by itself.
4. Is the mix shifting? Fewer leads but a higher share of good ones is often a better month, not a worse one.
5. Is the data even current? If a feed is stale, say the number is incomplete instead of interpreting it.
6. Is the sample small? Under about 25 leads, talk in counts, not percentages, and say plainly that small numbers bounce around.
Then explain in plain language what is actually happening, and why it is or is not something to worry about. If it is normal, say so clearly and give them the reason — do not leave them anxious.

WHEN IT IS A REAL PROBLEM
Say it plainly, in the first sentence, without softening it into nothing. Real problems include: spend collapsing or a campaign paused unintentionally, click-through rate falling sharply while impressions hold, a data feed that has stopped updating, lead quality dropping below the healthy range for a sustained stretch, budget exhausted well before month end, or a sustained multi-month decline that is not seasonal. In those cases tell them clearly what you see and to alert the administration team so it can be looked at and fixed. Never hide bad news and never fabricate a reassuring explanation.

CANONICAL LEAD MODEL (non-negotiable math)
- There are three populations and they are NOT the same size. Always name which one you mean:
  1. Records — every call and form that came in.
  2. Scored calls — the records call tracking gave a quality outcome. Always smaller than records, because spam and un-scored records are left out.
  3. Good calls — the scored calls that were real people asking about training.
- Quality rate = good calls ÷ scored calls. At or above 30% is healthy, 25–30% is worth watching, below 25% needs attention.
- Never say "leads" on its own. Say "records", "scored calls" or "good calls".
- Whenever you give a good-call count, give it against its base: "25 of your 45 scored calls were good".
- "AI-projected sale" is retired. Never mention it, never add it to good calls, never treat it as revenue or a forecast.
- Verified sales come from the CRM and are separate from call counts. Do not mix them.
- When a tool already returns these counts or the quality rate, use those values as given.

MATCH THE DASHBOARD, ALWAYS
- Every number you say out loud must be a number the user can find on their screen. The lookups are already filtered exactly the way the cards are (the CRM "won" feed is excluded, and on shared ad accounts only campaigns labeled to that location count). Never do your own arithmetic on top of that.
- Use the same names as the cards: "Records" (all calls + forms), "Scored calls" (records with a quality outcome), "Good Calls" (the good ones), "Verified Sale" (CRM wins).
- Use the date window the dashboard selector is set to, exactly as given in ACTIVE CONTEXT. Do not round it to "the first half of the month" or invent a different comparison window; say the dates the way the card labels them.

HOW YOUR MESSAGE IS DISPLAYED
- Your answer is rendered as chat bubbles, one per paragraph. Separate each beat with a blank line so it lands as its own bubble. Keep paragraphs short — two to four sentences.
- Plain sentences only: no markdown headings, no bold, no tables, no bullet lists unless the user asks for a list.

HOW EVERY ANSWER IS SHAPED (always these three beats, in this order)
1. Acknowledge the question in one short line that shows you understood it and names the location and window in normal words. Example: "Good question — you're looking at calls for Colorado Springs over the last thirty days."
2. Give the brief answer: two to four plain sentences, conclusion first. At most one or two numbers, only if they carry the point. Keep this short even when you ran a dozen lookups behind the scenes — the detail is yours to offer, not to dump.
3. Close with one specific offer to go further, phrased as a question tied to what you just said. For example "Want me to break that down by where the calls came from?" or "Should I check whether last July looked the same?" Never a generic "let me know if you have questions", never the same phrasing twice in a row, and never more than one question.
If they say yes or ask for more, then go deeper — and still finish with a new, more specific offer.
If a real problem is found, beat 2 still says it plainly and tells them to alert the administration team; the offer to explain further comes after that.
No bullet lists unless they ask for a list.

REPORTS
You do not build reports. If someone asks for one, walk them through the numbers conversationally and point them to the Reports page in the app.`;

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
  /** Scope from the sidebar location selector. */
  scopeMode: "agency" | "property";
  /** Every property id this request is allowed to touch (already access-checked). */
  allowedProperties: { id: string; name: string }[];
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
  const allowed = ctx.allowedProperties;
  // Single-location scope: pinned. Anything else is out of view.
  if (ctx.scopeMode === "property") {
    const pinned = ctx.defaultPropertyId;
    if (!pinned) throw new Error("no location is selected in the dashboard");
    if (raw && raw !== pinned) {
      const name = allowed.find((p) => p.id === pinned)?.name ?? "the selected location";
      throw new Error(
        `out_of_scope: the location selector is set to ${name}. You may only discuss that location. Tell the user to switch the location selector to look at another location.`,
      );
    }
    return pinned;
  }
  // Agency scope: any accessible location, but nothing outside it.
  const id = raw ?? (allowed.length === 1 ? allowed[0].id : null);
  if (!id) {
    throw new Error(
      "missing_property_id: the selector is set to all locations. Call list_locations and then call this tool once per location you need.",
    );
  }
  if (!allowed.some((p) => p.id === id)) {
    throw new Error("out_of_scope: that location is not one this user can see.");
  }
  return id;
}
function resolveRange(ctx: Ctx, from?: string, to?: string, days?: number) {
  if (from && to) return { from, to };
  // The dashboard's date selector is the source of truth. A tool-supplied
  // `days` may never silently re-window the answer away from the cards.
  if (ctx.defaultFrom && ctx.defaultTo) {
    return { from: ctx.defaultFrom, to: ctx.defaultTo };
  }
  if (days) {
    const t = new Date();
    const f = new Date(t.getTime() - days * 86400_000);
    return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) };
  }
  const t = new Date();
  const f = new Date(t.getTime() - 30 * 86400_000);
  return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) };
}

/**
 * Dashboard scope rules, mirrored exactly (see useCommandData.fetchWindow):
 *  - the `GHL Won` disposition feed is not a media source and is excluded
 *  - on shared Google Ads accounts, only campaigns labeled to this location count
 * Any row-level read of daily_metrics / v_lead_counts_daily must run through
 * this filter or Bob will quote numbers the cards never show.
 */
const PPC_SOURCE = "Google PPC";

async function dashboardScope(ctx: Ctx, propertyId: string) {
  const { data } = await ctx.supabase
    .from("campaign_labels")
    .select("campaign")
    .eq("property_id", propertyId);
  const allowed = (data ?? []).map((r: { campaign: string }) => r.campaign);
  const set = allowed.length > 0 ? new Set(allowed) : null;
  return (row: { ad_source?: string | null; campaign?: string | null }) => {
    if ((row.ad_source ?? "") === "GHL Won") return false;
    if (set && (row.ad_source ?? "") === PPC_SOURCE && !set.has(row.campaign ?? "")) return false;
    return true;
  };
}

function secondsBetween(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return null;
  const diff = new Date(a).getTime() - new Date(b).getTime();
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff / 1000)) : null;
}

/** Pull just the totals block out of an ai_assistant_context payload. */
function totalsOf(data: unknown) {
  const t = (data as { totals?: Record<string, unknown> } | null)?.totals;
  return t ?? null;
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
    list_locations: tool({
      description:
        "List the locations currently in scope (from the dashboard location selector). Call this first whenever the scope is all locations, then call the other tools once per location id.",
      inputSchema: z.object({}),
      execute: wrap(ctx, "list_locations", async () => ({
        scope_mode: ctx.scopeMode,
        locations: ctx.allowedProperties,
        count: ctx.allowedProperties.length,
      })),
    }),

    get_property_context: tool({
      description:
        "Get the active property's name, connected data sources, and sync freshness. Always call this first when starting a new line of inquiry about a property.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional().describe("Defaults to active dashboard property"),
        propertyId: z.string().uuid().optional().describe("Alias for property_id; defaults to active dashboard property"),
      }),
      execute: wrap(ctx, "get_property_context", async (input) => {
        const id = resolveProperty(ctx, input, "get_property_context");
        const [{ data: p }, { data: srcs }] = await Promise.all([
          ctx.supabase.from("properties").select("id,name,slug,timezone").eq("id", id).maybeSingle(),
          ctx.supabase.from("property_data_sources").select("source,is_connected,last_synced_at").eq("property_id", id),
        ]);
        return { property: p, sources: srcs ?? [] };
      }),
    }),

    get_account_summary: tool({
      description: "Aggregate totals (cost, calls, leads, projected sales, verified sales) by ad source for the date range.",
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
          .from("v_lead_counts_daily")
          .select("date,ad_source,campaign,cost,clicks,impressions,records,good_leads")
          .eq("property_id", id)
          .gte("date", from.toISOString().slice(0, 10))
          .lte("date", to.toISOString().slice(0, 10))
          .order("date");
        if (error) throw new Error(error.message);
        const inScope = await dashboardScope(ctx, id);
        const rows = (data ?? []).filter(inScope);
        const byDate = new Map<string, { cost: number; clicks: number; impressions: number; calls: number; good_leads: number }>();
        const bySource = new Map<string, { cost: number; clicks: number; impressions: number; calls: number; good_leads: number }>();
        for (const r of rows) {
          const date = r.date;
          const source = r.ad_source ?? "Unknown";
          const add = (bucket: { cost: number; clicks: number; impressions: number; calls: number; good_leads: number }) => {
            bucket.cost += Number(r.cost ?? 0);
            bucket.clicks += Number(r.clicks ?? 0);
            bucket.impressions += Number(r.impressions ?? 0);
            bucket.calls += Number(r.records ?? 0);
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
        const id = resolveProperty(ctx, i, "reconcile_ctm_to_ghl");
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
          // Canonical Lead Model: read v_lead_counts_daily so total_leads / quality
          // come from the SQL source of truth, never from local arithmetic.
          let q = ctx.supabase.from("v_lead_counts_daily")
            .select("date,ad_source,campaign,cost,impressions,clicks,records,bad_leads,good_leads,projected_sales,verified_sales,total_leads,quality_numerator,quality_rate")
            .eq("property_id", id).gte("date", from).lte("date", to);
          if (i.campaign) q = q.eq("campaign", i.campaign);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          return (data ?? []).filter(inScope);
        };
        const inScope = await dashboardScope(ctx, id);
        const [cur, prev] = await Promise.all([
          fetchRange(i.current_from, i.current_to),
          fetchRange(i.previous_from, i.previous_to),
        ]);
        const totals = (rows: typeof cur) => {
          const t = { cost: 0, impressions: 0, clicks: 0, calls: 0, bad_leads: 0, good_leads: 0, projected_sale: 0, verified_sale: 0, total_leads: 0, quality_num: 0 };
          for (const r of rows) {
            t.cost += Number(r.cost ?? 0);
            t.impressions += Number(r.impressions ?? 0);
            t.clicks += Number(r.clicks ?? 0);
            t.calls += Number(r.records ?? 0);
            t.bad_leads += Number(r.bad_leads ?? 0);
            t.good_leads += Number(r.good_leads ?? 0);
            t.projected_sale += Number(r.projected_sales ?? 0);
            t.verified_sale += Number(r.verified_sales ?? 0);
            t.total_leads += Number(r.total_leads ?? 0);
            t.quality_num += Number(r.quality_numerator ?? 0);
          }
          return t;
        };
        const derive = (t: ReturnType<typeof totals>) => ({
          ...t,
          // Canonical: never use the legacy `leads` column. total_leads is
          // already summed from v_lead_counts_daily (bad+good+projected).
          leads: t.total_leads,
          // Quality = good calls / scored calls. Projected-sale is retired.
          quality_rate: t.total_leads > 0 ? t.good_leads / t.total_leads : 0,
          ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
          cpc: t.clicks > 0 ? t.cost / t.clicks : 0,
          cpl: t.total_leads > 0 ? t.cost / t.total_leads : 0,
          conv_rate: t.clicks > 0 ? t.total_leads / t.clicks : 0,
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
          total_leads: { current: c.leads, previous: p.leads, ...delta(c.leads, p.leads) },
          bad_leads: { current: c.bad_leads, previous: p.bad_leads, ...delta(c.bad_leads, p.bad_leads) },
          good_leads: { current: c.good_leads, previous: p.good_leads, ...delta(c.good_leads, p.good_leads) },
          quality_rate: { current: c.quality_rate, previous: p.quality_rate, ...delta(c.quality_rate, p.quality_rate) },
          cpl: { current: c.cpl, previous: p.cpl, ...delta(c.cpl, p.cpl) },
          conv_rate: { current: c.conv_rate, previous: p.conv_rate, ...delta(c.conv_rate, p.conv_rate) },
          verified_sale: { current: c.verified_sale, previous: p.verified_sale, ...delta(c.verified_sale, p.verified_sale) },
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
          leads_current: v.current.total_leads, leads_previous: v.previous.total_leads,
          cpl_current: v.current.total_leads > 0 ? v.current.cost / v.current.total_leads : 0,
          cpl_previous: v.previous.total_leads > 0 ? v.previous.cost / v.previous.total_leads : 0,
          spend_delta_pct: v.previous.cost > 0 ? (v.current.cost - v.previous.cost) / v.previous.cost : null,
          leads_delta_pct: v.previous.total_leads > 0 ? (v.current.total_leads - v.previous.total_leads) / v.previous.total_leads : null,
        })).sort((a, b) => b.spend_current - a.spend_current).slice(0, 50);
        const dailyMap = new Map<string, { date: string; cost: number; leads: number }>();
        for (const r of cur) {
          const d = dailyMap.get(r.date) ?? { date: r.date, cost: 0, leads: 0 };
          d.cost += Number(r.cost ?? 0); d.leads += Number(r.total_leads ?? 0);
          dailyMap.set(r.date, d);
        }
        const daily_current = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
        return {
          property_id: id,
          current_range: { from: i.current_from, to: i.current_to },
          previous_range: { from: i.previous_from, to: i.previous_to },
          metrics, campaign_breakdown, daily_current,
          sources_used: ["v_lead_counts_daily"],
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
        // Canonical Lead Model: read v_lead_counts_daily for total_leads / quality.
        let q = ctx.supabase.from("v_lead_counts_daily")
          .select("date,ad_source,campaign,cost,impressions,clicks,records,bad_leads,good_leads,projected_sales,verified_sales,total_leads,quality_numerator")
          .eq("property_id", id).gte("date", from).lte("date", to);
        if (i.ad_source) q = q.eq("ad_source", i.ad_source);
        if (i.campaign) q = q.eq("campaign", i.campaign);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const inScope = await dashboardScope(ctx, id);
        const rows = (data ?? []).filter(inScope);
        const tot = { cost: 0, impressions: 0, clicks: 0, leads: 0, bad_leads: 0, good_leads: 0, projected_sale: 0, verified_sale: 0, quality_num: 0 };
        const byCampaign = new Map<string, { campaign: string; cost: number; clicks: number; impressions: number; leads: number }>();
        const byDate = new Map<string, { date: string; cost: number; clicks: number; leads: number }>();
        for (const r of rows) {
          tot.cost += Number(r.cost ?? 0); tot.impressions += Number(r.impressions ?? 0);
          tot.clicks += Number(r.clicks ?? 0); tot.leads += Number(r.total_leads ?? 0);
          tot.bad_leads += Number(r.bad_leads ?? 0);
          tot.good_leads += Number(r.good_leads ?? 0); tot.projected_sale += Number(r.projected_sales ?? 0); tot.verified_sale += Number(r.verified_sales ?? 0);
          tot.quality_num += Number(r.quality_numerator ?? 0);
          const ck = r.campaign || "(unknown)";
          const c = byCampaign.get(ck) ?? { campaign: ck, cost: 0, clicks: 0, impressions: 0, leads: 0 };
          c.cost += Number(r.cost ?? 0); c.clicks += Number(r.clicks ?? 0);
          c.impressions += Number(r.impressions ?? 0); c.leads += Number(r.total_leads ?? 0);
          byCampaign.set(ck, c);
          const d = byDate.get(r.date) ?? { date: r.date, cost: 0, clicks: 0, leads: 0 };
          d.cost += Number(r.cost ?? 0); d.clicks += Number(r.clicks ?? 0); d.leads += Number(r.total_leads ?? 0);
          byDate.set(r.date, d);
        }
        return {
          property_id: id, from, to,
          totals: {
            ...tot,
            quality_rate: tot.leads > 0 ? tot.good_leads / tot.leads : 0,
            ctr: tot.impressions > 0 ? tot.clicks / tot.impressions : 0,
            cpc: tot.clicks > 0 ? tot.cost / tot.clicks : 0,
            cpl: tot.leads > 0 ? tot.cost / tot.leads : 0,
            conv_rate: tot.clicks > 0 ? tot.leads / tot.clicks : 0,
          },
          campaigns: [...byCampaign.values()]
            .map(c => ({ ...c, cpl: c.leads > 0 ? c.cost / c.leads : 0, ctr: c.impressions > 0 ? c.clicks / c.impressions : 0 }))
            .sort((a, b) => b.cost - a.cost),
          daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
          sources_used: ["v_lead_counts_daily"],
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
        // Canonical Lead Model: use v_lead_counts_daily.total_leads, not legacy leads col.
        const { data, error } = await ctx.supabase.from("v_lead_counts_daily")
          .select("date,ad_source,campaign,cost,clicks,total_leads")
          .eq("property_id", id).gte("date", from).lte("date", to).order("date");
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        const byDate = new Map<string, { date: string; cost: number; leads: number; clicks: number }>();
        for (const r of rows) {
          const d = byDate.get(r.date) ?? { date: r.date, cost: 0, leads: 0, clicks: 0 };
          d.cost += Number(r.cost ?? 0); d.leads += Number(r.total_leads ?? 0); d.clicks += Number(r.clicks ?? 0);
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
          sources_used: ["v_lead_counts_daily"],
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

    get_trend_windows: tool({
      description:
        "Comparison windows for any 'is this normal / why is it down / how does this compare' question: this month to date vs last month same window, previous 30 days vs the 30 before that, year to date, last year same period, and trailing 12 months by month. Call this before characterizing any change over time.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
      }),
      execute: wrap(ctx, "get_trend_windows", async (i) => {
        const id = resolveProperty(ctx, i.property_id);
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const d = (x: Date) => x.toISOString().slice(0, 10);
        const now = new Date();
        const day = now.getUTCDate();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const shift = (base: Date, days: number) => new Date(base.getTime() + days * 86400_000);
        const lastMonthEndSameDay = new Date(Date.UTC(y, m, 0));
        const lastMonthDays = lastMonthEndSameDay.getUTCDate();
        const windows: Record<string, { from: string; to: string }> = {
          this_month_to_date: { from: d(new Date(Date.UTC(y, m, 1))), to: d(now) },
          last_month_full: { from: d(new Date(Date.UTC(y, m - 1, 1))), to: d(lastMonthEndSameDay) },
          last_month_same_window: {
            from: d(new Date(Date.UTC(y, m - 1, 1))),
            to: d(new Date(Date.UTC(y, m - 1, Math.min(day, lastMonthDays)))),
          },
          previous_30_days: { from: d(shift(now, -30)), to: d(now) },
          prior_30_days: { from: d(shift(now, -60)), to: d(shift(now, -31)) },
          year_to_date: { from: d(new Date(Date.UTC(y, 0, 1))), to: d(now) },
          last_year_same_period: {
            from: d(new Date(Date.UTC(y - 1, 0, 1))),
            to: d(new Date(Date.UTC(y - 1, m, day))),
          },
        };
        const entries = Object.entries(windows);
        const monthSpans: Array<{ month: string; from: string; to: string }> = [];
        for (let back = 11; back >= 0; back--) {
          const start = new Date(Date.UTC(y, m - back, 1));
          const end = new Date(Date.UTC(y, m - back + 1, 0));
          monthSpans.push({
            month: d(start).slice(0, 7),
            from: d(start),
            to: d(end > now ? now : end),
          });
        }
        // One parallel batch for the comparison windows AND all 12 months —
        // the monthly loop used to run one round-trip at a time.
        const [windowResults, monthResults] = await Promise.all([
          Promise.all(entries.map(([, w]) =>
            ctx.supabase.rpc("ai_assistant_context", { _property_id: id, _from: w.from, _to: w.to })
          )),
          Promise.all(monthSpans.map((s) =>
            ctx.supabase.rpc("ai_assistant_context", { _property_id: id, _from: s.from, _to: s.to })
          )),
        ]);
        const out: Record<string, unknown> = {};
        entries.forEach(([k, w], idx) => {
          out[k] = { range: w, data: windowResults[idx].data ?? null, error: windowResults[idx].error?.message ?? null };
        });
        // Months carry totals only — the per-source breakdown for 12 months
        // bloated the payload (and the model's input tokens) for no gain.
        const months = monthSpans.map((s, idx) => ({
          month: s.month,
          totals: totalsOf(monthResults[idx].data),
        }));
        return { property_id: id, windows: out, trailing_12_months_by_month: months };
      }),
    }),

    get_portfolio_trend: tool({
      description:
        "ALL-LOCATIONS ROLL-UP. One call that returns, for every location in scope, the current-window totals and the same-length previous window, plus the portfolio total. Use this INSTEAD of calling the per-location tools once per location whenever the question is about all locations, a portfolio trend, or 'why are my leads down' with no single location selected. Only after this identifies which locations moved should you drill into one of them.",
      inputSchema: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().optional(),
      }),
      execute: wrap(ctx, "get_portfolio_trend", async (i) => {
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const spanDays = Math.max(
          1,
          Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400_000) + 1,
        );
        const prevTo = new Date(new Date(from).getTime() - 86400_000);
        const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86400_000);
        const d = (x: Date) => x.toISOString().slice(0, 10);
        const props = ctx.allowedProperties;
        const results = await Promise.all(
          props.flatMap((p) => [
            ctx.supabase.rpc("ai_assistant_context", { _property_id: p.id, _from: from, _to: to }),
            ctx.supabase.rpc("ai_assistant_context", { _property_id: p.id, _from: d(prevFrom), _to: d(prevTo) }),
          ]),
        );
        const locations = props.map((p, idx) => ({
          property_id: p.id,
          name: p.name,
          current: totalsOf(results[idx * 2].data),
          previous: totalsOf(results[idx * 2 + 1].data),
        }));
        const sum = (key: string, pick: "current" | "previous") =>
          locations.reduce((acc, l) => acc + Number((l[pick] as Record<string, unknown> | null)?.[key] ?? 0), 0);
        const keys = ["calls", "good_leads", "bad_leads", "spam", "projected_sale", "verified_sale", "cost", "clicks", "impressions"];
        const portfolio: Record<string, { current: number; previous: number }> = {};
        for (const k of keys) portfolio[k] = { current: sum(k, "current"), previous: sum(k, "previous") };
        return {
          current_range: { from, to },
          previous_range: { from: d(prevFrom), to: d(prevTo) },
          locations,
          portfolio_totals: portfolio,
          note: "Totals only. Drill into a single location with the per-location tools once you know which one moved.",
        };
      }),
    }),

    get_source_health: tool({
      description:
        "Freshness and failure state of every connected data feed for a property (ads, call tracking, CRM, analytics): connected flag, last sync time, hours since last sync, and the latest sync run status. Call this before blaming a drop on performance — a stale feed looks exactly like a decline.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
      }),
      execute: wrap(ctx, "get_source_health", async (i) => {
        const id = resolveProperty(ctx, i.property_id);
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const [{ data: srcs }, { data: runs }] = await Promise.all([
          ctx.supabase.from("property_data_sources")
            .select("source,is_connected,last_synced_at").eq("property_id", id),
          ctx.supabase.from("sync_runs")
            .select("source,status,started_at,finished_at,error_message")
            .eq("property_id", id).order("started_at", { ascending: false }).limit(60),
        ]);
        const latest = new Map<string, Record<string, unknown>>();
        for (const r of (runs ?? []) as Array<Record<string, unknown>>) {
          const k = String(r.source);
          if (!latest.has(k)) latest.set(k, r);
        }
        const nowMs = Date.now();
        const sources = ((srcs ?? []) as Array<Record<string, unknown>>).map((s) => {
          const last = s.last_synced_at ? new Date(String(s.last_synced_at)).getTime() : null;
          const run = latest.get(String(s.source)) ?? null;
          return {
            source: s.source,
            is_connected: s.is_connected,
            last_synced_at: s.last_synced_at ?? null,
            hours_since_sync: last ? Math.round(((nowMs - last) / 3_600_000) * 10) / 10 : null,
            latest_run_status: run?.status ?? null,
            latest_run_error: run?.error_message ?? null,
            stale: last ? nowMs - last > 12 * 3_600_000 : true,
          };
        });
        return {
          property_id: id,
          sources,
          any_stale: sources.some((s) => s.is_connected && s.stale),
          any_failing: sources.some((s) => s.latest_run_status && String(s.latest_run_status) !== "success"),
        };
      }),
    }),

    diagnose_leads: tool({
      description:
        "ONE-CALL DIAGNOSIS for 'why are my leads down', 'is this normal', 'how are we doing'. Returns, in a single lookup: the selected window, the same-length prior window, the same period last year, the last 6 months by month, the current window broken out by source, and the freshness/failure state of every data feed. Use this INSTEAD of chaining compare_periods + get_trend_windows + get_ctm_performance + get_google_ads_performance + get_source_health. Only drill into another tool if this leaves a specific question open.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(1).max(365).optional(),
      }),
      execute: wrap(ctx, "diagnose_leads", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "diagnose_leads");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const d = (x: Date) => x.toISOString().slice(0, 10);
        const fromD = new Date(from);
        const toD = new Date(to);
        const spanDays = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400_000) + 1);
        const prevTo = new Date(fromD.getTime() - 86400_000);
        const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86400_000);
        const lyFrom = new Date(Date.UTC(fromD.getUTCFullYear() - 1, fromD.getUTCMonth(), fromD.getUTCDate()));
        const lyTo = new Date(Date.UTC(toD.getUTCFullYear() - 1, toD.getUTCMonth(), toD.getUTCDate()));
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const monthSpans = [] as Array<{ month: string; from: string; to: string }>;
        for (let back = 5; back >= 0; back--) {
          const start = new Date(Date.UTC(y, m - back, 1));
          const end = new Date(Date.UTC(y, m - back + 1, 0));
          monthSpans.push({ month: d(start).slice(0, 7), from: d(start), to: d(end > now ? now : end) });
        }
        const call = (f: string, t: string) =>
          ctx.supabase.rpc("ai_assistant_context", { _property_id: id, _from: f, _to: t });
        // Everything in one parallel batch — this whole diagnosis is a single
        // model step, so the worker never has to survive a long tool chain.
        const [current, previous, lastYear, months, srcRes, runRes] = await Promise.all([
          call(from, to),
          call(d(prevFrom), d(prevTo)),
          call(d(lyFrom), d(lyTo)),
          Promise.all(monthSpans.map((s) => call(s.from, s.to))),
          ctx.supabase.from("property_data_sources")
            .select("source,is_connected,last_synced_at").eq("property_id", id),
          ctx.supabase.from("sync_runs")
            .select("source,status,started_at,error_message")
            .eq("property_id", id).order("started_at", { ascending: false }).limit(60),
        ]);
        const latest = new Map<string, Record<string, unknown>>();
        for (const r of ((runRes.data ?? []) as Array<Record<string, unknown>>)) {
          const k = String(r.source);
          if (!latest.has(k)) latest.set(k, r);
        }
        const nowMs = Date.now();
        const feeds = ((srcRes.data ?? []) as Array<Record<string, unknown>>).map((s) => {
          const last = s.last_synced_at ? new Date(String(s.last_synced_at)).getTime() : null;
          const run = latest.get(String(s.source)) ?? null;
          return {
            source: s.source,
            is_connected: s.is_connected,
            hours_since_sync: last ? Math.round(((nowMs - last) / 3_600_000) * 10) / 10 : null,
            latest_run_status: run?.status ?? null,
            stale: last ? nowMs - last > 12 * 3_600_000 : true,
          };
        });
        return {
          property_id: id,
          current: { range: { from, to }, totals: totalsOf(current.data), by_source: (current.data as { by_source?: unknown })?.by_source ?? null },
          previous_same_length: { range: { from: d(prevFrom), to: d(prevTo) }, totals: totalsOf(previous.data) },
          last_year_same_period: { range: { from: d(lyFrom), to: d(lyTo) }, totals: totalsOf(lastYear.data) },
          last_6_months_by_month: monthSpans.map((s, idx) => ({ month: s.month, totals: totalsOf(months[idx].data) })),
          feeds,
          any_stale_feed: feeds.some((f) => f.is_connected && f.stale),
          any_failing_feed: feeds.some((f) => f.latest_run_status && String(f.latest_run_status) !== "success"),
        };
      }),
    }),

    diagnose_ad_spend: tool({
      description:
        "ONE-CALL DIAGNOSIS for 'is my ad spend working', 'how are the ads doing', budget and cost questions. Returns spend, impressions, clicks, click-through rate, cost per click and cost per good lead for the selected window and the same-length prior window, split by source, plus feed freshness. Use this INSTEAD of chaining the ads, call-tracking and source-health tools.",
      inputSchema: z.object({
        property_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().min(1).max(365).optional(),
      }),
      execute: wrap(ctx, "diagnose_ad_spend", async (i) => {
        const id = resolveProperty(ctx, i.property_id, "diagnose_ad_spend");
        await assertPropertyAccess(ctx.supabase, ctx.userId, id);
        const { from, to } = resolveRange(ctx, i.from, i.to, i.days);
        const d = (x: Date) => x.toISOString().slice(0, 10);
        const fromD = new Date(from);
        const toD = new Date(to);
        const spanDays = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400_000) + 1);
        const prevTo = new Date(fromD.getTime() - 86400_000);
        const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86400_000);
        const call = (f: string, t: string) =>
          ctx.supabase.rpc("ai_assistant_context", { _property_id: id, _from: f, _to: t });
        const [current, previous, srcRes] = await Promise.all([
          call(from, to),
          call(d(prevFrom), d(prevTo)),
          ctx.supabase.from("property_data_sources")
            .select("source,is_connected,last_synced_at").eq("property_id", id),
        ]);
        const derive = (payload: unknown) => {
          const t = (totalsOf(payload) ?? {}) as Record<string, number>;
          const cost = Number(t.cost ?? 0);
          const clicks = Number(t.clicks ?? 0);
          const impressions = Number(t.impressions ?? 0);
          const good = Number(t.good_leads ?? 0);
          return {
            ...t,
            ctr_pct: impressions ? Math.round((clicks / impressions) * 10000) / 100 : null,
            cost_per_click: clicks ? Math.round((cost / clicks) * 100) / 100 : null,
            cost_per_good_lead: good ? Math.round((cost / good) * 100) / 100 : null,
          };
        };
        const nowMs = Date.now();
        return {
          property_id: id,
          current: {
            range: { from, to },
            totals: derive(current.data),
            by_source: (current.data as { by_source?: unknown })?.by_source ?? null,
          },
          previous_same_length: {
            range: { from: d(prevFrom), to: d(prevTo) },
            totals: derive(previous.data),
          },
          feeds: ((srcRes.data ?? []) as Array<Record<string, unknown>>).map((s) => ({
            source: s.source,
            is_connected: s.is_connected,
            hours_since_sync: s.last_synced_at
              ? Math.round(((nowMs - new Date(String(s.last_synced_at)).getTime()) / 3_600_000) * 10) / 10
              : null,
          })),
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
    const bodyScope = (body.scope ?? null) as
      | { mode?: string; propertyId?: string | null; propertyIds?: string[] | null; label?: string | null }
      | null;
    const activePropertyId =
      (bodyScope?.mode === "agency" ? null : bodyScope?.propertyId ?? null) ??
      (body.propertyId as string | undefined) ??
      (body.property_id as string | undefined) ??
      (body.context?.propertyId as string | undefined) ??
      (body.context?.property_id as string | undefined) ??
      null;
    const scopeMode: "agency" | "property" =
      bodyScope?.mode === "agency" ? "agency" : (activePropertyId ? "property" : "agency");
    const propertyId = scopeMode === "property" ? activePropertyId : null;
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

    // Resolve the set of locations this user may actually be answered about.
    // The dashboard location selector narrows it; access control caps it.
    // One round-trip: the user's own RLS decides what they can see, instead of
    // one user_can_access_property RPC per property.
    const { data: visibleProps, error: visibleErr } = await userSupabase
      .from("properties")
      .select("id,name")
      .eq("is_active", true)
      .order("name");
    let accessible = ((visibleProps ?? []) as Array<{ id: string; name: string }>).map(
      (p) => ({ id: p.id, name: p.name }),
    );
    if (visibleErr || accessible.length === 0) {
      // Fallback to the explicit per-property check if RLS returned nothing.
      const { data: allProps } = await supabase
        .from("properties").select("id,name").eq("is_active", true).order("name");
      const checks = await Promise.all(
        (allProps ?? []).map(async (p) => {
          const { data: ok } = await supabase.rpc("user_can_access_property", {
            _user_id: user.id, _property_id: p.id,
          });
          return ok ? { id: p.id as string, name: p.name as string } : null;
        }),
      );
      accessible = checks.filter(Boolean) as { id: string; name: string }[];
    }

    if (scopeMode === "property") {
      if (!propertyId || !accessible.some((p) => p.id === propertyId)) {
        return new Response(JSON.stringify({ error: "Property access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const allowedProperties = scopeMode === "property"
      ? accessible.filter((p) => p.id === propertyId)
      : accessible;

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
      // Don't block the model call on a bookkeeping update.
      void supabase.from("ai_agent_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId).eq("user_id", user.id)
        .then(({ error }) => { if (error) console.error("session touch failed", error.message); });
    }

    // Persist newest user message
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (lastUser) {
      const text = lastUser.parts?.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("\n");
      void supabase.from("ai_agent_messages").insert({
        session_id: sessionId,
        role: "user",
        content: text ?? "",
        parts_json: lastUser.parts,
      }).then(({ error }) => { if (error) console.error("persist user failed", error.message); });
    }

    const ctx: Ctx = {
      supabase,
      userSupabase,
      userId: user.id,
      sessionId: sessionId!,
      defaultPropertyId: propertyId,
      defaultFrom: from,
      defaultTo: to,
      scopeMode,
      allowedProperties,
    };

    const gateway = createOpenAICompatible({
      name: "lovable-ai",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: { "Lovable-API-Key": key },
    });

    const scopeLine = scopeMode === "property"
      ? `SINGLE LOCATION: ${allowedProperties[0]?.name ?? "selected location"} (property_id ${propertyId})`
      : `ALL LOCATIONS (${allowedProperties.length}): ${allowedProperties.map((p) => `${p.name} [${p.id}]`).join(", ") || "(none)"}`;
    const contextHeader = `\n\nACTIVE CONTEXT:\n- scope: ${scopeLine}\n- date_range: ${from ?? "?"} → ${to ?? "?"}\n\nSCOPE RULES (non-negotiable):\n- The dashboard location selector is the only thing that decides which locations you may discuss.\n- In SINGLE LOCATION scope, every answer and every tool call is about that location only. If the user asks about another location by name, say you're currently looking at ${allowedProperties[0]?.name ?? "the selected location"} and they should switch the location selector. Never pull or guess another location's numbers.\n- In ALL LOCATIONS scope, use get_portfolio_trend — one call that covers every location at once. Do NOT loop the per-location tools across all locations; that is slow and you do not need it. After the roll-up, drill into at most 2 locations that actually moved, and offer to look at the others instead of sweeping them all.\n- Never mention or infer data about a location that is not listed above.\n\nSPEED RULES:\n- Open with your one-line acknowledgement BEFORE you call any tool, so the user sees you working. Then run the lookups, then give the brief answer and the follow-up offer.\n- Prefer the fewest lookups that can answer the question. Do not re-run a tool you already have results from in this conversation.`;

    const result = streamText({
      model: gateway("google/gemini-3-flash-preview"),
      system: SYSTEM_PROMPT + contextHeader,
      messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
      tools: buildTools(ctx),
      stopWhen: stepCountIs(8),
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