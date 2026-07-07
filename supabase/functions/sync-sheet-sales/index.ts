// Google Sheets → sheet_sales importer.
// Actions:
//   list_tabs           → returns spreadsheet tab names + property mappings + auto-match suggestions
//   sync                → pulls every property with a google_sheet_tab and upserts sheet_sales rows
//                         (also runs from pg_cron with service role / CRON_SECRET)
//   set_spreadsheet_id  → super-admin sets the master spreadsheet id
//   set_property_tab    → super-admin sets/clears one property's tab mapping

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Google Sheets serial number
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const ms = (n - 25569) * 86400 * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  // MM/DD/YYYY fallback already handled by Date; try DD/MM/YYYY? Skip.
  return null;
}

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gwFetch(path: string): Promise<Response> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  if (!LOVABLE_API_KEY || !GOOGLE_SHEETS_API_KEY) {
    throw new Error("Google Sheets connector not configured");
  }
  return fetch(`${GATEWAY}${path}`, {
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
    },
  });
}

type SheetMeta = { title: string; sheetId: number };

async function listTabs(spreadsheetId: string): Promise<SheetMeta[]> {
  const res = await gwFetch(`/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets metadata failed [${res.status}]: ${body}`);
  }
  const data = await res.json();
  return (data.sheets ?? []).map((s: { properties: { title: string; sheetId: number } }) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
  }));
}

async function fetchTabRows(spreadsheetId: string, tab: string): Promise<string[][]> {
  const range = `${tab}!A1:Z10000`;
  const res = await gwFetch(`/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range).replace(/%21/g, "!").replace(/%3A/g, ":")}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Tab "${tab}" fetch failed [${res.status}]: ${body}`);
  }
  const data = await res.json();
  return (data.values ?? []) as string[][];
}

/** Batch-fetch multiple tabs in a single Sheets API call — avoids per-tab
 * quota burn (429) when syncing many properties. Returns a map keyed by tab name. */
