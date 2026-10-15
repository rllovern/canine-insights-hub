// Private GHL -> CTM Form Sync.
// Two entry paths:
//  - Granted user (shared mops guard): view, run, review, approve held items.
//  - Scheduled (cron secret only): runs locations whose schedule_enabled flag is on, via the
//    narrow mops_formsync_internal entry point. Cannot approve, review or read other data.
// Posting to CTM requires BOTH the location's delivery_enabled flag AND FORM_SYNC_LIVE=true.
import { createClient } from "npm:@supabase/supabase-js@2";
import { mopsHandler, json, loadConnections, corsHeaders } from "../_shared/mops/guard.ts";
import { sendPlainEmail } from "../_shared/send-email.ts";
import { runLocation, type Deps, type PostResult } from "./engine.ts";
import type { CtmActivity, GhlSubmission } from "./logic.ts";

const GHL = "https://services.leadconnectorhq.com";
const CTM = "https://api.calltrackingmetrics.com/api/v1";
const READ_OPS = new Set(["formsync_overview", "formsync_list", "formsync_attempts", "formsync_config"]);
type Conn = Awaited<ReturnType<typeof loadConnections>>;

async function ghlList(token: string, loc: string, from: Date, to: Date): Promise<GhlSubmission[]> {
  const out: GhlSubmission[] = [];
  for (let page = 1; ; page++) {
    if (page > 200) throw new Error("GoHighLevel pagination did not finish");
    const u = new URL(`${GHL}/forms/submissions`);
    u.searchParams.set("locationId", loc); u.searchParams.set("limit", "100"); u.searchParams.set("page", String(page));
    u.searchParams.set("startAt", new Date(from.getTime() - 86400000).toISOString().slice(0, 10)); u.searchParams.set("endAt", new Date(to.getTime() + 86400000).toISOString().slice(0, 10));
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } });
    if (!r.ok) throw new Error(`GoHighLevel returned ${r.status}`);
    const j = await r.json();
    out.push(...(j.submissions ?? []));
    if (!j.meta?.nextPage) break;
  }
  return out.filter((s) => { const t = Date.parse(s.createdAt); return t >= from.getTime() && t <= to.getTime(); });
}

const ctmAuth = (c: NonNullable<Conn["ctm"]>) => "Basic " + btoa(`${c.api_token}:${c.api_secret}`);

async function ctmList(c: NonNullable<Conn["ctm"]>, from: Date, to: Date): Promise<CtmActivity[]> {
  const out: CtmActivity[] = [];
  for (let page = 1; ; page++) {
    // An incomplete CTM list could make a delivered lead look missing, so never accept a partial read.
    if (page > 300) throw new Error("CallTrackingMetrics pagination did not finish");
    const u = new URL(`${CTM}/accounts/${c.account_id}/calls.json`);
    u.searchParams.set("start_date", new Date(from.getTime() - 86400000).toISOString().slice(0, 10)); u.searchParams.set("end_date", new Date(to.getTime() + 86400000).toISOString().slice(0, 10));
    u.searchParams.set("per_page", "100"); u.searchParams.set("page", String(page));
    const r = await fetch(u, { headers: { Authorization: ctmAuth(c), Accept: "application/json" } });
    if (!r.ok) throw new Error(`CallTrackingMetrics returned ${r.status}`);
    const j = await r.json();
    for (const x of j.calls ?? []) {
      const f = x.form; if (!f || typeof f !== "object") continue;
      const cf = Object.fromEntries((f.custom ?? []).map((k: any) => [k.id ?? k.name, k.value]));
      out.push({ id: String(x.id), called_at_iso: new Date((x.unix_time ?? 0) * 1000).toISOString(), form_id: f.form_id != null ? String(f.form_id) : null,
        contact_id: cf.field_ghl_contact_id ?? null, submitted_at: cf.submitted_at ?? cf.ft_ts ?? null, message: cf.how_can_we_help_your_dog ?? null,
        submission_id: cf.ghl_submission_id ?? null, trackback_id: f.trackback_id ?? null, tag: x.sale?.name ?? null });
    }
    if (page >= Number(j.total_pages ?? 1)) break;
  }
  return out;
}

async function ctmGet(c: NonNullable<Conn["ctm"]>, id: string) {
  const r = await fetch(`${CTM}/accounts/${c.account_id}/calls/${encodeURIComponent(id)}`, { headers: { Authorization: ctmAuth(c), Accept: "application/json" } });
  if (!r.ok) return null;
  const x = await r.json();
  return { tag: (x.sale?.name ?? "").trim() || null, created_iso: new Date((x.unix_time ?? 0) * 1000).toISOString() };
}

async function ctmPost(c: NonNullable<Conn["ctm"]>, frt: string, payload: Record<string, string>): Promise<PostResult> {
  let r: Response;
  try {
    r = await fetch(`${CTM}/formreactor/${encodeURIComponent(frt)}`, { method: "POST", headers: { Authorization: ctmAuth(c) }, body: new URLSearchParams(payload), signal: AbortSignal.timeout(30000) });
  } catch (e) { return { kind: "ambiguous", error: `no response (${(e as Error).name})` }; }
  const text = await r.text().catch(() => "");
  if (r.status >= 500 || r.status === 429 || r.status === 408) return { kind: "ambiguous", error: `status ${r.status}` };
  if (!r.ok) return { kind: "rejected", status: r.status, error: text.slice(0, 200) };
  try {
    const j = JSON.parse(text);
    if (j.status === "success") return { kind: "accepted", ref: j.trackback_id ?? null };
    return { kind: "ambiguous", error: `unexpected body status ${String(j.status).slice(0, 40)}` };
  } catch { return { kind: "ambiguous", error: "unreadable response" }; }
}

