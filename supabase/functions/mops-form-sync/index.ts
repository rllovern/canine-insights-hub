// Private agency-wide Lead Reconciliation (GHL -> CTM).
// Two entry paths:
//  - Granted user (shared mops guard): view, run, review, classify forms, pause/resume, approve live per location.
//  - Scheduled (cron secret only, every 5 min): reconciles every location in monitor/live mode, runs the daily
//    read-only preflight checks (bounded per run), checks call discrepancies hourly and sends alerts.
//    It uses the narrow mops_formsync_internal entry point and can never approve live sending,
//    lift a manual hold, classify forms or review submissions.
// Posting to CTM requires: location mode 'live' (set only by the administrator), delivery_enabled, no manual
// hold, AND the global FORM_SYNC_LIVE switch.
import { createClient } from "npm:@supabase/supabase-js@2";
import { mopsHandler, json, loadConnections, corsHeaders } from "../_shared/mops/guard.ts";
import { sendPlainEmail } from "../_shared/send-email.ts";
import { runLocation, type Deps, type PostResult } from "./engine.ts";
import { runPreflight, type ActWithCustom, type Reactor } from "./recon.ts";
import type { GhlSubmission } from "./logic.ts";
import { NORCAL } from "./production-watch.ts";

const GHL = "https://services.leadconnectorhq.com";
const CTM = "https://api.calltrackingmetrics.com/api/v1";
const READ_OPS = new Set(["formsync_overview", "formsync_list", "formsync_attempts", "formsync_config", "formsync_recon_overview", "formsync_recon_location"]);
const ADMIN_OPS = new Set(["formsync_recon_form_classify", "formsync_recon_set_hold", "formsync_recon_set_live", "formsync_recon_set_call_expectation"]);
type Conn = Awaited<ReturnType<typeof loadConnections>>;
type Call = Deps["call"];
const MIN = 60000;

const ghlHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" });

async function ghlList(token: string, loc: string, from: Date, to: Date): Promise<GhlSubmission[]> {
  const out: GhlSubmission[] = [];
  for (let page = 1; ; page++) {
    if (page > 200) throw new Error("GoHighLevel pagination did not finish");
    const u = new URL(`${GHL}/forms/submissions`);
    u.searchParams.set("locationId", loc); u.searchParams.set("limit", "100"); u.searchParams.set("page", String(page));
    u.searchParams.set("startAt", new Date(from.getTime() - 86400000).toISOString().slice(0, 10)); u.searchParams.set("endAt", new Date(to.getTime() + 86400000).toISOString().slice(0, 10));
    const r = await fetch(u, { headers: ghlHeaders(token) });
    if (!r.ok) throw new Error(`GoHighLevel returned ${r.status}`);
    const j = await r.json();
    out.push(...(j.submissions ?? []));
    if (!j.meta?.nextPage) break;
  }
  return out.filter((s) => { const t = Date.parse(s.createdAt); return t >= from.getTime() && t <= to.getTime(); });
}

async function ghlForms(token: string, loc: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (let skip = 0; skip < 2000; skip += 50) {
    const u = new URL(`${GHL}/forms/`);
    u.searchParams.set("locationId", loc); u.searchParams.set("limit", "50"); u.searchParams.set("skip", String(skip));
    const r = await fetch(u, { headers: ghlHeaders(token) });
    if (!r.ok) throw new Error(`GoHighLevel forms returned ${r.status}`);
    const j = await r.json();
    const forms = (j.forms ?? []) as any[];
    out.push(...forms.map((f) => ({ id: String(f.id), name: String(f.name ?? "") })));
    if (forms.length < 50 || (j.total && out.length >= Number(j.total))) break;
  }
  return out;
}

const ctmAuth = (c: NonNullable<Conn["ctm"]>) => "Basic " + btoa(`${c.api_token}:${c.api_secret}`);

async function ctmList(c: NonNullable<Conn["ctm"]>, from: Date, to: Date, msgField = "how_can_we_help_your_dog"): Promise<ActWithCustom[]> {
  const out: ActWithCustom[] = [];
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
        contact_id: cf.field_ghl_contact_id ?? null, submitted_at: cf.submitted_at ?? cf.ft_ts ?? null, message: cf[msgField] ?? null,
        submission_id: cf.ghl_submission_id ?? null, trackback_id: f.trackback_id ?? null, tag: x.sale?.name ?? null, custom: cf });
    }
    if (page >= Number(j.total_pages ?? 1)) break;
  }
  return out;
}

