// Data source alerting — evaluator + notifier.
//
// Runs every 5 minutes. Decides what is broken from last_success_at and the
// most recent error text only. Never reads `status` or `is_connected` for the
// broken/healthy decision — both are known unreliable on this project.
//
// Emails go out through the project's managed sender domain (see _shared/send-email.ts).
// No AI, no Google Ads writes, nothing to do with the Ads Agent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendPlainEmail } from "../_shared/send-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const APP_URL = "https://rsk9insights.com";
const STALE_HOURS: Record<string, number> = { google_ads: 6, ctm: 6, ghl: 8 };
const DEFAULT_STALE_HOURS = 12;
const SOURCE_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  ctm: "CallTrackingMetrics",
  ghl: "GoHighLevel",
  ga4: "Google Analytics 4",
  keyword_com: "Keyword.com",
};

const HOUR = 3_600_000;

function sourceLabel(s: string) { return SOURCE_LABELS[s] ?? s; }

function eastern(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }) + " ET";
}

function ageHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / HOUR;
}

function ageText(iso: string | null | undefined): string {
  const h = ageHours(iso);
  if (h === null) return "never";
  return `${h.toFixed(1)}h ago`;
}

interface Runbook {
  id: string;
  source: string;
  match_pattern: string | null;
  error_class: string;
  self_heals: boolean;
  title: string;
  fix_steps: string;
}

interface Conn {
  id: string;
  property_id: string;
  source: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  alerts_muted: boolean;
  alerts_mute_reason: string | null;
  updated_at: string | null;
}

