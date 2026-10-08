// Shared guard for every private Marketing Ops endpoint (mops-*).
// Identity comes ONLY from the verified sign-in token. The privileged client is
// created here, after authentication, and is only exposed through `call`, which
// routes every data operation through public.mops_api — a database function that
// re-checks the explicit grant for the token-derived user before doing anything.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export const notFound = () => json({ error: "Not found" }, 404);

export interface MopsCtx {
  uid: string;
  body: Record<string, unknown>;
  /** Runs one whitelisted operation through the grant-checking database entry point. */
  call: (op: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Private SOP file storage. Only reachable after the grant check passed. */
  sopStorage: () => ReturnType<SupabaseClient["storage"]["from"]>;
}

// Fields a caller may never use to influence identity.
const FORBIDDEN_KEYS = ["user_id", "uid", "actor", "_actor", "userId"];

export function mopsHandler(endpoint: string, handler: (ctx: MopsCtx) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin: SupabaseClient = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const deny = async (actor: string | null, reason: string) => {
      try { await admin.rpc("mops_audit_event", { _actor: actor, _endpoint: endpoint, _outcome: "denied", _detail: { reason } }); }
      catch (_e) { console.warn(`[${endpoint}] denied (${reason}); audit write failed`); }
      return notFound();
    };

    if (req.method !== "POST") return deny(null, "method");
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return deny(null, "no_token");
    const token = auth.slice(7).trim();

    let uid: string | null = null;
    try {
      const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data, error } = await anon.auth.getClaims(token);
      if (!error && data?.claims?.sub && data.claims.role === "authenticated") uid = data.claims.sub as string;
    } catch (_e) { uid = null; }
    if (!uid) return deny(null, "invalid_token");

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body && typeof body === "object") {
      for (const k of FORBIDDEN_KEYS) if (k in body) return deny(uid, "identity_field_in_body");
      const args = body.args as Record<string, unknown> | undefined;
      if (args && typeof args === "object") for (const k of FORBIDDEN_KEYS) if (k in args) return deny(uid, "identity_field_in_body");
    }

    const { data: granted, error: gErr } = await admin.rpc("mops_api", { _actor: uid, _endpoint: endpoint, _op: "__check", _args: {} });
    if (gErr) { console.error(`[${endpoint}] check failed`, gErr.message); return json({ error: "Unavailable" }, 503); }
    if ((granted as { error?: string })?.error === "not_found") return notFound();

    const call = async (op: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await admin.rpc("mops_api", { _actor: uid, _endpoint: endpoint, _op: op, _args: args });
      if (error) throw new Error(error.message);
      const out = (data ?? {}) as Record<string, unknown>;
      if (out.error === "not_found") throw new MopsNotFound();
      return out;
    };

    try {
      return await handler({ uid, body: body ?? {}, call });
    } catch (e) {
      if (e instanceof MopsNotFound) return notFound();
      const msg = e instanceof Error ? e.message : String(e);
      try { await admin.rpc("mops_audit_event", { _actor: uid, _endpoint: endpoint, _outcome: "error", _detail: { message: msg.slice(0, 300) } }); } catch (_e) { /* logged below */ }
      console.error(`[${endpoint}]`, msg);
      return json({ error: msg.includes("questionnaire") ? msg : "Request failed" }, 400);
    }
  };
}

class MopsNotFound extends Error {}
