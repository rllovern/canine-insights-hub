// Scheduled archive of Google Ads change events into the private Marketing Ops
// store. Cron-only: accepts the vault cron secret, rejects user tokens. It can
// only call mops_ingest_changes / mops_change_sync_state (write events + state).
// Read-only against Google Ads: no mutations.
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "v23";
const WINDOW_DAYS = 29; // Google retains ~30 days of change_event
const OVERLAP_MS = 2 * 86400000;

const pad = (n: number) => String(n).padStart(2, "0");
const gTime = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
  const { data: vaultSecret } = await admin.rpc("get_cron_secret_v2");
  const envSecret = Deno.env.get("CRON_SECRET") ?? "";
  const ok = !!token && ((!!vaultSecret && token === vaultSecret) || (!!envSecret && token === envSecret));
  if (!ok) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

  const { data: conns } = await admin.from("property_data_sources")
    .select("property_id, external_account_id, login_customer_id, campaign_label_filter")
    .eq("source", "google_ads").eq("is_connected", true);
  const byCustomer = new Map<string, { property_id: string; label: string | null; login: string | null }[]>();
  for (const c of conns ?? []) {
    if (!c.external_account_id) continue;
    const list = byCustomer.get(c.external_account_id) ?? [];
    list.push({ property_id: c.property_id, label: c.campaign_label_filter, login: c.login_customer_id });
    byCustomer.set(c.external_account_id, list);
  }
  const { data: states } = await admin.rpc("mops_change_sync_state");
  const lastThrough = new Map<string, string>((states ?? []).map((s: { customer_id: string; last_success_through: string }) => [s.customer_id, s.last_success_through]));

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_ADS_MCC_REFRESH_TOKEN")!, grant_type: "refresh_token",
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) {
    for (const cid of byCustomer.keys()) await admin.rpc("mops_ingest_changes", { _customer: cid, _events: [], _through: null, _ok: false, _error: "OAuth refresh failed" });
    return new Response(JSON.stringify({ error: "oauth" }), { status: 500 });
  }

  const summary: Record<string, unknown> = {};
  for (const [cid, props] of byCustomer) {
    const now = new Date();
    const floor = new Date(now.getTime() - WINDOW_DAYS * 86400000);
    const last = lastThrough.get(cid);
    const since = last ? new Date(Math.max(new Date(last).getTime() - OVERLAP_MS, floor.getTime())) : floor;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tok.access_token}`, "developer-token": Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!, "Content-Type": "application/json",
    };
    const login = props[0].login ?? Deno.env.get("GOOGLE_ADS_MCC_CUSTOMER_ID");
    if (login) headers["login-customer-id"] = login.replace(/-/g, "");
    const endpoint = `https://googleads.googleapis.com/${API}/customers/${cid}/googleAds:searchStream`;
    const search = async (query: string) => {
      const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ query }) });
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 400));
      const rows: any[] = [];
      for (const c of (Array.isArray(j) ? j : [j])) for (const row of (c.results ?? [])) rows.push(row);
      return rows;
    };
    try {
      const rows = await search(`SELECT change_event.change_date_time, change_event.user_email, change_event.client_type,
        change_event.change_resource_type, change_event.change_resource_name, change_event.resource_change_operation,
        change_event.changed_fields, change_event.campaign, change_event.ad_group
        FROM change_event WHERE change_event.change_date_time BETWEEN '${gTime(since)}' AND '${gTime(now)}'
        ORDER BY change_event.change_date_time ASC LIMIT 10000`);

      // Campaign names and (for shared accounts) campaign → location via labels.
      const campaignIds = new Set<string>();
      for (const r of rows) { const m = String(r.changeEvent?.campaign ?? "").match(/campaigns\/(\d+)/); if (m) campaignIds.add(m[1]); }
      const names = new Map<string, string>();
      const owner = new Map<string, string>();
      if (campaignIds.size) {
        const ids = [...campaignIds].join(",");
        for (const r of await search(`SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id IN (${ids})`)) names.set(String(r.campaign.id), r.campaign.name);
        if (props.length > 1) {
          const labelled = props.filter((p) => p.label);
          for (const r of await search(`SELECT campaign.id, label.name FROM campaign_label WHERE campaign.id IN (${ids})`)) {
            const hit = labelled.filter((p) => p.label === r.label?.name);
            if (hit.length === 1) owner.set(String(r.campaign.id), hit[0].property_id);
          }
        }
      }
      const events = rows.map((r) => {
        const e = r.changeEvent ?? {};
        const campId = String(e.campaign ?? "").match(/campaigns\/(\d+)/)?.[1];
        const agId = String(e.adGroup ?? "").match(/adGroups\/(\d+)/)?.[1];
        // Single-location account: everything belongs to that location.
        // Shared account: only label-matched campaigns are attributed; others and
        // account-wide changes stay unattributed and show on every sharing location.
        const property_id = props.length === 1 ? props[0].property_id : (campId ? owner.get(campId) ?? null : null);
        return {
          change_time: e.changeDateTime ? new Date(e.changeDateTime.replace(" ", "T") + "Z").toISOString() : null,
          resource_name: e.changeResourceName, operation: e.resourceChangeOperation, resource_type: e.changeResourceType,
          scope: campId ? "campaign" : "account", campaign_id: campId ?? null, campaign_name: campId ? names.get(campId) ?? null : null,
          ad_group_name: agId ?? null, property_id, user_email: e.userEmail, client_type: e.clientType,
          changed_fields: typeof e.changedFields === "string" ? e.changedFields : JSON.stringify(e.changedFields ?? ""),
        };
      });
      const { data, error } = await admin.rpc("mops_ingest_changes", { _customer: cid, _events: events, _through: now.toISOString(), _ok: true, _error: null });
      if (error) throw new Error(error.message);
      summary[cid] = data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.rpc("mops_ingest_changes", { _customer: cid, _events: [], _through: null, _ok: false, _error: msg });
      summary[cid] = { error: msg.slice(0, 120) };
    }
  }
  return new Response(JSON.stringify({ ok: true, summary }), { headers: { "Content-Type": "application/json" } });
});