async function batchFetchTabRows(
  spreadsheetId: string,
  tabs: string[],
): Promise<Record<string, string[][]>> {
  if (tabs.length === 0) return {};
  const params = tabs
    .map((t) => `ranges=${encodeURIComponent(`${t}!A1:Z10000`)}`)
    .join("&");
  const res = await gwFetch(`/spreadsheets/${spreadsheetId}/values:batchGet?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`batchGet failed [${res.status}]: ${body}`);
  }
  const data = await res.json() as { valueRanges?: Array<{ range?: string; values?: string[][] }> };
  const out: Record<string, string[][]> = {};
  const ranges = data.valueRanges ?? [];
  // Sheets returns valueRanges in request order — pair by index (range strings
  // get quoted/escaped by the API, so index matching is more reliable).
  ranges.forEach((vr, i) => {
    const tab = tabs[i];
    if (tab !== undefined) out[tab] = (vr.values ?? []) as string[][];
  });
  return out;
}

function headerIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  const aliases: Record<string, string[]> = {
    full_name: ["full name", "name"],
    email: ["email"],
    phone: ["phone", "phone number"],
    city_state: ["city/state", "city state", "city", "location"],
    first_session: ["1st session", "first session"],
    deal_value: ["deal value", "value"],
    creation_date: ["creation date", "created", "created date"],
    sold_date: ["sold date", "sold", "close date"],
    notes: ["notes", "note"],
  };
  header.forEach((h, i) => {
    const n = normalize(h);
    for (const [key, opts] of Object.entries(aliases)) {
      if (opts.some((o) => normalize(o) === n) && idx[key] === undefined) idx[key] = i;
    }
  });
  return idx;
}

async function processRows(
  admin: ReturnType<typeof createClient>,
  propertyId: string,
  rows: string[][],
): Promise<{ imported: number; skipped: number }> {
  if (rows.length < 2) return { imported: 0, skipped: 0 };
  const header = rows[0];
  const idx = headerIndex(header);
  const body = rows.slice(1);

  const toUpsert: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const r of body) {
    const full_name = idx.full_name !== undefined ? String(r[idx.full_name] ?? "").trim() : "";
    const sold_date = idx.sold_date !== undefined ? parseDate(r[idx.sold_date]) : null;
    const creation_date = idx.creation_date !== undefined ? parseDate(r[idx.creation_date]) : null;
    const sale_date = sold_date ?? creation_date;
    if (!full_name || !sale_date) { skipped++; continue; }
    const email = idx.email !== undefined ? String(r[idx.email] ?? "").trim() || null : null;
    const phone = idx.phone !== undefined ? String(r[idx.phone] ?? "").trim() || null : null;
    const city_state = idx.city_state !== undefined ? String(r[idx.city_state] ?? "").trim() || null : null;
    const first_session = idx.first_session !== undefined ? parseDate(r[idx.first_session]) : null;
    const deal_value = idx.deal_value !== undefined ? parseNumber(r[idx.deal_value]) : null;
    const notes = idx.notes !== undefined ? String(r[idx.notes] ?? "").trim() || null : null;
    const source_row_hash = await sha256Hex([full_name, email ?? "", phone ?? "", sold_date ?? "", creation_date ?? "", deal_value ?? ""].join("|"));
    toUpsert.push({
      property_id: propertyId,
      sale_date, full_name, email, phone, city_state,
      first_session, deal_value, creation_date, sold_date, notes,
      source_row_hash, synced_at: new Date().toISOString(),
    });
  }

  // Batch upsert in chunks of 500
  // Deduplicate on (property_id, source_row_hash) — duplicate sheet rows would
  // otherwise trigger "ON CONFLICT DO UPDATE command cannot affect row a
  // second time" from Postgres.
  const seen = new Set<string>();
  const deduped = toUpsert.filter((r) => {
    const k = `${r.property_id}|${r.source_row_hash}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`[processRows] property=${propertyId} rows_in=${toUpsert.length} deduped=${deduped.length}`);
  for (let i = 0; i < deduped.length; i += 500) {
    const chunk = deduped.slice(i, i + 500);
    const { error } = await admin.from("sheet_sales").upsert(chunk, {
      onConflict: "property_id,source_row_hash",
    });
    if (error) {
      console.error(`[processRows] chunk upsert failed size=${chunk.length}:`, error.message);
      // Fallback: upsert one row at a time so a single bad/duplicate row can't
      // sink the whole tab.
      let ok = 0;
      for (const row of chunk) {
        const { error: e2 } = await admin.from("sheet_sales").upsert(row, {
          onConflict: "property_id,source_row_hash",
        });
        if (!e2) ok++;
      }
      console.log(`[processRows] per-row fallback: ${ok}/${chunk.length} succeeded`);
      if (ok === 0) throw new Error(`Upsert failed: ${error.message}`);
    }
  }
  return { imported: deduped.length, skipped: skipped + (toUpsert.length - deduped.length) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let payload: { action?: string; spreadsheet_id?: string; property_id?: string; tab?: string | null };
  try { payload = await req.json(); } catch { payload = {}; }
  const action = payload.action ?? "sync";

  // Auth: service role / CRON_SECRET for scheduled sync; super_admin JWT for everything else.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  let vaultCronSecret = "";
  try {
    const { data: vaultVal } = await admin.rpc("get_cron_secret_v2");
    vaultCronSecret = typeof vaultVal === "string" ? vaultVal : "";
  } catch (_e) { /* optional */ }
  const isCron = !!token && (
    token === SERVICE_KEY ||
    (!!CRON_SECRET && token === CRON_SECRET) ||
    (!!vaultCronSecret && token === vaultCronSecret)
  );

  let isSuper = false;
  if (!isCron) {
    if (!token) return j(401, { error: "Unauthorized" });
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: claimsRes, error: cErr } = await userClient.auth.getClaims(token);
    const uid = claimsRes?.claims?.sub;
    if (cErr || !uid) return j(401, { error: "Unauthorized" });
    const { data: superRes } = await admin.rpc("is_super_admin", { _user_id: uid });
    isSuper = superRes === true;
    if (!isSuper) return j(403, { error: "Forbidden" });
  }

  try {
    if (action === "list_tabs") {
      const { data: cfg } = await admin.from("sheet_sync_config").select("spreadsheet_id").maybeSingle();
      const spreadsheetId = cfg?.spreadsheet_id;
      if (!spreadsheetId) return j(200, { tabs: [], properties: [] });
      const tabs = await listTabs(spreadsheetId);
      const { data: props } = await admin.from("properties").select("id, name, google_sheet_tab").eq("is_active", true).order("name");
      const tabTitles = tabs.map((t) => t.title);
      const suggest = (name: string) => {
        const n = normalize(name);
        return tabTitles.find((t) => normalize(t) === n)
            ?? tabTitles.find((t) => normalize(t).includes(n) || n.includes(normalize(t)))
            ?? null;
      };
      return j(200, {
        tabs: tabTitles,
        properties: (props ?? []).map((p: { id: string; name: string; google_sheet_tab: string | null }) => ({
          id: p.id, name: p.name,
          google_sheet_tab: p.google_sheet_tab,
          suggested_tab: p.google_sheet_tab ?? suggest(p.name),
        })),
      });
    }

    if (action === "set_spreadsheet_id") {
      const id = String(payload.spreadsheet_id ?? "").trim();
      // Accept full URL too.
      const m = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const spreadsheet_id = m ? m[1] : id || null;
      const { data: existing } = await admin.from("sheet_sync_config").select("id").maybeSingle();
      if (existing) {
        await admin.from("sheet_sync_config").update({ spreadsheet_id }).eq("id", existing.id);
      } else {
        await admin.from("sheet_sync_config").insert({ spreadsheet_id });
      }
      return j(200, { spreadsheet_id });
    }

    if (action === "set_property_tab") {
      if (!payload.property_id) return j(400, { error: "property_id required" });
      const tab = payload.tab ? String(payload.tab) : null;
      const { error } = await admin.from("properties").update({ google_sheet_tab: tab }).eq("id", payload.property_id);
      if (error) return j(500, { error: error.message });
      return j(200, { ok: true });
    }

    // sync
    const { data: cfg } = await admin.from("sheet_sync_config").select("id, spreadsheet_id").maybeSingle();
    const spreadsheetId = cfg?.spreadsheet_id;
    if (!spreadsheetId) return j(400, { error: "No spreadsheet configured" });

    const started = new Date().toISOString();
    const { data: props } = await admin
      .from("properties")
      .select("id, name, google_sheet_tab")
      .eq("is_active", true)
      .not("google_sheet_tab", "is", null);

    const mapped = (props ?? []) as Array<{ id: string; name: string; google_sheet_tab: string }>;
    const uniqueTabs = Array.from(new Set(mapped.map((p) => p.google_sheet_tab)));

    // ONE batchGet call for every mapped tab — avoids the per-tab 429s we
    // used to hit when properties>quota/min. Retry once on 429 (5s wait).
    let tabRows: Record<string, string[][]> = {};
    let batchError: string | null = null;
    try {
      tabRows = await batchFetchTabRows(spreadsheetId, uniqueTabs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/\[429\]/.test(msg)) {
        await new Promise((r) => setTimeout(r, 5000));
        try { tabRows = await batchFetchTabRows(spreadsheetId, uniqueTabs); }
        catch (e2) { batchError = e2 instanceof Error ? e2.message : String(e2); }
      } else {
        batchError = msg;
      }
    }

    const results: Array<{ property_id: string; name: string; tab: string; imported: number; skipped: number; error?: string }> = [];
    let totalImported = 0;
    let anyError: string | null = batchError;

    for (const p of mapped) {
      const tab = p.google_sheet_tab;
      if (batchError) {
        results.push({ property_id: p.id, name: p.name, tab, imported: 0, skipped: 0, error: batchError });
        continue;
      }
      const rows = tabRows[tab];
      if (rows === undefined) {
        const msg = `Tab "${tab}" not found in spreadsheet`;
        results.push({ property_id: p.id, name: p.name, tab, imported: 0, skipped: 0, error: msg });
        anyError = msg;
        continue;
      }
      try {
        const r = await processRows(admin, p.id, rows);
        results.push({ property_id: p.id, name: p.name, tab, ...r });
        totalImported += r.imported;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ property_id: p.id, name: p.name, tab, imported: 0, skipped: 0, error: msg });
        anyError = msg;
      }
    }

    await admin.from("sheet_sync_config").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: anyError ? "partial" : "success",
      last_sync_error: anyError,
    }).eq("id", cfg!.id);

    return j(200, { started, total_imported: totalImported, properties: results, error: anyError });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("sheet_sync_config").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "failure",
      last_sync_error: msg,
    }).neq("id", "00000000-0000-0000-0000-000000000000");
    return j(500, { error: msg });
  }
});