// Super Admin-only endpoint to list app users with emails and to create
// new users with a role (and optional assigned location for location_owner).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = ["super_admin", "admin", "owner", "location_owner"] as const;
type Role = typeof ROLES[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userRes } = await admin.auth.getUser(jwt);
  const caller = userRes?.user;
  if (!caller) return json({ error: "Unauthorized" }, 401);

  const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: caller.id });
  if (!isSuper) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (error) return json({ error: error.message }, 500);
    const users = (data.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }));
    return json({ users });
  }

  if (action === "create") {
    const email = (body.email as string | undefined)?.trim().toLowerCase();
    const password = body.password as string | undefined;
    const role = body.role as Role | undefined;
    const property_id = (body.property_id as string | undefined) || null;

    if (!email || !password || !role || !ROLES.includes(role)) {
      return json({ error: "email, password, and a valid role are required" }, 400);
    }
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (role === "location_owner" && !property_id) {
      return json({ error: "Location Owner requires an assigned property" }, 400);
    }

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (cErr || !created.user) return json({ error: cErr?.message ?? "Failed to create user" }, 400);
    const newId = created.user.id;

    const { error: rErr } = await admin.from("user_roles").insert({ user_id: newId, role });
    if (rErr) return json({ error: rErr.message }, 500);

    if (role === "location_owner" && property_id) {
      const { error: aErr } = await admin
        .from("viewer_property_access")
        .insert({ user_id: newId, property_id });
      if (aErr) return json({ error: aErr.message }, 500);
    }

    return json({ ok: true, user_id: newId });
  }

  return json({ error: "Unknown action" }, 400);
});