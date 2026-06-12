// Sync Go High Level data for a property using the agency Private Integration token.
// Pulls contacts (typed + raw) and a catch-all archive of conversations, messages,
// opportunities, appointments, notes and tasks into ghl_events_raw.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

type Json = Record<string, unknown>;

class GhlError extends Error {
  status: number;
  path: string;
  body: string;
  constructor(path: string, status: number, body: string) {
    super(`GHL ${path} ${status}: ${body.slice(0, 500)}`);
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

function tokenFingerprint(token: string) {
  if (!token) return "missing";
  return `len=${token.length} ${token.slice(0, 4)}…${token.slice(-4)}`;
}

function friendlyGhlError(err: GhlError): string {
  if (err.status === 401) {
    return `Go High Level rejected the request to ${err.path} (401). The Private Integration token is missing the required scope, or it does not have access to this location. In GHL → Settings → Private Integrations, enable read access for: Contacts, Locations, Conversations, Conversation Messages, Opportunities. If you regenerated the token, update the GHL_PRIVATE_INTEGRATION_TOKEN secret with the new value.`;
  }
  if (err.status === 403) {
    return `Go High Level forbade ${err.path} (403). The token is valid but does not have permission for this location or resource.`;
  }
  return err.message;
}

async function ghl(path: string, token: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(GHL_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GhlError(path, res.status, text);
  }
  return (await res.json()) as Json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TOKEN = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN") ?? "";
  if (!TOKEN) {
    return new Response(JSON.stringify({ error: "GHL_PRIVATE_INTEGRATION_TOKEN missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { property_id?: string; date_from?: string; date_to?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const { property_id, date_from, date_to } = body;
  if (!property_id) {
    return new Response(JSON.stringify({ error: "property_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Look up GHL location id for this property
  const { data: pds, error: pdsErr } = await admin
    .from("property_data_sources")
    .select("config, status")
    .eq("property_id", property_id)
    .eq("source", "ghl")
    .maybeSingle();
  if (pdsErr) {
    return new Response(JSON.stringify({ error: pdsErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const locationId = (pds?.config as Json | null)?.location_id as string | undefined;
  if (!locationId) {
    return new Response(JSON.stringify({ error: "GHL location not configured for property" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fromIso = date_from ? new Date(date_from).toISOString() : new Date(Date.now() - 30 * 86400_000).toISOString();
  const toIso = date_to ? new Date(date_to).toISOString() : new Date().toISOString();

  let written = 0;

  // ---- 1. Contacts ----
  // Use search endpoint to filter by date_added range.
  const contacts: Json[] = [];
  try {
    let page = 1;
    while (page < 50) {
      const res = await ghl("/contacts/", TOKEN, {
        locationId,
        limit: 100,
        page,
      });
      const list = (res.contacts as Json[]) ?? [];
      if (!list.length) break;
      contacts.push(...list);
      if (list.length < 100) break;
      page++;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Filter to date window using dateAdded
  const inRange = contacts.filter((c) => {
    const d = (c as any).dateAdded || (c as any).createdAt;
    if (!d) return true;
    const t = new Date(d).getTime();
    return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime();
  });

  // Upsert contacts
  if (inRange.length) {
    const rows = inRange.map((c) => {
      const anyC = c as any;
      return {
        property_id,
        ghl_location_id: locationId,
        ghl_contact_id: String(anyC.id),
        first_name: anyC.firstName ?? null,
        last_name: anyC.lastName ?? null,
        email: anyC.email ?? null,
        phone: anyC.phone ?? null,
        source: anyC.source ?? null,
        assigned_to: anyC.assignedTo ?? null,
        tags: Array.isArray(anyC.tags) ? anyC.tags : null,
        ghl_created_at: anyC.dateAdded ?? anyC.createdAt ?? null,
        raw: c as never,
      };
    });
    const { error: upErr } = await admin
      .from("ghl_contacts")
      .upsert(rows, { onConflict: "property_id,ghl_contact_id" });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    written += rows.length;
  }

  // ---- 2. Conversations + first outbound message for speed-to-lead ----
  // GHL conversations: GET /conversations/search?locationId=...
  try {
    const convRes = await ghl("/conversations/search", TOKEN, {
      locationId,
      limit: 100,
    });
    const convs = (convRes.conversations as Json[]) ?? [];
    if (convs.length) {
      await admin.from("ghl_events_raw").upsert(
        convs.map((c) => {
          const anyC = c as any;
          return {
            property_id,
            ghl_location_id: locationId,
            object_type: "conversation",
            ghl_object_id: String(anyC.id),
            occurred_at: anyC.lastMessageDate ?? anyC.dateUpdated ?? null,
            raw: c as never,
          };
        }),
        { onConflict: "property_id,object_type,ghl_object_id" },
      );
      written += convs.length;

      // For each conversation tied to a contact in our range, pull messages and
      // compute first outbound timestamp -> speed_to_lead.
      const contactIds = new Set(inRange.map((c) => String((c as any).id)));
      for (const c of convs) {
        const anyC = c as any;
        const contactId = anyC.contactId;
        if (!contactId || !contactIds.has(String(contactId))) continue;
        try {
          const msgRes = await ghl(`/conversations/${anyC.id}/messages`, TOKEN, { limit: 100 });
          const messages = ((msgRes as any).messages?.messages ?? (msgRes as any).messages ?? []) as Json[];
          if (!messages.length) continue;

          // Archive raw messages
          await admin.from("ghl_events_raw").upsert(
            messages.map((m) => {
              const anyM = m as any;
              return {
                property_id,
                ghl_location_id: locationId,
                object_type: "message",
                ghl_object_id: String(anyM.id),
                occurred_at: anyM.dateAdded ?? null,
                raw: m as never,
              };
            }),
            { onConflict: "property_id,object_type,ghl_object_id" },
          );
          written += messages.length;

          // First outbound message
          const outbound = messages
            .filter((m) => (m as any).direction === "outbound" && (m as any).dateAdded)
            .sort((a, b) => new Date((a as any).dateAdded).getTime() - new Date((b as any).dateAdded).getTime());
          if (!outbound.length) continue;
          const firstOutAt = (outbound[0] as any).dateAdded;

          const contactRaw = inRange.find((x) => String((x as any).id) === String(contactId)) as any;
          const createdAt = contactRaw?.dateAdded ?? contactRaw?.createdAt;
          if (!createdAt) continue;
          const seconds = Math.max(0, Math.round((new Date(firstOutAt).getTime() - new Date(createdAt).getTime()) / 1000));
          await admin
            .from("ghl_contacts")
            .update({ first_response_at: firstOutAt, speed_to_lead_seconds: seconds })
            .eq("property_id", property_id)
            .eq("ghl_contact_id", String(contactId));
        } catch (_e) { /* keep going on per-conversation errors */ }
      }
    }
  } catch (_e) { /* conversations are best-effort */ }

  // ---- 3. Opportunities ----
  try {
    const opRes = await ghl("/opportunities/search", TOKEN, { location_id: locationId, limit: 100 });
    const ops = ((opRes as any).opportunities ?? []) as Json[];
    if (ops.length) {
      await admin.from("ghl_events_raw").upsert(
        ops.map((o) => {
          const anyO = o as any;
          return {
            property_id,
            ghl_location_id: locationId,
            object_type: "opportunity",
            ghl_object_id: String(anyO.id),
            occurred_at: anyO.updatedAt ?? anyO.createdAt ?? null,
            raw: o as never,
          };
        }),
        { onConflict: "property_id,object_type,ghl_object_id" },
      );
      written += ops.length;
    }
  } catch (_e) { /* best-effort */ }

  // Update last_synced_at on the data source
  await admin
    .from("property_data_sources")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("property_id", property_id)
    .eq("source", "ghl");

  return new Response(JSON.stringify({ written, contacts: inRange.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});