// Private Lovable -> Asana development-log sync.
// Two entry paths:
//  - Granted user (shared mops guard): view the log, check sync status, run a sync now,
//    and record change entries (original request + reasoning captured at request time).
//  - Scheduled (cron secret only, hourly fallback): appends one comment per pending change
//    to the single permanent "Dashboard Development Log" task. Append-only: an edited entry
//    posts a new UPDATE comment, older comments are never rewritten. Ledger
//    (mops.dev_log_comments) keyed by change_id + content hash prevents duplicates.
//  Entries are also pushed immediately after each devlog_upsert.
// Never writes API credentials or customer data into Asana.
import { createClient } from "npm:@supabase/supabase-js@2";
import { mopsHandler, json, corsHeaders } from "../_shared/mops/guard.ts";
import { sendPlainEmail } from "../_shared/send-email.ts";

// Permanent "Dashboard Development Log" task (project 1219565659491189). Kept open; never completed by this code.
const LOG_TASK_GID = "1219592828722988";
const GATEWAY = "https://connector-gateway.lovable.dev/asana";

type Internal = (op: string, args?: Record<string, unknown>) => Promise<any>;

function asanaHeaders() {
  const key = Deno.env.get("LOVABLE_API_KEY");
  const conn = Deno.env.get("ASANA_API_KEY_1");
  if (!key || !conn) throw new Error("Asana connection is not configured");
  return { Authorization: `Bearer ${key}`, "X-Connection-Api-Key": conn, "Content-Type": "application/json" };
}

