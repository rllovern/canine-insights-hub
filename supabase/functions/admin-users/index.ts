// Super Admin-only endpoint to list app users with emails and to create
// new users with a role (and optional assigned location for location_owner).
import { createClient } from "npm:@supabase/supabase-js@2";

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

async function handle(req: Request): Promise<Response> {
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
  // getClaims THROWS on a malformed or expired JWT rather than returning an
  // error — that uncaught throw was the 500 the admin panel hit whenever a
  // stale session token was sent.
  let callerId: string | undefined;
  try {
    const { data: claimsRes, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr) return json({ error: "Session expired — sign in again" }, 401);
    callerId = claimsRes?.claims?.sub;
  } catch (_e) {
    return json({ error: "Session expired — sign in again" }, 401);
  }
  if (!callerId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: callerId });
  if (!isSuper) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  const inviteRedirect = (appUrl?: string) =>
    appUrl ? `${appUrl.replace(/\/+$/, "")}/reset-password?welcome=1` : undefined;
  const recoveryRedirect = (appUrl?: string) =>
    appUrl ? `${appUrl.replace(/\/+$/, "")}/reset-password` : undefined;

  // Sends the built-in password-recovery email. Used for people who already
  // signed in at least once — same email they'd get from "Forgot password".
  // Uses the anon client because resetPasswordForEmail is a public auth
  // endpoint (the service client would bypass mail delivery).
  const sendRecoveryEmail = async (email: string, appUrl?: string) => {
    const redirectTo = recoveryRedirect(appUrl);
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { error } = await anon.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (error) {
      console.error("recovery email failed", email, error.message);
      return { sent: false, kind: "recovery" as const, error: error.message };
    }
    return { sent: true, kind: "recovery" as const, error: null as string | null };
  };

  // Sends the built-in *invitation* email — distinct subject and wording from
  // the password-reset email, so a brand new user is never greeted with
  // "Reset your password". inviteUserByEmail also creates the auth user.
  const sendInviteEmail = async (email: string, appUrl?: string) => {
    const redirectTo = inviteRedirect(appUrl);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (error) {
      console.error("invite email failed", email, error.message);
      return { sent: false, kind: "invite" as const, error: error.message, user_id: null as string | null };
    }
    return { sent: true, kind: "invite" as const, error: null as string | null, user_id: data.user?.id ?? null };
  };

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
    const { data: sec } = await admin.from("user_security").select("user_id, must_change_password");
    const secMap = new Map((sec ?? []).map((s: { user_id: string; must_change_password: boolean }) => [s.user_id, s.must_change_password]));
    return json({ users: users.map((u) => ({ ...u, must_change_password: secMap.get(u.id) ?? false })) });
  }

  if (action === "create") {
    const email = (body.email as string | undefined)?.trim().toLowerCase();
    const password = body.password as string | undefined;
    const role = body.role as Role | undefined;
    const property_id = (body.property_id as string | undefined) || null;
    const require_password_change = body.require_password_change !== false;
    const send_invite_email = body.send_invite_email !== false;
    const app_url = (body.app_url as string | undefined) || undefined;

    if (!email || !password || !role || !ROLES.includes(role)) {
      return json({ error: "email, password, and a valid role are required" }, 400);
    }
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (role === "location_owner" && !property_id) {
      return json({ error: "Location Owner requires an assigned property" }, 400);
    }

    // When we're emailing the person, create the account *through* the invite
    // endpoint so GoTrue delivers the invitation template (not the recovery
    // one), then stamp on the temp password admins use as a fallback.
    let newId: string;
    let invite_email_sent = false;
    let invite_email_error: string | null = null;

    if (send_invite_email) {
      const res = await sendInviteEmail(email, app_url);
      if (!res.sent || !res.user_id) {
        const msg = res.error ?? "Failed to create user";
        const friendly = /already been registered|already exists|duplicate/i.test(msg)
          ? `An account already exists for ${email}. Edit that user instead, or use "Resend invite" to send them a set-password link.`
          : msg;
        return json({ error: friendly }, 400);
      }
      newId = res.user_id;
      invite_email_sent = true;
      const { error: pErr } = await admin.auth.admin.updateUserById(newId, {
        password,
        email_confirm: true,
      });
      if (pErr) invite_email_error = pErr.message;
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (cErr || !created.user) {
        const msg = cErr?.message ?? "Failed to create user";
        const friendly = /already been registered|already exists|duplicate/i.test(msg)
          ? `An account already exists for ${email}. Edit that user instead, or use "Resend invite" to send them a set-password link.`
          : msg;
        return json({ error: friendly }, 400);
      }
      newId = created.user.id;
    }

    const { error: rErr } = await admin.from("user_roles").insert({ user_id: newId, role });
    if (rErr) return json({ error: rErr.message }, 500);

    await admin
      .from("user_security")
      .upsert({ user_id: newId, must_change_password: require_password_change }, { onConflict: "user_id" });

    if (role === "location_owner" && property_id) {
      const { error: aErr } = await admin
        .from("viewer_property_access")
        .insert({ user_id: newId, property_id });
      if (aErr) return json({ error: aErr.message }, 500);
    }

    return json({ ok: true, user_id: newId, invite_email_sent, invite_email_error });
  }

  if (action === "resend_invite") {
    const user_id = (body.user_id as string | undefined)?.trim();
    if (!user_id) return json({ error: "user_id required" }, 400);
    const app_url = (body.app_url as string | undefined) || undefined;

    const { data: target, error: gErr } = await admin.auth.admin.getUserById(user_id);
    if (gErr || !target?.user?.email) return json({ error: gErr?.message ?? "User has no email" }, 400);

    await admin
      .from("user_security")
      .upsert({ user_id, must_change_password: true }, { onConflict: "user_id" });

    // Never-signed-in accounts get the invitation email again; anyone who has
    // already used the app gets the ordinary reset link.
    const neverSignedIn = !target.user.last_sign_in_at;
    let res = neverSignedIn
      ? await sendInviteEmail(target.user.email, app_url)
      : await sendRecoveryEmail(target.user.email, app_url);
    // The invite endpoint refuses addresses it already created; fall back so
    // the person still receives a working link.
    if (!res.sent && res.kind === "invite") {
      res = await sendRecoveryEmail(target.user.email, app_url);
    }
    if (!res.sent) return json({ error: res.error ?? "Failed to send email" }, 400);
    return json({ ok: true, invite_email_sent: true, email_kind: res.kind });
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

    if (password && body.require_password_change !== false) {
      await admin
        .from("user_security")
        .upsert({ user_id, must_change_password: true }, { onConflict: "user_id" });
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
}

// Any unexpected throw must still come back as JSON *with* CORS headers,
// otherwise the browser reports an opaque failure instead of the real cause.
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("admin-users unhandled error", msg);
    return json({ error: `Server error: ${msg}` }, 500);
  }
});