function matchRunbook(source: string, errorText: string | null, book: Runbook[]): Runbook | null {
  if (!errorText) return null;
  const ordered = [
    ...book.filter((r) => r.source === source && r.match_pattern),
    ...book.filter((r) => r.source === "any" && r.match_pattern),
  ];
  for (const r of ordered) {
    try {
      if (new RegExp(r.match_pattern!, "i").test(errorText)) return r;
    } catch (_e) {
      if (errorText.toLowerCase().includes(r.match_pattern!.toLowerCase())) return r;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Same cron authentication as the other scheduled jobs.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  let vaultCronSecret = "";
  try {
    const { data: v } = await admin.rpc("get_cron_secret_v2");
    vaultCronSecret = typeof v === "string" ? v : "";
  } catch (_e) { /* optional */ }
  let ok = !!token && (token === SERVICE_KEY || token === CRON_SECRET || (!!vaultCronSecret && token === vaultCronSecret));
  // A signed-in super admin may also run it on demand (admin page, manual test).
  if (!ok && token) {
    const { data: userRes } = await admin.auth.getUser(token);
    const uid = userRes?.user?.id;
    if (uid) {
      const { data: isSa } = await admin.rpc("is_super_admin", { _user_id: uid });
      ok = isSa === true;
    }
  }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  if (body.action === "test_email") {
    const to = String(body.to ?? "");
    if (!to) return json({ error: "Missing to" }, 400);
    const result = await sendPlainEmail(
      to,
      "RSK9 alert test",
      [
        "This is a test from the Ridgeside Insights data source alerting system.",
        "",
        "If you are reading this, alert emails can reach you and the alerter can be built on this path.",
        "",
        `Sent at ${new Date().toISOString()} (UTC).`,
      ].join("\n"),
    );
    return json(result, result.sent ? 200 : 502);
  }

  // ---- load everything ----
  const [{ data: recips }, { data: bookRows }, { data: connRows }, { data: props }, { data: openInc }] =
    await Promise.all([
      admin.from("alert_recipients").select("email").eq("active", true),
      admin.from("alert_runbook").select("*"),
      admin.from("property_data_sources")
        .select("id,property_id,source,last_success_at,last_failure_at,last_error,alerts_muted,alerts_mute_reason,updated_at"),
      admin.from("properties").select("id,name"),
      admin.from("data_source_incidents").select("*").is("resolved_at", null),
    ]);

  const recipients = (recips ?? []).map((r: { email: string }) => r.email);
  const book = (bookRows ?? []) as Runbook[];
  const catchAll = book.find((r) => r.source === "any" && !r.match_pattern) ?? null;
  const conns = (connRows ?? []) as Conn[];
  const nameOf = new Map<string, string>((props ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  const incidents = (openInc ?? []) as Record<string, unknown>[];

  const sendAll = async (subject: string, text: string) => {
    for (const to of recipients) await sendPlainEmail(to, subject, text);
  };

  // Most recent sync_runs error per property+source (fallback error text).
  const { data: runRows } = await admin
    .from("sync_runs")
    .select("property_id,source,status,error,error_message,started_at")
    .order("started_at", { ascending: false })
    .limit(2000);
  const latestRunErr = new Map<string, string | null>();
  for (const r of (runRows ?? []) as Record<string, string | null>[]) {
    const k = `${r.property_id}:${r.source}`;
    if (latestRunErr.has(k)) continue;
    latestRunErr.set(k, r.status === "failure" ? (r.error_message ?? r.error ?? null) : null);
  }

  // ---- evaluate ----
  interface Broken { conn: Conn; rb: Runbook; error: string | null; reason: "error" | "stale" }
  const broken: Broken[] = [];
  const muted: Conn[] = [];

  for (const c of conns) {
    if (c.alerts_muted) { muted.push(c); continue; }
    if (!(c.source in STALE_HOURS)) continue; // only the three alerting sources

    const failureIsCurrent =
      !!c.last_failure_at && (!c.last_success_at || new Date(c.last_failure_at) > new Date(c.last_success_at));
    const errText = (failureIsCurrent ? c.last_error : null)
      ?? latestRunErr.get(`${c.property_id}:${c.source}`)
      ?? null;

    const rb = matchRunbook(c.source, errText, book);

    // Rule A — a non-self-healing error is current: alert immediately.
    if (rb && !rb.self_heals) { broken.push({ conn: c, rb, error: errText, reason: "error" }); continue; }

    // Rule B — staleness. last_success_at only.
    const limit = STALE_HOURS[c.source] ?? DEFAULT_STALE_HOURS;
    const h = ageHours(c.last_success_at);
    const neverButOld = h === null && (ageHours(c.updated_at) ?? 0) > 24;
    if ((h !== null && h > limit) || neverButOld) {
      const entry = rb ?? catchAll;
      if (entry) broken.push({ conn: c, rb: entry, error: errText, reason: "stale" });
    }
  }

  // ---- group by root cause (source + runbook entry) ----
  const groups = new Map<string, { source: string; rb: Runbook; conns: Conn[]; error: string | null }>();
  for (const b of broken) {
    const k = `${b.conn.source}:${b.rb.id}`;
    const g = groups.get(k) ?? { source: b.conn.source, rb: b.rb, conns: [], error: b.error };
    g.conns.push(b.conn);
    if (!g.error && b.error) g.error = b.error;
    groups.set(k, g);
  }

  const truncate = (s: string | null) => (s ? (s.length > 500 ? s.slice(0, 500) + "…" : s) : "(no error text recorded)");
  const locLine = (c: Conn) => `  - ${nameOf.get(c.property_id) ?? c.property_id} — last success ${eastern(c.last_success_at)} (${ageText(c.last_success_at)})`;

  const actions: string[] = [];

  // ---- open / remind ----
  for (const [key, g] of groups) {
    const existing = incidents.find((i) => i.source === g.source && i.runbook_id === g.rb.id);
    const ids = g.conns.map((c) => c.property_id);
    const n = g.conns.length;

    if (!existing) {
      const { data: ins } = await admin.from("data_source_incidents").insert({
        source: g.source,
        error_class: g.rb.error_class,
        runbook_id: g.rb.id,
        affected_property_ids: ids,
        first_error: truncate(g.error),
        last_notified_at: new Date().toISOString(),
      }).select("id").single();

      await sendAll(
        `[RSK9 ALERT] ${sourceLabel(g.source)} down: ${n} location${n === 1 ? "" : "s"} — ${g.rb.title}`,
        [
          `What broke: ${g.rb.title}`,
          "",
          `Locations affected (${n}):`,
          ...g.conns.map(locLine),
          "",
          `Since: ${eastern(new Date().toISOString())}`,
          "",
          "The fix:",
          g.rb.fix_steps,
          "",
          "Raw error:",
          truncate(g.error),
          "",
          `${APP_URL}/admin/data-sources`,
        ].join("\n"),
      );
      actions.push(`opened ${key} (${n})`);
      if (ins) incidents.push({ ...ins, source: g.source, runbook_id: g.rb.id });
      continue;
    }

    // keep the affected list current
    await admin.from("data_source_incidents")
      .update({ affected_property_ids: ids })
      .eq("id", existing.id as string);

    const openedAt = new Date(existing.opened_at as string).getTime();
    const openHours = (Date.now() - openedAt) / HOUR;
    const lastNotified = existing.last_notified_at ? new Date(existing.last_notified_at as string).getTime() : openedAt;
    const sinceNotify = (Date.now() - lastNotified) / HOUR;
    const reminderCount = Number(existing.reminder_count ?? 0);
    const due = reminderCount === 0 ? openHours >= 6 : sinceNotify >= 24;

    if (due) {
      await sendAll(
        `[RSK9 STILL DOWN] ${sourceLabel(g.source)}: ${n} location${n === 1 ? "" : "s"} — ${g.rb.title} (open ${Math.round(openHours)} hours)`,
        [
          `What broke: ${g.rb.title}`,
          "",
          `Open for ${Math.round(openHours)} hours (since ${eastern(existing.opened_at as string)}).`,
          "",
          `Locations affected (${n}):`,
          ...g.conns.map(locLine),
          "",
          "The fix:",
          g.rb.fix_steps,
          "",
          "Raw error:",
          truncate(g.error ?? (existing.first_error as string | null)),
          "",
          `${APP_URL}/admin/data-sources`,
        ].join("\n"),
      );
      await admin.from("data_source_incidents")
        .update({ last_notified_at: new Date().toISOString(), reminder_count: reminderCount + 1 })
        .eq("id", existing.id as string);
      actions.push(`reminded ${key}`);
    }
  }

  // ---- resolve ----
  for (const inc of incidents) {
    const stillBroken = [...groups.values()].some((g) => g.source === inc.source && g.rb.id === inc.runbook_id);
    if (stillBroken) continue;
    if (inc.resolved_at) continue;
    const ids = (inc.affected_property_ids as string[]) ?? [];
    const affected = conns.filter((c) => c.source === inc.source && ids.includes(c.property_id));
    const openedAt = new Date(inc.opened_at as string).getTime();
    const hours = Math.max(0, (Date.now() - openedAt) / HOUR);
    const rb = book.find((r) => r.id === inc.runbook_id);

    await admin.from("data_source_incidents")
      .update({ resolved_at: new Date().toISOString(), last_notified_at: new Date().toISOString() })
      .eq("id", inc.id as string);

    await sendAll(
      `[RSK9 RESOLVED] ${sourceLabel(inc.source as string)} recovered: ${ids.length} location${ids.length === 1 ? "" : "s"}`,
      [
        `What broke: ${rb?.title ?? (inc.error_class as string)}`,
        "",
        `Down for ${hours.toFixed(1)} hours (opened ${eastern(inc.opened_at as string)}).`,
        "",
        "Current state:",
        ...affected.map(locLine),
        "",
        `${APP_URL}/admin/data-sources`,
      ].join("\n"),
    );
    actions.push(`resolved ${inc.id}`);
  }

  // ---- daily all-clear, first tick past 8:00 AM Eastern ----
  const nowEastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayEastern = nowEastern.toISOString().slice(0, 10);
  const { data: stateRow } = await admin.from("alert_state").select("value").eq("key", "daily_summary_date").maybeSingle();
  const lastDaily = (stateRow?.value as string | undefined) ?? "";
  const forceDaily = body.action === "daily_summary";

  if (forceDaily || (nowEastern.getHours() >= 8 && lastDaily !== todayEastern)) {
    const { data: openNow } = await admin.from("data_source_incidents").select("*").is("resolved_at", null);
    const openCount = (openNow ?? []).length;
    const lines: string[] = [];
    const tracked = conns.filter((c) => c.source in STALE_HOURS);
    const bySource = new Map<string, Conn[]>();
    for (const c of tracked) { bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]); }
    for (const [src, list] of bySource) {
      lines.push(sourceLabel(src) + ":");
      for (const c of list.sort((a, b) => (nameOf.get(a.property_id) ?? "").localeCompare(nameOf.get(b.property_id) ?? ""))) {
        lines.push(`  - ${nameOf.get(c.property_id) ?? c.property_id}: last success ${eastern(c.last_success_at)} (${ageText(c.last_success_at)})${c.alerts_muted ? " [muted]" : ""}`);
      }
      lines.push("");
    }
    const mutedLines = muted.length
      ? muted.map((c) => `  - ${nameOf.get(c.property_id) ?? c.property_id} · ${sourceLabel(c.source)} — ${c.alerts_mute_reason ?? "no reason given"}`)
      : ["  (none)"];

    await sendAll(
      openCount === 0 ? "[RSK9 OK] All data sources healthy" : `[RSK9 DAILY] ${openCount} open incident(s)`,
      [
        `Daily data source summary — ${eastern(new Date().toISOString())}`,
        "",
        openCount === 0 ? "No open incidents." : `${openCount} open incident(s). See ${APP_URL}/admin/data-sources`,
        "",
        ...lines,
        "Muted (will never alert):",
        ...mutedLines,
        "",
        `${APP_URL}/admin/data-sources`,
      ].join("\n"),
    );
    await admin.from("alert_state").upsert({ key: "daily_summary_date", value: todayEastern, updated_at: new Date().toISOString() });
    actions.push("daily summary sent");
  }

  return json({ ok: true, evaluated: conns.length, groups: groups.size, muted: muted.length, actions });
});
