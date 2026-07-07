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
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing bearer token" }, 401);
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claimsRes, error: claimsErr } = await userClient.auth.getClaims(token);
  const callerId = claimsRes?.claims?.sub;
  if (claimsErr || !callerId) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: callerId });
  if (!isSuper) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (error) return json({ error: error.message }, 500);
    const users = (data.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? null,
      display_name: (u.user_metadata as Record<string, unknown> | null)?.display_name as string | null ?? null,
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

  if (action === "update") {
    const user_id = (body.user_id as string | undefined)?.trim();
    if (!user_id) return json({ error: "user_id required" }, 400);

    const email = (body.email as string | undefined)?.trim().toLowerCase();
    const password = body.password as string | undefined;
    const display_name = (body.display_name as string | undefined)?.trim();
    const role = body.role as Role | undefined;
    const property_id = (body.property_id as string | undefined) || null;

    if (role && !ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
    if (password && password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (role === "location_owner" && !property_id) {
      return json({ error: "Location Owner requires an assigned property" }, 400);
    }

    const attrs: Record<string, unknown> = {};
    if (email) attrs.email = email;
    if (password) attrs.password = password;
    if (typeof display_name === "string") {
      attrs.user_metadata = { display_name };
    }
    if (Object.keys(attrs).length > 0) {
      const { error: uErr } = await admin.auth.admin.updateUserById(user_id, attrs);
      if (uErr) return json({ error: uErr.message }, 400);
    }

    if (role) {
      // Prevent a Super Admin from demoting themselves out of super_admin
      if (user_id === callerId && role !== "super_admin") {
        return json({ error: "You cannot change your own role away from Super Admin" }, 400);
      }
      const del = await admin.from("user_roles").delete().eq("user_id", user_id);
      if (del.error) return json({ error: del.error.message }, 500);
      const ins = await admin.from("user_roles").insert({ user_id, role });
      if (ins.error) return json({ error: ins.error.message }, 500);

      // Reset location assignments when role changes; re-add for location_owner
      await admin.from("viewer_property_access").delete().eq("user_id", user_id);
      if (role === "location_owner" && property_id) {
        const { error: aErr } = await admin
          .from("viewer_property_access")
          .insert({ user_id, property_id });
        if (aErr) return json({ error: aErr.message }, 500);
      }
    } else if (property_id) {
      // Role unchanged but property re-assignment provided (location_owner case)
      await admin.from("viewer_property_access").delete().eq("user_id", user_id);
      const { error: aErr } = await admin
        .from("viewer_property_access")
        .insert({ user_id, property_id });
      if (aErr) return json({ error: aErr.message }, 500);
    }

    return json({ ok: true });
  }

  if (action === "delete") {
    const user_id = (body.user_id as string | undefined)?.trim();
    if (!user_id) return json({ error: "user_id required" }, 400);
    if (user_id === callerId) return json({ error: "You cannot delete your own account" }, 400);
    const { error: dErr } = await admin.auth.admin.deleteUser(user_id);
    if (dErr) return json({ error: dErr.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});