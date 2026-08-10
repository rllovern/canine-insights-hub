// Mirror-integrity enforcement.
//
// Walks the COMPLETE opportunity set for a property from GHL, diffs it against
// what we store, and enforces the mirror rule: any stored opportunity id that a
// COMPLETE walk does not return is a divergence that belongs to us.
//
// Safety: a row is only retired after TWO consecutive complete passes fail to
// return it. A pass that did not complete never counts, and never clears a
// streak. Retirement moves the row into ghl_opportunities_retired (row kept,
// deleted_at stamped) so it disappears from every metric surface at once.
//
// Every retirement of a WON opportunity also writes a metric_restatements row
// with a cause that distinguishes:
//   ghl_deleted                      - GHL no longer holds the record at all
//   ghl_recreated_surviving_won      - merged/recreated, survivor is also a win
//   ghl_recreated_surviving_not_won  - merged/recreated, survivor is NOT a win
//                                      (this REMOVES a win, it does not swap one)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
type Json = Record<string, unknown>;

async function ghlFetch(path: string, token: string): Promise<Json> {
  let attempt = 0;
  while (true) {
    const res = await fetch(GHL_BASE + path, {
      headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" },
    });
    const text = await res.text();
    if (res.ok) { try { return JSON.parse(text) as Json; } catch { return {}; } }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
      attempt++;
      continue;
    }
    throw new Error(`GHL ${res.status}: ${text.slice(0, 300)}`);
  }
}

