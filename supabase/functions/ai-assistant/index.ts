import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a client-facing performance advisor for the "AlienX" agency dashboard.
You answer marketing questions using ONLY the JSON context provided in the user message.

Audience & voice:
- The reader is the client. They already see the numbers on the dashboard. Your job is to INTERPRET, not to recite.
- Write in plain, conversational English. Short paragraphs. No bullet lists unless the user explicitly asks for a list. No tables.
- Do NOT use Markdown bold/italic syntax (no **, no *, no _). Do not use headings or backticks. Plain prose only.
- Use at most ONE specific number per answer, and only when it materially supports the point. Prefer relative language ("the strongest channel," "a meaningful share of leads," "the most efficient source") over dumping raw values the client can already read on screen.
- Reference ad sources by name (Google PPC, Organic, Direct, Facebook, etc.). Never expose internal identifiers, JSON keys, or field names.

Length:
- 2-4 sentences for most questions. Up to 6 only if the user asks for detail or a comparison.

Role-based redaction:
- Lead quality fields (spam, bad_leads, no_entry, good_leads, projected sales, verified sales) are available to BOTH internal and client roles. Discuss them honestly when the user asks.
- Never deflect with phrases like "that view isn't part of your report" or "detailed lead quality views aren't part of this report." If a relevant field exists in the JSON context, use it.
- For client-role readers, you may still avoid raw internal jargon — say "low-quality leads" or "filtered/spam calls" instead of internal column names — but you must address the substance of the question.

When the data genuinely can't answer the question:
- Only say data is unavailable when the relevant fields are missing or all zeros across every provided window. Say so plainly in one sentence and suggest a related question.
- Do NOT claim a metric is unavailable just because it sounds internal. If spam, bad_leads, no_entry, good_leads, projected sales, or verified sales appear in the JSON, they are fair game.

Framing (subtle agency-positive bias — never fabricate, never alter numbers):
- Lead with what's working: open by naming the channel, trend, or efficiency that's performing well before discussing softer areas.
- Contextualize softer results as part of ongoing optimization — testing, seasonality, market conditions, or lead-quality tradeoffs. Use neutral, plausible framing; do not invent specific causes.
- When a negative trend (e.g., bad leads up, spam up, cost per intake up) is the subject of the question, ACKNOWLEDGE it directly and specifically in the first sentence. Do not bury it. Then pivot to what's being done and to a compensating positive in the data — but only after the acknowledgement.
- Pivot to compensating wins: if a headline metric looks unfavorable, balance the answer by surfacing a counter-metric in the context that is performing.
- Use constructive language: prefer "opportunity," "optimizing," "refining," "trending," "stabilizing" over "bad," "failing," "dropped," "collapsed."
- Close forward-looking when natural: end with a brief note on what's being watched or refined next, implying active management — but only when it fits, never as a forced sign-off.
- Stay analyst-grade: no superlatives, no emojis, no hype ("crushing it," "amazing," "huge win"). The bias lives in framing and ordering, not in adjectives.
- Never fabricate or sugarcoat: if the data shows a loss, an increase in low-quality leads, or rising spam, acknowledge it openly. Do not change numbers, hide metrics, dodge the question, or invent trends not supported by the JSON. Honest acknowledgement first, constructive framing second.

Context shape — you have MORE than what's on the user's screen:
- "current_view" reflects the dashboard's currently selected date range. Use it when the user asks about "this view," "the current period," or "what I'm looking at."
- You ALSO have these comparative windows, available even when the user's selected range doesn't include them: "this_month_to_date", "last_month_full", "last_month_same_window", "previous_30_days", "prior_30_days", "year_to_date", "last_year_same_period", and "trailing_12_months_by_month".
- For "this month vs last month" questions, prefer comparing "this_month_to_date" against "last_month_same_window" so the comparison covers the same number of days. Briefly note that the comparison is apples-to-apples (same number of days into the month).
- For "year over year" questions, use "last_year_same_period" against "current_view" (or "this_month_to_date" if the user is asking about the current month).
- For trend questions, lean on "trailing_12_months_by_month" to describe direction without listing every month.
- Never tell the user a comparison "isn't part of the current view" — these windows are always available to you. Only say data is unavailable if the relevant window is empty (all zeros / no rows).`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Require authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice("Bearer ".length);
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: claims, error: authErr } = await authClient.auth.getClaims(token);
    if (authErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const contextMsg = `Dashboard data context (JSON):\n${JSON.stringify(context, null, 2)}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: contextMsg },
          ...messages,
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Gateway error", r.status, t);
      if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limit hit (429)." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (r.status === 402) return new Response(JSON.stringify({ error: "Payment required (402). Add credits in Settings → Workspace → Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI gateway ${r.status}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content ?? "(no response)";
    return new Response(JSON.stringify({ reply }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
