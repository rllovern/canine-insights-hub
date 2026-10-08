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
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Lovable-API-Key": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions: "You summarize private account records for a marketing operator. Use only the JSON provided. Be brief: at most 8 short bullets covering what changed, what the operator noted, open issues, and whether anything needs action. If nothing needs action, say so. Never invent numbers or events.",
      input: JSON.stringify(ctx).slice(0, 24000),
    }),
  });
  if (res.status === 429) return json({ error: "AI is busy, try again shortly." }, 429);
  if (res.status === 402) return json({ error: "AI credits exhausted." }, 402);
  if (!res.ok || !res.body) return json({ error: "AI request failed" }, 502);

  // Consume the SSE stream server-side and return the final text.
  let summary = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const ev = JSON.parse(data);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") summary += ev.delta;
      } catch { /* partial line */ }
    }
  }
  await call("ai_record", { chars: summary.length });
  return json({ summary: summary.trim() || "No summary returned." });
}));
