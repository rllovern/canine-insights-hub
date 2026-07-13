// Pulls GA4 source/medium breakdown for one client and upserts into daily_metrics.
// Uses GA4_SERVICE_ACCOUNT_JSON secret to mint a JWT and exchange it for an access token.
// Per-client GA4 property ID lives in client_data_sources.external_account_id (e.g. "123456789").
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoYesterday(): string { return isoDaysAgo(1); }

// --- JWT signing helpers (RS256) using WebCrypto ---
function b64url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else if (input instanceof Uint8Array) bytes = input;
  else bytes = new Uint8Array(input);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getGa4AccessToken(): Promise<string> {
  const raw = Deno.env.get("GA4_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GA4_SERVICE_ACCOUNT_JSON not set");
  let sa: any;
  try { sa = JSON.parse(raw); } catch { throw new Error("GA4_SERVICE_ACCOUNT_JSON is not valid JSON"); }
  const { client_email, private_key, token_uri } = sa;
  if (!client_email || !private_key) throw new Error("service account JSON missing client_email or private_key");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: token_uri ?? "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyData = pemToArrayBuffer(private_key.replace(/\\n/g, "\n"));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const tokenRes = await fetch(token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(`token exchange failed (${tokenRes.status}): ${JSON.stringify(tokenJson).slice(0, 400)}`);
  }
  return tokenJson.access_token as string;
}

