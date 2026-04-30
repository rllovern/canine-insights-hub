// Channel classification uses CTM's tracking_source field, NEVER UTM heuristics.
// Add new sources to this map as Ridgeside introduces them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TRACKING_SOURCE_MAP: Record<string, string> = {
  "Google Ads": "Google PPC",
  "Google Call Asset": "Google PPC",
  "GMB Ad Extension": "Google PPC",
  "Facebook": "Facebook",
  "Facebook Call Extension": "Facebook",
  "Multi-Organic Search": "Organic",
  "Referral": "Referral",
  "Direct": "Direct",
};

function mapChannel(trackingSource: string | null | undefined): string {
  if (!trackingSource) return "Other";
  return TRACKING_SOURCE_MAP[trackingSource] ?? "Other";
}

interface SyncBody {
  property_id: string;
  from_date: string; // YYYY-MM-DD
  to_date: string;   // YYYY-MM-DD
  debug?: boolean;
}

function pickFirst<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authn / authz: must be an internal user
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const { data: isInternal, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userId,
      _role: "internal",
    });
    if (roleErr || !isInternal) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as SyncBody;
    if (!body?.property_id || !body?.from_date || !body?.to_date) {
      return json({ error: "property_id, from_date, to_date required" }, 400);
    }

    // Service role for credential read + upserts
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: ds, error: dsErr } = await admin
      .from("property_data_sources")
      .select("*")
      .eq("property_id", body.property_id)
      .eq("source", "ctm")
      .maybeSingle();
    if (dsErr) return json({ error: dsErr.message }, 500);
    if (!ds || !ds.is_connected) return json({ error: "CTM not connected for this property" }, 400);

    const cfg = (ds.config ?? {}) as {
      account_id?: string;
      api_token?: string;
      api_secret?: string;
      number_filter?: string[];
    };
    if (!cfg.account_id || !cfg.api_token || !cfg.api_secret) {
      return json({ error: "CTM credentials missing on property_data_sources.config" }, 400);
    }

    const basic = btoa(`${cfg.api_token}:${cfg.api_secret}`);
    const authHeaders = { Authorization: `Basic ${basic}`, Accept: "application/json" };

    // Page through calls
    const base = `https://api.calltrackingmetrics.com/api/v1/accounts/${cfg.account_id}/calls`;
    const debugSamples: unknown[] = [];
    const upserts: Record<string, unknown>[] = [];
    let page = 1;
    const perPage = 100;
    let totalPages = 1;

    while (page <= totalPages) {
      const url = new URL(base);
      url.searchParams.set("start_date", body.from_date);
      url.searchParams.set("end_date", body.to_date);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(perPage));

      const r = await fetch(url.toString(), { headers: authHeaders });
      if (!r.ok) {
        const txt = await r.text();
        return json({ error: `CTM API error ${r.status}: ${txt.slice(0, 500)}` }, 502);
      }
      const payload = await r.json();
      const calls: Record<string, unknown>[] = payload.calls ?? payload.data ?? [];
      totalPages = Number(payload.total_pages ?? payload.totalPages ?? 1) || 1;

      for (const call of calls) {
        if (debugSamples.length < 3 && body.debug) debugSamples.push(call);

        const callerNumber = (pickFirst<string>(call, ["caller_number_complete", "caller_number", "from", "from_number"]) ?? "") as string;

        // Optional number-based filter (when one CTM account spans multiple properties)
        if (cfg.number_filter && cfg.number_filter.length > 0) {
          const tracking = (pickFirst<string>(call, ["tracking_number", "called", "to", "to_number"]) ?? "") as string;
          const passes = cfg.number_filter.some((n) => tracking?.includes(n) || callerNumber?.includes(n));
          if (!passes) continue;
        }

        const trackingSource = pickFirst<string>(call, ["tracking_source", "source"]);
        const channel = mapChannel(trackingSource);
        const calledAt = pickFirst<string>(call, ["called_at", "start_time", "created_at"]);
        const duration = pickFirst<number>(call, ["duration", "talk_time", "call_duration"]);
        const campaign = pickFirst<string>(call, ["campaign", "campaign_name"]);
        const adGroup = pickFirst<string>(call, ["ad_group", "adgroup", "adgroup_name"]);
        const scoreLabel =
          pickFirst<string>(call, ["score", "call_score", "score_label", "tag", "label"]) ?? null;

        const ctmCallId = String(pickFirst(call, ["id", "call_id", "uuid"]) ?? "");
        if (!ctmCallId || !calledAt) continue;

        upserts.push({
          property_id: body.property_id,
          ctm_call_id: ctmCallId,
          called_at: calledAt,
          duration_seconds: typeof duration === "number" ? duration : Number(duration) || null,
          tracking_source: trackingSource,
          channel,
          campaign_name: campaign,
          ad_group: adGroup,
          caller_number: callerNumber || null,
          call_score_label: scoreLabel,
          call_score_bucket: null, // resolved in Prompt 4
          raw_payload: call,
          synced_at: new Date().toISOString(),
        });
      }

      if (calls.length === 0) break;
      page += 1;
      if (page > 50) break; // safety
    }

    let rows_written = 0;
    if (upserts.length > 0) {
      // chunk to avoid payload limits
      const chunkSize = 500;
      for (let i = 0; i < upserts.length; i += chunkSize) {
        const chunk = upserts.slice(i, i + chunkSize);
        const { error: upErr, count } = await admin
          .from("ctm_calls")
          .upsert(chunk, { onConflict: "property_id,ctm_call_id", count: "exact" });
        if (upErr) return json({ error: `Upsert failed: ${upErr.message}` }, 500);
        rows_written += count ?? chunk.length;
      }
    }

    await admin
      .from("property_data_sources")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", ds.id);

    return json({
      rows_written,
      from_date: body.from_date,
      to_date: body.to_date,
      ...(body.debug ? { debug_samples: debugSamples } : {}),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