const monthKey = (iso: string | null) => (iso ? iso.slice(0, 7) : null);
const monthBounds = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const start = `${key}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const cronSecret = req.headers.get("x-cron-secret");
  let cronOk = false;
  if (cronSecret) {
    const { data: expected } = await admin.rpc("get_cron_secret_v2");
    cronOk = !!expected && cronSecret === expected;
  }
  if (jwt !== SERVICE_KEY && !cronOk) {
    const { data: userRes } = await admin.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: isInternal } = await admin.rpc("is_all_properties_reader", { _user_id: user.id });
    if (!isInternal) return json({ error: "Forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const rebuildOnly = body.rebuild_only === true;
  const propertyIds: string[] = body.property_id
    ? [body.property_id as string]
    : ((await admin.from("property_data_sources").select("property_id")
        .eq("source", "ghl").eq("is_connected", true)).data ?? []).map((r) => r.property_id as string);

  const results: unknown[] = [];

  if (rebuildOnly) {
    for (const propertyId of propertyIds) {
      const { data, error } = await admin.rpc("rebuild_lead_facts", { _property_id: propertyId });
      results.push({ property_id: propertyId, rebuilt: data ?? null, error: error?.message ?? null });
    }
    return json({ ok: true, rebuild_only: true, results });
  }

  for (const propertyId of propertyIds) {
    const deadline = Date.now() + 110_000;
    const { data: pds } = await admin.from("property_data_sources")
      .select("config, secret_token").eq("property_id", propertyId).eq("source", "ghl").maybeSingle();
    const locationId = (pds?.config as Json)?.location_id as string | undefined;
    const token = (pds?.secret_token as string | undefined) ?? "";
    if (!locationId || !token) { results.push({ property_id: propertyId, skipped: "not connected" }); continue; }

    const { data: runRow } = await admin.from("reconcile_runs")
      .insert({ property_id: propertyId, source: "ghl", status: "running" }).select("id").single();
    const runId = runRow?.id as string;

    try {
      // ---- complete ordered cursor walk -----------------------------------
      const live = new Map<string, { status: string; contact_id: string | null }>();
      let startAfter: string | null = null, startAfterId: string | null = null;
      let pages = 0, exhausted = false;
      while (Date.now() < deadline) {
        const qs = new URLSearchParams({ location_id: locationId, limit: "100", order: "added_asc" });
        if (startAfter && startAfterId) { qs.set("startAfter", startAfter); qs.set("startAfterId", startAfterId); }
        const j = await ghlFetch(`/opportunities/search?${qs.toString()}`, token);
        const list = (j.opportunities as Json[]) ?? [];
        const meta = (j.meta ?? {}) as Json;
        for (const o of list) {
          live.set(String(o.id), {
            status: String(o.status ?? "unknown"),
            contact_id: (o.contactId ?? (o.contact as Json)?.id ?? null) as string | null,
          });
        }
        pages++;
        if (!list.length || meta.startAfter == null || list.length < 100) { exhausted = true; break; }
        startAfter = String(meta.startAfter);
        startAfterId = String(meta.startAfterId ?? "");
      }

      // ---- stored set -------------------------------------------------------
      type Stored = {
        id: string; ghl_opportunity_id: string; status: string; monetary_value: number | null;
        contact_id: string | null; won_at: string | null;
      };
      const stored: Stored[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from("ghl_opportunities")
          .select("id, ghl_opportunity_id, status, monetary_value, contact_id, won_at")
          .eq("property_id", propertyId).range(from, from + 999);
        if (error) throw new Error(error.message);
        stored.push(...((data ?? []) as Stored[]));
        if (!data || data.length < 1000) break;
      }

      const missing = stored.filter((s) => !live.has(s.ghl_opportunity_id));

      if (!exhausted) {
        await admin.from("reconcile_runs").update({
          status: "incomplete", walk_complete: false, pages, live_count: live.size,
          stored_count: stored.length, missing_count: missing.length, finished_at: new Date().toISOString(),
          notes: { reason: "walk did not exhaust within budget; no streaks touched" },
        }).eq("id", runId);
        results.push({ property_id: propertyId, run_id: runId, walk_complete: false, pages });
        continue;
      }

      // ---- streaks: clear for anything seen, bump for anything missing ------
      const missingIds = missing.map((m) => m.ghl_opportunity_id);
      if (!dryRun) {
        await admin.from("ghl_opportunity_miss_streaks").delete()
          .eq("property_id", propertyId)
          .not("ghl_opportunity_id", "in", `(${missingIds.map((i) => `"${i}"`).join(",") || '""'})`);
      }

      const { data: priorStreaks } = await admin.from("ghl_opportunity_miss_streaks")
        .select("ghl_opportunity_id, miss_count").eq("property_id", propertyId);
      const priorMap = new Map((priorStreaks ?? []).map((s) => [s.ghl_opportunity_id as string, s.miss_count as number]));

      const toRetire: Stored[] = [];
      const streakRows = missing.map((m) => {
        const next = (priorMap.get(m.ghl_opportunity_id) ?? 0) + 1;
        if (next >= 2) toRetire.push(m);
        return {
          property_id: propertyId, ghl_opportunity_id: m.ghl_opportunity_id,
          miss_count: next, last_missed_at: new Date().toISOString(), last_run_id: runId,
        };
      });
      if (!dryRun && streakRows.length) {
        await admin.from("ghl_opportunity_miss_streaks")
          .upsert(streakRows, { onConflict: "property_id,ghl_opportunity_id" });
      }

      // ---- retire -----------------------------------------------------------
      const retired: unknown[] = [];
      for (const m of toRetire) {
        // Classify cause: does the contact still have a live opportunity in GHL?
        let cause = "ghl_deleted";
        let survivingId: string | null = null;
        let survivingStatus: string | null = null;
        if (m.contact_id) {
          for (const [id, v] of live) {
            if (v.contact_id && v.contact_id === m.contact_id) { survivingId = id; survivingStatus = v.status; break; }
          }
          if (survivingId) {
            cause = survivingStatus === "won" ? "ghl_recreated_surviving_won" : "ghl_recreated_surviving_not_won";
          }
        }

        if (dryRun) { retired.push({ id: m.ghl_opportunity_id, cause, survivingId, survivingStatus, value: m.monetary_value, won_at: m.won_at }); continue; }

        const { data: full } = await admin.from("ghl_opportunities").select("*").eq("id", m.id).single();
        if (!full) continue;
        const { error: insErr } = await admin.from("ghl_opportunities_retired").insert({
          ...full,
          deleted_at: new Date().toISOString(),
          deleted_cause: cause,
          surviving_opportunity_id: survivingId,
          surviving_status: survivingStatus,
          reconcile_run_id: runId,
        });
        if (insErr && !insErr.message.includes("duplicate key")) throw new Error(insErr.message);
        await admin.from("ghl_opportunities").delete().eq("id", m.id);
        await admin.from("ghl_opportunity_miss_streaks").delete()
          .eq("property_id", propertyId).eq("ghl_opportunity_id", m.ghl_opportunity_id);

        // Restatement entries: only when a reported figure actually moves.
        if (m.status === "won" && m.won_at) {
          const mk = monthKey(m.won_at)!;
          const { start, end } = monthBounds(mk);
          const amount = Number(m.monetary_value ?? 0);
          const causeDetail =
            cause === "ghl_deleted"
              ? "GHL no longer holds this opportunity. The win is removed."
              : cause === "ghl_recreated_surviving_won"
                ? `GHL merged/recreated this opportunity as ${survivingId}, which is also a win. The win is not lost — the duplicate is.`
                : `GHL merged/recreated this opportunity as ${survivingId}, which is ${survivingStatus} — NOT a win. This removes a win rather than swapping one.`;

          const { data: winsRow } = await admin.rpc("count_wins_in_period", {
            _property_id: propertyId, _from: start, _to: end,
          });
          const priorWins = Number(winsRow ?? 0) + 1;
          const restBase = {
            property_id: propertyId, period_start: start, period_end: end, cause,
            cause_detail: causeDetail, opportunity_id: m.ghl_opportunity_id,
            surviving_opportunity_id: survivingId, surviving_status: survivingStatus,
            reconcile_run_id: runId,
          };
          const rows = [{ ...restBase, metric: "wins", prior_value: priorWins, new_value: priorWins - 1 }];
          if (amount > 0) {
            const { data: revRow } = await admin.rpc("sum_won_revenue_in_period", {
              _property_id: propertyId, _from: start, _to: end,
            });
            const priorRev = Number(revRow ?? 0) + amount;
            rows.push({ ...restBase, metric: "won_revenue", prior_value: priorRev, new_value: priorRev - amount });
          }
          await admin.from("metric_restatements").insert(rows);
        }
        retired.push({ id: m.ghl_opportunity_id, cause, survivingId, survivingStatus, status: m.status, value: m.monetary_value });
      }

      await admin.from("reconcile_runs").update({
        status: "complete", walk_complete: true, pages, live_count: live.size,
        stored_count: stored.length, missing_count: missing.length, retired_count: retired.length,
        finished_at: new Date().toISOString(),
        notes: { dry_run: dryRun, retired },
      }).eq("id", runId);

      results.push({
        property_id: propertyId, run_id: runId, walk_complete: true, pages,
        live: live.size, stored: stored.length, missing: missing.length,
        retired: retired.length, retired_detail: retired,
        pending_second_pass: missing.length - toRetire.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.from("reconcile_runs").update({
        status: "failed", error: msg, finished_at: new Date().toISOString(),
      }).eq("id", runId);
      results.push({ property_id: propertyId, run_id: runId, error: msg });
    }
  }

  return json({ ok: true, dry_run: dryRun, results });
});
// redeploy touch
