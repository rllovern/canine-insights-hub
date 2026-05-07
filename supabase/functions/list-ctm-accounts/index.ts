// Lists CTM sub-accounts under the agency parent account.
// Uses CTM_ACCOUNT_ID + CTM_API_ACCESS_KEY + CTM_API_SECRET_KEY secrets (HTTP Basic auth).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ctmAuthHeader(): string {
  const access = Deno.env.get("CTM_API_ACCESS_KEY") ?? "";
  const secret = Deno.env.get("CTM_API_SECRET_KEY") ?? "";
  return "Basic " + btoa(`${access}:${secret}`);
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
    const { data: isInternal } = await userClient.rpc("has_role", { _user_id: user.id, _role: "internal" });
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const parentId = (Deno.env.get("CTM_ACCOUNT_ID") ?? "").trim();
    const access = Deno.env.get("CTM_API_ACCESS_KEY");
    const secret = Deno.env.get("CTM_API_SECRET_KEY");
    if (!parentId || !access || !secret) {
      return new Response(JSON.stringify({ error: "missing CTM secrets (account_id/access_key/secret_key)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const out: Array<{ account_id: string; name: string; status: string }> = [];
    let page = 1;
    const perPage = 100;
    // CTM API: GET /api/v1/accounts/{parent_id}/sub_accounts.json?page=N&per_page=100
    while (true) {
      const url = `https://api.calltrackingmetrics.com/api/v1/accounts/${parentId}/sub_accounts.json?page=${page}&per_page=${perPage}`;
      const res = await fetch(url, { headers: { Authorization: ctmAuthHeader(), Accept: "application/json" } });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* */ }

      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: "ctm api error", status: res.status, detail: (text || "").slice(0, 500), url }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const list = (json?.accounts ?? json?.sub_accounts ?? []) as any[];
      for (const a of list) {
        const id = String(a.id ?? a.account_id ?? "");
        if (!id) continue;
        out.push({
          account_id: id,
          name: a.name ?? a.display_name ?? "(unnamed)",
          status: a.status ?? a.account_status ?? "active",
        });
      }

      const totalPages = Number(json?.total_pages ?? 1);
      if (list.length < perPage || page >= totalPages) break;
      page++;
      if (page > 50) break; // safety cap
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return new Response(JSON.stringify({ parent_id: parentId, accounts: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
