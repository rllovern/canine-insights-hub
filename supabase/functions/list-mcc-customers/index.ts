// Lists all non-manager customer accounts under the agency's MCC.
// Uses GOOGLE_ADS_MCC_CUSTOMER_ID + GOOGLE_ADS_MCC_REFRESH_TOKEN secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_ADS_API_VERSION = "v23";

type ParsedResponse = {
  text: string;
  json: any | null;
  contentType: string;
};

async function parseResponse(res: Response): Promise<ParsedResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (!text) {
    return { text, json: null, contentType };
  }

  try {
    return { text, json: JSON.parse(text), contentType };
  } catch {
    return { text, json: null, contentType };
  }
}

function summarizeBody(parsed: ParsedResponse): string {
  if (parsed.json) return JSON.stringify(parsed.json);
  return parsed.text.replace(/\s+/g, " ").slice(0, 500) || "(empty response body)";
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const parsed = await parseResponse(res);
  const accessToken = parsed.json?.access_token;

  if (!res.ok || !accessToken) {
    const detail = summarizeBody(parsed);
    console.error("Google OAuth refresh failed:", detail);
    throw new Error(`refresh failed (${res.status} ${res.statusText}): ${detail}`);
  }

  return accessToken as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: isInternal } = await userClient.rpc("is_all_properties_reader", { _user_id: user.id });
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const mccId = (Deno.env.get("GOOGLE_ADS_MCC_CUSTOMER_ID") ?? "").replace(/-/g, "").trim();
    const refreshToken = Deno.env.get("GOOGLE_ADS_MCC_REFRESH_TOKEN");
    const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
    if (!mccId || !refreshToken || !devToken) {
      return new Response(JSON.stringify({ error: "missing MCC secrets (id/refresh_token/developer_token)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getAccessToken(refreshToken);

    const gaql = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.status,
        customer_client.manager
      FROM customer_client
      WHERE customer_client.manager = false
    `;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": devToken,
      "login-customer-id": mccId,
      "Content-Type": "application/json",
    };

    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${mccId}/googleAds:searchStream`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: gaql }) });
    const parsed = await parseResponse(res);

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: "google ads api error",
          detail: summarizeBody(parsed),
          status: res.status,
          content_type: parsed.contentType,
          url,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!parsed.json) {
      return new Response(
        JSON.stringify({
          error: "google ads api returned non-json",
          detail: summarizeBody(parsed),
          status: res.status,
          content_type: parsed.contentType,
          url,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const chunks = Array.isArray(parsed.json) ? parsed.json : [parsed.json];
    const out: Array<{ customer_id: string; name: string; currency: string; status: string }> = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const r of chunk.results ?? []) {
        const cc = r.customerClient ?? {};
        const id = String(cc.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
          customer_id: id,
          name: cc.descriptiveName ?? "(unnamed)",
          currency: cc.currencyCode ?? "",
          status: cc.status ?? "UNKNOWN",
        });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ mcc_id: mccId, customers: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
