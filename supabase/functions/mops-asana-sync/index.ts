// Private Lovable -> Asana development-log sync.
// Two entry paths:
//  - Granted user (shared mops guard): view the log, check sync status, run a sync now,
//    and record change entries (original request + reasoning captured at request time).
//  - Scheduled (cron secret only, hourly): pushes pending entries to the private
//    "Dashboard Management" Asana project as one dated parent task per development day
//    (America/New_York) with one subtask per change. Idempotent: entries carry a stable
//    change_id and content hash; changed entries update their existing subtask in place.
// Never writes API credentials or customer data into Asana.
import { createClient } from "npm:@supabase/supabase-js@2";
import { mopsHandler, json, corsHeaders } from "../_shared/mops/guard.ts";
import { sendPlainEmail } from "../_shared/send-email.ts";

const PROJECT_GID = "1219565659491189";
const SECTION_GID = "1219565659491190";
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

function entryNotes(e: any): string {
  return [
    e.retrospective ? "RETROSPECTIVE SUMMARY — recorded after the fact; original request context was not captured at the time." : "Recorded at request time from the original Lovable conversation.",
    field("Original request", e.request_text),
    field("Why / business context", e.why_text),
    field("Problem being solved", e.problem),
    field("What changed", e.what_changed),
    field("Areas / modules affected", e.areas),
    field("Implementation details", e.implementation),
    field("Testing & verification", e.testing),
    field("Expected outcome", e.outcome_expected),
    field("Actual outcome", e.outcome_actual),
    field("Remaining issues / follow-up", e.followups),
    field("Lovable reference", e.lovable_ref),
    `\nStatus: ${e.status}\nChange ID: ${e.change_id}`,
  ].join("");
}

const dayName = (day: string) => `${day} | Dashboard Development Log`;

async function ensureDayTask(call: Internal, day: string): Promise<string> {
  const { asana_task_gid } = await call("devlog_day_task", { day });
  if (asana_task_gid) return asana_task_gid;
  // Look for an existing task with the exact dated name (e.g. the manually created one).
  const list = await asana("GET", `/projects/${PROJECT_GID}/tasks`, undefined, { opt_fields: "gid,name", limit: "100" });
  const found = (list.data ?? []).find((t: any) => t.name === dayName(day));
  const gid = found?.gid ?? (await asana("POST", "/tasks", {
    name: dayName(day),
    notes: "Automatic daily development log. One subtask per material dashboard change. Date is America/New_York.",
    projects: [PROJECT_GID],
    memberships: [{ project: PROJECT_GID, section: SECTION_GID }],
  })).data.gid;
  await call("devlog_set_day_task", { day, gid: String(gid) });
  return String(gid);
}

async function syncEntry(call: Internal, e: any): Promise<void> {
  const parent = await ensureDayTask(call, e.day);
  const name = `${e.change_id} | ${e.title}`.slice(0, 500);
  const notes = entryNotes(e);
  if (e.asana_subtask_gid) {
    await asana("PUT", `/tasks/${e.asana_subtask_gid}`, { name, notes });
    await call("devlog_mark_synced", { id: e.id, gid: e.asana_subtask_gid });
    return;
  }
  // No stored gid: check the parent's subtasks for this change_id before creating (crash recovery).
  const subs = await asana("GET", `/tasks/${parent}/subtasks`, undefined, { opt_fields: "gid,name", limit: "100" });
  const existing = (subs.data ?? []).find((s: any) => String(s.name).startsWith(`${e.change_id} |`));
  if (existing) {
    await asana("PUT", `/tasks/${existing.gid}`, { name, notes });
    await call("devlog_mark_synced", { id: e.id, gid: String(existing.gid) });
    return;
  }
  const created = await asana("POST", `/tasks/${parent}/subtasks`, { name, notes });
  await call("devlog_mark_synced", { id: e.id, gid: String(created.data.gid) });
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
    await call("devlog_run_finish");
    return { synced: Object.keys(results).length, results };
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
  if (op === "devlog_list" || op === "devlog_status" || op === "devlog_upsert") return json(await ctx.call(op, args));
  // Identity already verified and grant checked by the guard; the sync itself uses the internal entry point.
  if (op === "run") return json(await runSync(internalCall()));
  return json({ error: "Unknown operation" }, 400);
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return (await scheduled(req)) ?? userHandler(req);
});
