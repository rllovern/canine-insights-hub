// Private GHL -> CTM Form Sync. Guarded like every mops-* endpoint.
// Delivery to CTM is hard-disabled: it requires the location's delivery_enabled flag
// AND the FORM_SYNC_LIVE kill switch. Otherwise every "deliver" returns a dry-run plan.
import { mopsHandler, json, type MopsCtx } from "../_shared/mops/guard.ts";
import { attributionOf, buildCtmPayload, maskEmail, maskName, maskPayload, maskPhone, matchSubmission, normMsg, sha256, type CtmActivity, type GhlSubmission } from "./logic.ts";

const GHL = "https://services.leadconnectorhq.com";
const CTM = "https://api.calltrackingmetrics.com/api/v1";
const READ_OPS = new Set(["formsync_overview", "formsync_list", "formsync_attempts", "formsync_config"]);

async function ghlSubmissions(token: string, loc: string, from: Date, to: Date): Promise<GhlSubmission[]> {
  const out: GhlSubmission[] = [];
  for (let page = 1; page <= 50; page++) {
    const u = new URL(`${GHL}/forms/submissions`);
    u.searchParams.set("locationId", loc); u.searchParams.set("limit", "100"); u.searchParams.set("page", String(page));
    u.searchParams.set("startAt", from.toISOString().slice(0, 10)); u.searchParams.set("endAt", new Date(to.getTime() + 86400000).toISOString().slice(0, 10));
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } });
    if (!r.ok) throw new Error(`GoHighLevel returned ${r.status}`);
    const j = await r.json();
    out.push(...(j.submissions ?? []));
    if (!j.meta?.nextPage) break;
  }
  return out.filter((s) => { const t = Date.parse(s.createdAt); return t >= from.getTime() && t <= to.getTime(); });
}

async function ctmFormActivities(c: { account_id: string; api_token: string; api_secret: string }, from: Date, to: Date): Promise<CtmActivity[]> {
  const auth = "Basic " + btoa(`${c.api_token}:${c.api_secret}`);
  const out: CtmActivity[] = [];
  for (let page = 1; page <= 30; page++) {
    const u = new URL(`${CTM}/accounts/${c.account_id}/calls.json`);
    u.searchParams.set("start_date", from.toISOString().slice(0, 10)); u.searchParams.set("end_date", to.toISOString().slice(0, 10));
    u.searchParams.set("per_page", "100"); u.searchParams.set("page", String(page));
    const r = await fetch(u, { headers: { Authorization: auth, Accept: "application/json" } });
    if (!r.ok) throw new Error(`CallTrackingMetrics returned ${r.status}`);
    const j = await r.json();
    for (const x of j.calls ?? []) {
      const f = x.form; if (!f || typeof f !== "object") continue;
      const cf = Object.fromEntries((f.custom ?? []).map((k: any) => [k.id ?? k.name, k.value]));
      out.push({ id: String(x.id), called_at_iso: new Date((x.unix_time ?? 0) * 1000).toISOString(), form_id: f.form_id != null ? String(f.form_id) : null,
        contact_id: cf.field_ghl_contact_id ?? null, submitted_at: cf.submitted_at ?? cf.ft_ts ?? null, message: cf.how_can_we_help_your_dog ?? null });
    }
    if (page >= Number(j.total_pages ?? 1)) break;
  }
  return out;
}

async function reconcile(ctx: MopsCtx, pid: string, cfg: any, onlyId?: string) {
  const conn = await ctx.connections(pid);
  if (!conn.ctm || !conn.ghl) throw new Error("This location is missing its GHL or CTM connection");
  const { submissions } = await ctx.call("formsync_list", { property_id: pid }) as { submissions: any[] };
  const open = submissions.filter((s) => (onlyId ? s.id === onlyId : !["matched", "delivered"].includes(s.status)));
  if (!open.length) return { checked: 0 };
  const times = open.map((s) => Date.parse(s.submitted_at));
  const from = new Date(Math.min(...times) - 86400000), to = new Date(Math.max(...times) + 86400000);
  const acts = await Promise.all((await ctmFormActivities(conn.ctm, from, to)).map(async (a) => ({ ...a, message_hash: a.message ? await sha256(normMsg(a.message)) : null })));
  const claimed = new Set(submissions.filter((s) => s.ctm_activity_id).map((s) => String(s.ctm_activity_id)));
  // Fetch originals once (for the dry-run payload); message text is never stored.
  const subsById = new Map((await ghlSubmissions(conn.ghl.token, conn.ghl.location_id, from, to)).map((s) => [s.id, s]));
  const res = { checked: 0, matched: 0, needs_review: 0, pending_delivery: 0 };
  for (const s of open) {
    const v = matchSubmission({ contact_id: s.ghl_contact_id, submitted_at: s.submitted_at, message_hash: s.message_hash ?? null, form_numeric_id: String(cfg.ctm_form_numeric_id) }, acts, claimed);
    const orig = subsById.get(s.ghl_submission_id);
    const payload = orig ? buildCtmPayload(orig, cfg.ghl_message_key, cfg.message_field) : null;
    if (v.activity_id) claimed.add(v.activity_id);
    await ctx.call("formsync_set", {
      id: s.id, status: v.status, kind: "reconcile", ctm_activity_id: v.activity_id ?? "",
      match_detail: { checked_at: new Date().toISOString(), ctm_activities_scanned: acts.length, candidates: v.candidates },
      dry_run_payload: payload && v.status === "pending_delivery" ? {
        target: { method: "POST", url: `${CTM}/formreactor/${cfg.ctm_form_reactor_id}`, form_reactor_numeric_id: cfg.ctm_form_numeric_id },
        fields: maskPayload(payload as Record<string, string>, cfg.message_field),
      } : null,
      log: { candidates: v.candidates.length },
    });
    res.checked++; res[v.status]++;
  }
  return res;
}