async function asana(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<any> {
  const u = new URL(`${GATEWAY}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
  const r = await fetch(u, { method, headers: asanaHeaders(), body: body ? JSON.stringify({ data: body }) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Asana ${method} ${path} returned ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const field = (label: string, v: unknown) => (v && String(v).trim() ? `\n${label}:\n${String(v).trim()}\n` : "");

// Ledger marker embedded in every comment so a crash between posting and recording never duplicates it.
const marker = (e: any) => `Ledger: ${e.change_id} · ${String(e.content_hash ?? "nohash").slice(0, 12)}`;

const etTime = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";

export function commentText(e: any): string {
  const isUpdate = Number(e.prior_comments ?? 0) > 0;
  // Preferred format: a natural, first-person narrative written at request time from the real conversation.
  if (e.narrative && String(e.narrative).trim()) {
    const lead = isUpdate ? `Follow-up on "${e.title}"` : e.title;
    const when = e.implemented_at ? `Implemented ${etTime(e.implemented_at)}.` : e.retrospective ? `Work done ${e.day}; written up afterward.` : "";
    return [lead, "", String(e.narrative).trim(), "", [when, marker(e)].filter(Boolean).join(" · ")].join("\n");
  }
  const header = e.retrospective
    ? `RETROSPECTIVE ENTRY — original development date ${e.day}. Migrated/recorded after the fact; this comment's Asana timestamp is NOT the original development time. Original request wording was not captured at the time.`
    : `Change recorded at request time from the original Lovable conversation. Change date (America/New_York): ${e.day}; entry last updated ${new Date(e.updated_at).toISOString()}.`;
  return [
    `${isUpdate ? "UPDATE / CORRECTION to" : "NEW CHANGE"}: ${e.title}`,
    `\n${header}\n`,
    field("What changed", e.what_changed),
    field("Original request", e.request_text),
    field("Why the change was requested", e.why_text),
    field("Problem solved", e.problem),
    field("What was implemented", [e.implementation, e.areas ? `Areas: ${e.areas}` : ""].filter(Boolean).join("\n")),
    field("Testing & verification", e.testing),
    field("Expected outcome", e.outcome_expected),
    field("Outcome", e.outcome_actual),
    field("Outstanding issues", e.followups),
    `\nStatus: ${e.status}\n${marker(e)}`,
  ].join("");
}

async function syncEntry(call: Internal, e: any): Promise<void> {
  if (e.already_posted) { await call("devlog_mark_synced", { id: e.id }); return; }
  // Crash recovery: look for this exact revision's marker among existing comments.
  const stories = await asana("GET", `/tasks/${LOG_TASK_GID}/stories`, undefined, { opt_fields: "gid,text,type", limit: "100" });
  const m = marker(e);
  const existing = (stories.data ?? []).find((s: any) => s.type === "comment" && String(s.text ?? "").includes(m));
  const gid = existing?.gid ?? (await asana("POST", `/tasks/${LOG_TASK_GID}/stories`, { text: commentText(e) })).data.gid;
  await call("devlog_record_comment", { id: e.id, hash: e.content_hash ?? "nohash", story_gid: String(gid), task_gid: LOG_TASK_GID });
}

async function ensureTaskOpen(): Promise<boolean> {
  const t = await asana("GET", `/tasks/${LOG_TASK_GID}`, undefined, { opt_fields: "completed" });
  return t.data?.completed === false;
}

async function runSync(call: Internal): Promise<Record<string, unknown>> {
  const lease = await call("devlog_run_start");
  if (!lease.acquired) return { skipped: "previous run still in progress" };
  try {
    const pending = (await call("devlog_pending")) as any[];
    const results: Record<string, string> = {};
    for (const e of pending) {
      try {
        await syncEntry(call, e);
        results[e.change_id] = "synced";
      } catch (err) {
        results[e.change_id] = `error: ${(err as Error).message.slice(0, 200)}`;
        throw err; // stop the run; remaining entries retry next hour
      }
    }
    const taskOpen = await ensureTaskOpen();
    await call("devlog_run_finish");
    return { synced: Object.keys(results).length, results, task_open: taskOpen };
  } catch (err) {
    const fail = await call("devlog_run_fail", { error: (err as Error).message });
    if ((fail?.consecutive_failures ?? 0) >= 3) {
      try {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: recips } = await admin.from("alert_recipients").select("email").limit(1);
        const to = recips?.[0]?.email;
        if (to) await sendPlainEmail(to, "Development Log: Asana sync is failing",
          `The automatic Asana development-log sync has failed ${fail.consecutive_failures} times in a row.\n\nLast error: ${(err as Error).message}\n\nOpen Marketing Ops → Development Log for details.`);
      } catch (e) { console.error("[asana-sync] alert email failed", (e as Error).message); }
    }
    throw err;
  }
}

function internalCall(): Internal {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return async (op, args = {}) => {
    const { data, error } = await admin.rpc("mops_devlog_internal", { _op: op, _args: args });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error(String((data as any).error));
    return data;
  };
}

async function scheduled(req: Request): Promise<Response | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
  if (!token || token.split(".").length === 3) return null; // user JWTs go to the guarded path
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: vaultSecret } = await admin.rpc("get_cron_secret_v2");
  const envSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!((!!vaultSecret && token === vaultSecret) || (!!envSecret && token === envSecret))) return json({ error: "Not found" }, 404);
  return json(await runSync(internalCall()));
}

const userHandler = mopsHandler("mops-asana-sync", async (ctx) => {
  const op = String(ctx.body.op ?? "");
  const args = (ctx.body.args && typeof ctx.body.args === "object") ? ctx.body.args as Record<string, unknown> : {};
  if (op === "devlog_list" || op === "devlog_status") return json(await ctx.call(op, args));
  if (op === "devlog_upsert") {
    const out = await ctx.call(op, args);
    // Post promptly; the hourly run retries if this fails.
    let sync: unknown = null;
    try { sync = await runSync(internalCall()); } catch (e) { sync = { error: (e as Error).message }; }
    return json({ ...out, sync });
  }
  // Identity already verified and grant checked by the guard; the sync itself uses the internal entry point.
  if (op === "run") return json(await runSync(internalCall()));
  return json({ error: "Unknown operation" }, 400);
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return (await scheduled(req)) ?? userHandler(req);
});