// Map GA4 source/medium to a normalized ad_source bucket
function mapSourceMedium(source: string, medium: string): { adSource: string; skip: boolean } {
  const s = (source || "").toLowerCase();
  const m = (medium || "").toLowerCase();
  // skip paid traffic to avoid double counting Google Ads numbers
  if (m === "cpc" || m === "ppc" || m.includes("paid")) return { adSource: "Paid", skip: true };
  if (m === "organic") return { adSource: "Organic", skip: false };
  if (s === "(direct)" || m === "(none)" || m === "none") return { adSource: "Direct", skip: false };
  if (m === "referral") return { adSource: "Referral", skip: false };
  if (m === "email") return { adSource: "Email", skip: false };
  if (m === "social" || ["facebook", "instagram", "twitter", "tiktok", "linkedin", "youtube"].some(p => s.includes(p))) {
    return { adSource: "Social", skip: false };
  }
  return { adSource: "Other", skip: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth guard: allow service role / CRON_SECRET / internal user JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  let authorized = false;
  if (token && (token === SERVICE_KEY || (CRON_SECRET && token === CRON_SECRET))) {
    authorized = true;
  } else if (token) {
    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData } = await anon.auth.getUser(token);
    const uid = userData?.user?.id as string | undefined;
    if (uid) {
      const { data: isAdmin } = await admin.rpc("is_all_properties_reader", { _user_id: uid });
      if (isAdmin) authorized = true;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { client_id, date_from, date_to } = body ?? {};
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const from = date_from ?? isoDaysAgo(30);
    const to = date_to ?? isoYesterday();

    const { data: conn, error: connErr } = await admin
      .from("client_data_sources")
      .select("*")
      .eq("client_id", client_id)
      .eq("source", "ga4")
      .maybeSingle();
    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: "no ga4 connection for client" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const propertyId = String(conn.external_account_id ?? "").replace(/^properties\//, "").trim();
    if (!propertyId) {
      return new Response(JSON.stringify({ error: "connection missing GA4 property id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let accessToken: string;
    try {
      accessToken = await getGa4AccessToken();
    } catch (e) {
      await admin.from("client_data_sources").update({ status: "error", last_error: String(e).slice(0, 1000) }).eq("id", conn.id);
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const reportBody = {
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      limit: 100000,
    };

    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(reportBody),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* */ }

    if (!res.ok) {
      await admin.from("client_data_sources").update({ status: "error", last_error: (text || "").slice(0, 1000) }).eq("id", conn.id);
      return new Response(
        JSON.stringify({ error: "ga4 api error", status: res.status, detail: (text || "").slice(0, 500), url }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    type Bucket = { sessions: number; users: number };
    const agg = new Map<string, Bucket>(); // key = date::adSource::campaign(srcMed)
    for (const row of (json?.rows ?? [])) {
      const dims = row.dimensionValues ?? [];
      const mets = row.metricValues ?? [];
      const dateRaw = String(dims[0]?.value ?? ""); // YYYYMMDD
      if (dateRaw.length !== 8) continue;
      const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
      const source = String(dims[1]?.value ?? "(unknown)");
      const medium = String(dims[2]?.value ?? "(unknown)");
      const { adSource, skip } = mapSourceMedium(source, medium);
      if (skip) continue;
      const sessions = Number(mets[0]?.value ?? 0);
      const users = Number(mets[1]?.value ?? 0);
      const campaign = `${source} / ${medium}`;
      const key = `${date}::${adSource}::${campaign}`;
      const b = agg.get(key) ?? { sessions: 0, users: 0 };
      b.sessions += sessions;
      b.users += users;
      agg.set(key, b);
    }

    const upsertRows = Array.from(agg.entries()).map(([key, b]) => {
      const [date, adSource, campaign] = key.split("::");
      return {
        client_id,
        date,
        ad_source: adSource,
        campaign,
        sessions: b.sessions,
        users: b.users,
      };
    });

    let written = 0;
    if (upsertRows.length) {
      // Non-destructive merge-upsert: preserve CTM-owned (record_count/leads/etc) and
      // Google-Ads-owned (cost/impressions/clicks) columns when a row already exists.
      const dates = Array.from(new Set(upsertRows.map(r => r.date)));
      const channels = Array.from(new Set(upsertRows.map(r => r.ad_source)));
      const { data: existing } = await admin
        .from("daily_metrics")
        .select("date,ad_source,campaign,cost,impressions,clicks,record_count,leads,good_leads,bad_leads,medicaid,projected_sale,verified_sale,no_entry,spam")
        .eq("client_id", client_id)
        .in("date", dates)
        .in("ad_source", channels);
      const existingMap = new Map<string, any>();
      for (const r of (existing ?? []) as any[]) {
        existingMap.set(`${r.date}::${r.ad_source}::${r.campaign}`, r);
      }
      const merged = upsertRows.map((r) => {
        const prev = existingMap.get(`${r.date}::${r.ad_source}::${r.campaign}`);
        return {
          ...r,
          cost: prev ? Number(prev.cost ?? 0) : 0,
          impressions: prev ? Number(prev.impressions ?? 0) : 0,
          clicks: prev ? Number(prev.clicks ?? 0) : 0,
          record_count: prev ? Number(prev.record_count ?? 0) : 0,
          leads: prev ? Number(prev.leads ?? 0) : 0,
          good_leads: prev ? Number(prev.good_leads ?? 0) : 0,
          bad_leads: prev ? Number(prev.bad_leads ?? 0) : 0,
          medicaid: prev ? Number(prev.medicaid ?? 0) : 0,
          projected_sale: prev ? Number(prev.projected_sale ?? 0) : 0,
          verified_sale: prev ? Number(prev.verified_sale ?? 0) : 0,
          no_entry: prev ? Number(prev.no_entry ?? 0) : 0,
          spam: prev ? Number(prev.spam ?? 0) : 0,
        };
      });
      const { error: insErr, count } = await admin
        .from("daily_metrics")
        .upsert(merged, { onConflict: "client_id,date,ad_source,campaign", count: "exact" });
      if (insErr) {
        await admin.from("client_data_sources").update({ status: "error", last_error: insErr.message }).eq("id", conn.id);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      written = count ?? merged.length;
    }

    await admin.from("client_data_sources")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);

    return new Response(JSON.stringify({ ok: true, written, range: { from, to } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