function depsFor(call: Deps["call"], conn: Conn, cfg: any): Deps {
  if (!conn.ghl || !conn.ctm) throw new Error("This location is missing its GHL or CTM connection");
  const ghl = conn.ghl, ctm = conn.ctm;
  return {
    call, now: () => new Date(),
    live: cfg?.delivery_enabled === true && Deno.env.get("FORM_SYNC_LIVE") === "true",
    ghlList: (f, t) => ghlList(ghl.token, ghl.location_id, f, t),
    ctmList: (f, t) => ctmList(ctm, f, t),
    ctmGet: (id) => ctmGet(ctm, id),
    ctmPost: (p) => ctmPost(ctm, cfg.ctm_form_reactor_id, p),
  };
}

async function sendAlerts(call: Deps["call"], pid: string) {
  const a = await call("formsync_alerts", { property_id: pid });
  if (!a.recipient) return { sent: 0 };
  let sent = 0;
  const line = (r: any) => `  - ${r.masked?.name ?? "Unknown"} · ${r.form_source ?? "form"} · submitted ${new Date(r.submitted_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET${r.status ? ` · ${r.status}` : ""}`;
  if (a.unconfirmed.length) {
    const res = await sendPlainEmail(a.recipient, `Form Sync: ${a.unconfirmed.length} ${a.property_name} lead(s) not confirmed in CTM`,
      [`These GoHighLevel submissions are still not confirmed in CallTrackingMetrics more than 30 minutes after they were submitted:`, "", ...a.unconfirmed.map(line), "", "Open Marketing Ops → Form Sync to review."].join("\n"));
    if (res.sent) { sent++; await call("formsync_mark_alerted", { kind: "unconfirmed", ids: a.unconfirmed.map((r: any) => r.id) }); }
  }
  if (a.unqualified.length) {
    const res = await sendPlainEmail(a.recipient, `Form Sync: ${a.unqualified.length} ${a.property_name} lead(s) not classified by AskAI`,
      [`These leads reached CallTrackingMetrics but still have no reporting tag after 5 minutes. No tag was applied automatically:`, "", ...a.unqualified.map(line), "", "Open Marketing Ops → Form Sync to review."].join("\n"));
    if (res.sent) { sent++; await call("formsync_mark_alerted", { kind: "unqualified", ids: a.unqualified.map((r: any) => r.id) }); }
  }
  return { sent };
}

async function scheduled(req: Request): Promise<Response | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
  if (!token || token.split(".").length === 3) return null; // user JWTs go to the guarded path
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: vaultSecret } = await admin.rpc("get_cron_secret_v2");
  const envSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!((!!vaultSecret && token === vaultSecret) || (!!envSecret && token === envSecret))) return json({ error: "Not found" }, 404);
  const call: Deps["call"] = async (op, args = {}) => {
    const { data, error } = await admin.rpc("mops_formsync_internal", { _op: op, _args: args });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error(String((data as any).error));
    return data;
  };
  const { locations } = await call("formsync_scheduled_locations");
  const results: Record<string, unknown> = {};
  for (const pid of locations as string[]) {
    try {
      const { config } = await call("formsync_config", { property_id: pid });
      results[pid] = await runLocation(depsFor(call, await loadConnections(admin, pid), config), pid);
    } catch (e) {
      results[pid] = { error: (e as Error).message };
      await call("formsync_run_failed", { property_id: pid, error: (e as Error).message }).catch(() => {});
    }
    try { await sendAlerts(call, pid); } catch (e) { console.error("[mops-form-sync] alerts", (e as Error).message); }
  }
  return json({ locations: (locations as string[]).length, results });
}

const userHandler = mopsHandler("mops-form-sync", async (ctx) => {
  const op = String(ctx.body.op ?? "");
  const args = (ctx.body.args && typeof ctx.body.args === "object") ? ctx.body.args as Record<string, unknown> : {};
  if (READ_OPS.has(op)) return json(await ctx.call(op, args));
  const pid = String(args.property_id ?? "");

  if (op === "run" || op === "recheck") {
    const { config } = await ctx.call("formsync_config", { property_id: pid }) as any;
    if (!config) return json({ error: "Form Sync is not set up for this location" }, 400);
    try {
      return json(await runLocation(depsFor(ctx.call, await ctx.connections(pid), config), pid, { from: typeof args.from === "string" ? args.from : undefined }));
    } catch (e) {
      await ctx.call("formsync_run_failed", { property_id: pid, error: (e as Error).message });
      throw e;
    }
  }
  if (op === "review") {
    const action = String(args.action);
    if (action === "link") return json(await ctx.call("formsync_set", { id: args.id, status: "matched", ctm_activity_id: String(args.ctm_activity_id ?? ""), review: true, kind: "review", log: { action } }));
    if (action === "approve") return json(await ctx.call("formsync_approve", { id: args.id }));
    return json({ error: "Unknown review action" }, 400);
  }
  return json({ error: "Unknown operation" }, 400);
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return (await scheduled(req)) ?? userHandler(req);
});
