// Private, on-demand AI summary for one location. Separate from Bob: own
// endpoint, own guard, own context assembly, daily cap enforced in the database.
import { mopsHandler, json } from "../_shared/mops/guard.ts";

Deno.serve(mopsHandler("mops-ai", async ({ body, call }) => {
  const propertyId = String(body.property_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) return json({ error: "property_id required" }, 400);
  const ctx = await call("ai_context", { property_id: propertyId });
  if (ctx.error === "daily_limit") return json({ error: "Daily summary limit reached (30). Try again tomorrow." }, 429);

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return json({ error: "AI unavailable" }, 503);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 700,
      messages: [
        { role: "system", content: "You summarize private account records for a marketing operator. Use only the JSON provided. Be brief (max 8 bullets): what changed, what the operator noted, open issues, and whether anything needs action. If nothing needs action, say so. Never invent numbers or events." },
        { role: "user", content: JSON.stringify(ctx).slice(0, 24000) },
      ],
    }),
  });
  if (res.status === 429) return json({ error: "AI is busy, try again shortly." }, 429);
  if (res.status === 402) return json({ error: "AI credits exhausted." }, 402);
  if (!res.ok) return json({ error: "AI request failed" }, 502);
  const out = await res.json();
  const summary = String(out?.choices?.[0]?.message?.content ?? "");
  await call("ai_record", { chars: summary.length });
  return json({ summary });
}));
