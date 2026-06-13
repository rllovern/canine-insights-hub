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

const SYSTEM_PROMPT = `You are Jarvis, an AI Command Agent for an advertising/CRM analytics platform.

You operate the dashboard on behalf of an authenticated user. NEVER invent numbers. ALWAYS call a tool to get data before answering.

RULES:
- For any analytical question, call the relevant tool(s) first, then answer using only the tool output.
- If the user asks for "missing CTM leads in GHL", "reconciliation", "leads that didn't make it", etc., call reconcile_ctm_to_ghl, then save_visual_report with a complete report schema, then briefly describe what you found.
- When the user asks for account/property-specific analysis and the request context includes an active propertyId, use that propertyId automatically. Do not ask the user for a property ID if one is present in request context.
- Always include scope (property, date range, sources used) when reporting numbers.
- If a tool returns caveats or data-freshness warnings, surface them.
- If property access is denied, tell the user and stop.
- Keep prose concise — 2-5 sentences. Lead with the answer. Recommend next actions.
- Never claim you took a write action; you only have read+report tools in this phase.

REPORT SCHEMA (when calling save_visual_report):
The 'schema' arg must include type:"report", title, scope, summary_cards, charts, tables, recommendations, evidence.
CHART SHAPE (strict): each chart MUST be { type: "bar"|"line"|"area", title, x: "<dataKey>", y: ["<dataKey>", ...], data: [{...}] }.
- Use "x" (string) and "y" (array of strings), NOT "x_key" and NOT "series".
- Every key in "x" and "y" must exist on each row of "data".
TABLE SHAPE (strict): { title, columns: [{ key, label, align? }], rows: [{...}] }. Every column.key must exist on each row.`;

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

  console.log("[Jarvis Edge Auth Debug]", {
    hasAuthHeader: !!authHeader,
    authHeaderStartsBearer: authHeader.startsWith("Bearer "),
    tokenPrefix: token.slice(0, 12),
    hasApikeyHeader: !!apikeyHeader,
  });
  console.log("[Jarvis Edge Env Debug]", {
    supabaseHost: supabaseUrl ? new URL(supabaseUrl).host : null,
    hasAnonKey: !!supabaseAnonKey,
    hasServiceRoleKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });

  if (!token || !authHeader.startsWith("Bearer ")) {
    return { user: null, error: "Missing Authorization Bearer token", detail: null };
  }

  const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser();

  console.log("[Jarvis Edge User Debug]", {
    hasUser: !!user,
    userId: user?.id,
    userErrorMessage: userError?.message,
  });

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
      description: "Speed-to-lead, response stats, and currently waiting leads for a property.",
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
          ctx.supabase.rpc("lead_perf_speed", {
            _property_ids: [id], _from: from.toISOString(), _to: to.toISOString(),
          }),
          ctx.supabase.rpc("lead_perf_handling", {
            _property_ids: [id], _from: from.toISOString(), _to: to.toISOString(),
          }),
        ]);
        return { property_id: id, days: i.days, speed: speed.data, handling: handling.data };
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
            schema_json: i.schema,
            evidence_json: i.evidence ?? null,
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
    console.log("jarvis body keys:", Object.keys(body));
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

    console.log("[Jarvis Edge Body Context]", {
      propertyId: body?.propertyId ?? null,
      contextPropertyId: body?.context?.propertyId ?? null,
      propertyName: body?.propertyName ?? body?.context?.propertyName ?? null,
      dateRange: body?.dateRange ?? body?.context?.dateRange ?? null,
      messageCount: body?.messages?.length,
    });

    console.log("[Jarvis Edge Context Debug]", {
      propertyId,
      propertyName: body.propertyName ?? body.context?.propertyName ?? null,
      from,
      to,
      sessionId: sessionId ?? null,
      pageContext: body.pageContext ?? null,
    });

    const supabase = svc();

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