async function ctmReactors(c: NonNullable<Conn["ctm"]>): Promise<Reactor[]> {
  const out: Reactor[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${CTM}/accounts/${c.account_id}/form_reactors.json?per_page=100&page=${page}`, { headers: { Authorization: ctmAuth(c), Accept: "application/json" } });
    if (!r.ok) throw new Error(`CTM FormReactor list returned ${r.status}`);
    const j = await r.json();
    const list = (j.form_reactors ?? j.forms ?? j.formreactors ?? []) as any[];
    for (const x of list) {
      const vals = [x.id, x.token, x.form_reactor_id, x.unique_id, x.sid, x.uuid].map((v) => (v == null ? "" : String(v)));
      const nums = [x.numeric_id, x.form_id, x.id, x.form_reactor_numeric_id].map((v) => (v == null ? "" : String(v)));
      out.push({ frt: vals.find((v) => /^FRT/i.test(v)) ?? null, numeric: nums.find((v) => /^\d+$/.test(v)) ?? null, name: x.name ?? null });
    }
    if (page >= Number(j.total_pages ?? 1)) break;
  }
  return out;
}

async function ctmGet(c: NonNullable<Conn["ctm"]>, id: string, messageField?: string) {
  const r = await fetch(`${CTM}/accounts/${c.account_id}/calls/${encodeURIComponent(id)}`, { headers: { Authorization: ctmAuth(c), Accept: "application/json" } });
  if (!r.ok) return null;
  const x = await r.json();
  const fields = Object.fromEntries((x.form?.custom ?? []).map((k: any) => [k.id ?? k.name, k.value]));
  // CTM's reporting tag alone cannot establish which rule or AskAI applied it.
  return { tag: (x.sale?.name ?? "").trim() || null, created_iso: new Date((x.unix_time ?? 0) * 1000).toISOString(),
    message: messageField ? fields[messageField] ?? null : null, askai_verified: false };
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

function depsFor(call: Call, conn: Conn, cfg: any): Deps {
  if (!conn.ghl || !conn.ctm) throw new Error("This location is missing its GHL or CTM connection");
  if (!cfg?.ctm_form_reactor_id || !cfg?.ctm_form_numeric_id) throw new Error("This location has no verified CTM FormReactor yet");
  const ghl = conn.ghl, ctm = conn.ctm;
  return {
    call, now: () => new Date(),
    live: cfg.mode === "live" && cfg.delivery_enabled === true && cfg.manual_hold !== true && Deno.env.get("FORM_SYNC_LIVE") === "true",
    ghlList: (f, t) => ghlList(ghl.token, ghl.location_id, f, t),
    ctmList: (f, t) => ctmList(ctm, f, t, cfg.message_field),
    ctmGet: (id) => ctmGet(ctm, id, cfg.message_field),
    ctmPost: (p) => ctmPost(ctm, cfg.ctm_form_reactor_id, p),
  };
}

async function preflightFor(call: Call, conn: Conn, loc: any) {
  const ghl = conn.ghl, ctm = conn.ctm;
  const { config: cur } = await call("formsync_config", { property_id: loc.property_id }).catch(() => ({ config: null }));
  const r = await runPreflight({
    ghlForms: () => ghlForms(ghl!.token, ghl!.location_id),
    ghlSubs: (f, t) => ghlList(ghl!.token, ghl!.location_id, f, t),
    ctmReactors: () => ctmReactors(ctm!),
    ctmActs: (f, t, m) => ctmList(ctm!, f, t, m),
    now: () => new Date(),
  }, { ghl_status: loc.ghl_status, ctm_status: loc.ctm_status, has_ghl: !!ghl, has_ctm: !!ctm && !!ctm.api_token,
    message_field: cur?.message_field ?? null, composite: cur?.composite_match === true });
  if (r.forms.length) await call("formsync_recon_forms_upsert", { property_id: loc.property_id, forms: r.forms });
  const saved = await call("formsync_recon_preflight_save", { property_id: loc.property_id, passed: r.passed, matching_verified: r.matching_verified,
    reasons: r.reasons, checks: r.checks, frt: r.frt ?? "", form_numeric_id: r.form_numeric_id ?? "", message_field: r.message_field ?? "" });
  return { ...saved, reasons: r.reasons, forms: r.forms.length };
}

const etTime = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET";

async function sendAlerts(call: Call, pid: string, cfg: any) {
  const a = await call("formsync_alerts", { property_id: pid });
  if (!a.recipient) return { sent: 0 };
  let sent = 0;
  const line = (r: any) => `  - ${r.masked?.name ?? "Unknown"} · ${r.form_source ?? "form"} · submitted ${etTime(r.submitted_at)}${r.status ? ` · ${r.status}` : ""}`;
  // Monitoring locations whose matching is not yet verified show unconfirmed leads in the dashboard only.
  const unconfirmedAlerts = cfg?.mode === "live" || cfg?.matching_verified === true;
  if (unconfirmedAlerts && a.unconfirmed.length) {
    const res = await sendPlainEmail(a.recipient, `Lead Reconciliation: ${a.unconfirmed.length} ${a.property_name} lead(s) not confirmed in CTM`,
      [`These GoHighLevel submissions are still not confirmed in CallTrackingMetrics more than 30 minutes after they were submitted${cfg?.mode === "live" ? "" : " (monitoring only — nothing is sent automatically for this location)"}:`, "", ...a.unconfirmed.map(line), "", "Open Marketing Ops → Lead Reconciliation to review."].join("\n"));
    if (res.sent) { sent++; await call("formsync_mark_alerted", { kind: "unconfirmed", ids: a.unconfirmed.map((r: any) => r.id) }); }
  }
  if (a.unqualified.length) {
    const res = await sendPlainEmail(a.recipient, `Lead Reconciliation: ${a.unqualified.length} ${a.property_name} lead(s) not classified by AskAI`,
      [cfg?.production_watch_limit === 5 ? "These NorCal leads need inquiry/qualification review. A reporting tag is not proof that AskAI classified the inquiry." : "These leads reached CallTrackingMetrics but still have no reporting tag after the review window. No tag was applied automatically:", "", ...a.unqualified.map(line), "", "Open Marketing Ops → Lead Reconciliation to review."].join("\n"));
    if (res.sent) { sent++; await call("formsync_mark_alerted", { kind: "unqualified", ids: a.unqualified.map((r: any) => r.id) }); }
  }
  return { sent };
}

/** Location-level alerts with state-change suppression. */
async function sendLocationAlerts(call: Call, pid: string) {
  const a = await call("formsync_recon_alert_items", { property_id: pid });
  if (!a.recipient || a.manual_hold) return;
  const state = (k: string) => a.state?.[`${pid}:${k}`] ?? null;
  const mail = (subject: string, lines: string[]) => sendPlainEmail(a.recipient, `Lead Reconciliation: ${a.property_name} — ${subject}`, [...lines, "", "Open Marketing Ops → Lead Reconciliation for details."].join("\n"));

  const pf = a.preflight_status === "failed" ? `failed:${JSON.stringify(a.preflight_reasons ?? [])}` : String(a.preflight_status ?? "none");
  if (state("preflight")?.state !== pf) {
    let sent = false;
    if (a.preflight_status === "failed") sent = (await mail(a.mode === "live" ? "live location failed its daily checks" : "location held — checks failed",
      ["The automatic location checks did not pass. Nothing will be sent to CTM for this location until they do.", "", ...(a.preflight_reasons ?? []).map((r: string) => `  - ${r}`)])).sent;
    await call("formsync_recon_mark_alert", { key: `${pid}:preflight`, state: pf, sent });
  }
  const conn = (a.consecutive_failures ?? 0) >= 3 ? "failing" : "ok";
  if (state("conn")?.state !== conn) {
    let sent = false;
    if (conn === "failing") sent = (await mail("API connection failing", [`The last ${a.consecutive_failures} reconciliation runs failed.`, `Last error: ${a.last_error ?? "unknown"}`])).sent;
    await call("formsync_recon_mark_alert", { key: `${pid}:conn`, state: conn, sent });
  }
  if (a.review.length) {
    const r = await mail(`${a.review.length} match(es) need manual review`, ["These submissions have more than one possible CTM activity. Nothing was sent:", "",
      ...a.review.map((x: any) => `  - ${x.masked?.name ?? "Unknown"} · ${x.form_source ?? "unknown source"} · ${etTime(x.submitted_at)}`)]);
    if (r.sent) await call("formsync_recon_mark_alert", { review_ids: a.review.map((x: any) => x.id) });
  }
  if (a.calls_expected.length) {
    const r = await mail(`${a.calls_expected.length} CTM call(s) missing in GHL`, ["These inbound calls have no matching GHL contact (by phone). No records were created or changed:", "",
      ...a.calls_expected.map((x: any) => `  - caller ${x.caller} · ${etTime(x.called_at)}`)]);
    if (r.sent) await call("formsync_recon_mark_alert", { call_ids: a.calls_expected.map((x: any) => x.id) });
  }
  const cu = state("calls_unverified");
  if (a.calls_unverified > 0 && (!cu?.alerted_at || Date.now() - Date.parse(cu.alerted_at) > 86400000)) {
    const r = await mail(`daily note: ${a.calls_unverified} call(s) without a GHL contact`, ["Whether calls are expected to reach GHL for this location has not been verified, so these are shown for visibility rather than as confirmed problems.", "You can set the expectation in Lead Reconciliation."]);
    await call("formsync_recon_mark_alert", { key: `${pid}:calls_unverified`, state: String(a.calls_unverified), sent: r.sent });
  }
}

async function reconcileOne(call: Call, admin: any, pid: string) {
  const { config } = await call("formsync_config", { property_id: pid });
  try {
    return await runLocation(depsFor(call, await loadConnections(admin, pid), config), pid);
  } catch (e) {
    await call("formsync_run_failed", { property_id: pid, error: (e as Error).message }).catch(() => {});
    return { error: (e as Error).message };
  } finally {
    try { await sendAlerts(call, pid, config); } catch (e) { console.error("[lead-recon] alerts", (e as Error).message); }
    if (pid === NORCAL && config?.production_watch_limit === 5) await safetyAlert(call);
  }
}

async function safetyAlert(call: Call) {
  const a = await call("formsync_safety", { property_id: NORCAL, action: "alert" });
  if (!a.pending || !a.recipient) return;
  const r = await sendPlainEmail(a.recipient, "URGENT: NorCal automatic recovery paused", `NorCal automatic sending was disabled to protect against a failed recovery or duplicate. Existing records are preserved.\n\n${a.reason}\n\nReview Lead Reconciliation before explicitly resuming. Other locations are unchanged.`);
  if (r.sent) await call("formsync_safety", { property_id: NORCAL, action: "alerted" });
}

async function scheduled(req: Request): Promise<Response | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
  if (!token || token.split(".").length === 3) return null; // user JWTs go to the guarded path
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: vaultSecret } = await admin.rpc("get_cron_secret_v2");
  const envSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!((!!vaultSecret && token === vaultSecret) || (!!envSecret && token === envSecret))) return json({ error: "Not found" }, 404);
  const call: Call = async (op, args = {}) => {
    const { data, error } = await admin.rpc("mops_formsync_internal", { _op: op, _args: args });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error(String((data as any).error));
    return data;
  };

  const lease = await call("formsync_recon_runtime", { action: "lease" });
  if (!lease.acquired) return json({ skipped: "previous run still in progress" });
  const started = Date.now();
  const out: Record<string, unknown> = {};
  try {
    // Interruption notice: if the schedule was not running, say so (catch-up happens through overlapping windows).
    const prev = lease.runtime?.last_scheduled_run_at as string | null;
    if (prev && started - Date.parse(prev) > 20 * MIN) {
      const items = await call("formsync_recon_alert_items", { property_id: "00000000-0000-0000-0000-000000000000" }).catch(() => null);
      if (items?.recipient) await sendPlainEmail(items.recipient, "Lead Reconciliation: schedule was interrupted",
        `The automatic check did not run between ${etTime(prev)} and ${etTime(new Date(started).toISOString())}. Missed submissions are being caught up now.`);
    }

    // 1. Reconcile every monitor/live location (bounded concurrency).
    const { locations } = await call("formsync_scheduled_locations");
    const queue = [...(locations as string[])];
    const results: Record<string, unknown> = {};
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let pid = queue.shift(); pid; pid = queue.shift()) results[pid] = await reconcileOne(call, admin, pid);
    }));
    out.reconciled = results;
    // Retry a failed safety notification even while NorCal is excluded by its hold.
    const { config: norcal } = await call("formsync_config", { property_id: NORCAL });
    if (norcal?.production_watch_limit === 5) await safetyAlert(call);

    // 2. Daily preflight (and on request), at most 2 locations per run, never past the time budget.
    const { locations: cands } = await call("formsync_recon_candidates");
    const due = (cands as any[]).filter((c) => c.preflight_requested || !c.has_config || !c.preflight_at || Date.now() - Date.parse(c.preflight_at) > 86400000).slice(0, 2);
    const pf: Record<string, unknown> = {};
    for (const loc of due) {
      if (Date.now() - started > 60000) break;
      try { pf[loc.property_name] = await preflightFor(call, await loadConnections(admin, loc.property_id), loc); }
      catch (e) { pf[loc.property_name] = { error: (e as Error).message }; }
    }
    out.preflight = pf;

    // 3. Call discrepancy monitor, hourly (database only, no API calls, no writes to CTM/GHL).
    const last = lease.runtime?.last_calls_check_at as string | null;
    if (!last || Date.now() - Date.parse(last) > 60 * MIN) out.calls = await call("formsync_recon_calls_check").catch((e) => ({ error: (e as Error).message }));

    // 4. Location-level alerts.
    for (const c of cands as any[]) if (c.has_config) { try { await sendLocationAlerts(call, c.property_id); } catch (e) { console.error("[lead-recon] location alerts", (e as Error).message); } }
  } finally {
    await call("formsync_recon_runtime", { action: "finish" }).catch(() => {});
  }
  return json(out);
}

const userHandler = mopsHandler("mops-form-sync", async (ctx) => {
  const op = String(ctx.body.op ?? "");
  const args = (ctx.body.args && typeof ctx.body.args === "object") ? ctx.body.args as Record<string, unknown> : {};
  if (READ_OPS.has(op) || ADMIN_OPS.has(op)) return json(await ctx.call(op, args));
  const pid = String(args.property_id ?? "");

  if (op === "norcal_activate") {
    const { config } = await ctx.call("formsync_config", { property_id: NORCAL }) as any;
    const conn = await ctx.connections(NORCAL);
    if (conn.ctm?.account_id !== "605552" || Deno.env.get("FORM_SYNC_LIVE") !== "true") return json({ error: "NorCal account/live-switch verification failed" }, 400);
    const reactors = await ctmReactors(conn.ctm);
    const matching = reactors.filter((r) => r.frt === config.ctm_form_reactor_id);
    const activities = await ctmList(conn.ctm, new Date(Date.now() - 7 * 86400000), new Date(), "how_can_we_help_you");
    const ids = [...new Set(activities.map((a) => a.form_id).filter(Boolean))];
    // CTM can omit the numeric ID on its reactor list; use the same unique-reactor/activity evidence as preflight.
    const verified = matching.length === 1 && (matching[0].numeric === "238734" ||
      (reactors.length === 1 && ids.length === 1 && ids[0] === "238734"));
    if (!verified) return json({ error: "NorCal FormReactor verification failed" }, 400);
    return json(await ctx.call("formsync_safety", { property_id: NORCAL, action: "activate" }));
  }
  if (op === "norcal_watch") return json(await ctx.call("formsync_safety", { property_id: NORCAL, action: "watch" }));
  if (op === "norcal_audit") {
    const conn = await ctx.connections(NORCAL);
    if (!conn.ctm || conn.ctm.account_id !== "605552") return json({ error: "NorCal account verification failed" }, 400);
    const activities = await ctmList(conn.ctm, new Date(Date.now() - 7 * 86400000), new Date(), "how_can_we_help_you");
    const records = [];
    for (const activity of activities.filter((a) => a.form_id === "238734").slice(-10)) {
      const a = await ctmGet(conn.ctm, activity.id, "how_can_we_help_you");
      records.push({ activity_id: activity.id, tag: a?.tag, inquiry_characters: String(a?.message ?? "").length, askai_provenance: "Not exposed by documented call-details endpoint" });
    }
    return json({ records, rules_changed: false });
  }

  if (op === "run" || op === "recheck") {
    const { config } = await ctx.call("formsync_config", { property_id: pid }) as any;
    if (!config) return json({ error: "Lead Reconciliation is not set up for this location" }, 400);
    if (config.manual_hold) return json({ error: "This location is paused by an administrator" }, 400);
    try {
      return json(await runLocation(depsFor(ctx.call, await ctx.connections(pid), config), pid, { from: typeof args.from === "string" ? args.from : undefined }));
    } catch (e) {
      await ctx.call("formsync_run_failed", { property_id: pid, error: (e as Error).message });
      if (pid === NORCAL && config?.production_watch_limit === 5) await safetyAlert(ctx.call);
      throw e;
    }
  }
  if (op === "preflight") {
    const { locations } = await ctx.call("formsync_recon_candidates") as any;
    const loc = (locations as any[]).find((l) => l.property_id === pid);
    if (!loc) return json({ error: "Location is not connected to both GHL and CTM" }, 400);
    return json(await preflightFor(ctx.call, await ctx.connections(pid), loc));
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