Deno.serve(mopsHandler("mops-form-sync", async (ctx) => {
  const op = String(ctx.body.op ?? "");
  const args = (ctx.body.args && typeof ctx.body.args === "object") ? ctx.body.args as Record<string, unknown> : {};
  if (READ_OPS.has(op)) return json(await ctx.call(op, args));
  const pid = String(args.property_id ?? "");

  if (op === "run" || op === "recheck") {
    const { config: cfg } = await ctx.call("formsync_config", { property_id: pid }) as any;
    if (!cfg) return json({ error: "Form Sync is not set up for this location" }, 400);
    try {
      if (op === "run") {
        const conn = await ctx.connections(pid);
        if (!conn.ghl) throw new Error("GHL connection missing");
        const { checkpoint } = await ctx.call("formsync_config", { property_id: pid }) as any;
        const now = new Date();
        const lookback = new Date(now.getTime() - cfg.lookback_minutes * 60000);
        const floor = new Date(now.getTime() - 30 * 86400000);
        let from = checkpoint?.last_window_end ? new Date(Math.min(Date.parse(checkpoint.last_window_end) - cfg.lookback_minutes * 60000, lookback.getTime())) : lookback;
        if (typeof args.from === "string") from = new Date(args.from);
        if (from < floor) from = floor;
        const subs = await ghlSubmissions(conn.ghl.token, conn.ghl.location_id, from, now);
        const items = await Promise.all(subs.map(async (s) => {
          const o = s.others ?? {};
          const msg = cfg.ghl_message_key ? o[cfg.ghl_message_key] : null;
          return { ghl_submission_id: s.id, ghl_contact_id: s.contactId ?? null, ghl_form_id: s.formId ?? null, submitted_at: s.createdAt,
            masked: { name: maskName(s.name), email: maskEmail(String(o.email ?? s.email ?? "")), phone: maskPhone(String(o.phone ?? "")), has_message: !!msg },
            message_hash: msg ? await sha256(normMsg(msg)) : null, attribution: attributionOf(s) };
        }));
        const ing = await ctx.call("formsync_ingest", { property_id: pid, items, window_end: now.toISOString() });
        const rec = await reconcile(ctx, pid, cfg);
        return json({ window: { from: from.toISOString(), to: now.toISOString() }, fetched: subs.length, ...ing, reconcile: rec });
      }
      return json(await reconcile(ctx, pid, cfg, String(args.id)));
    } catch (e) {
      await ctx.call("formsync_run_failed", { property_id: pid, error: (e as Error).message });
      throw e;
    }
  }

  if (op === "review") {
    const action = String(args.action);
    if (action === "link") return json(await ctx.call("formsync_set", { id: args.id, status: "matched", ctm_activity_id: String(args.ctm_activity_id ?? ""), review: true, kind: "review", log: { action } }));
    if (action === "needs_delivery") return json(await ctx.call("formsync_set", { id: args.id, status: "pending_delivery", review: true, kind: "review", log: { action } }));
    return json({ error: "Unknown review action" }, 400);
  }

  if (op === "deliver") {
    const { submission } = await ctx.call("formsync_get", { id: args.id }) as any;
    if (!submission) return json({ error: "Not found" }, 404);
    const { config: cfg } = await ctx.call("formsync_config", { property_id: submission.property_id }) as any;
    const live = cfg?.delivery_enabled === true && Deno.env.get("FORM_SYNC_LIVE") === "true";
    if (!live) return json({ dry_run: true, reason: "Live delivery is switched off for this location", plan: submission.dry_run_payload });
    // Live path intentionally not reachable until the first live test is approved.
    return json({ error: "Live delivery has not been approved yet" }, 400);
  }
  return json({ error: "Unknown operation" }, 400);
}));
