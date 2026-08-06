// Lets a signed-in user set their own password and clears the
// "must change password" flag. Service-role write, JWT-validated caller.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const token = authHeader.replace("Bearer ", "").trim();

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claimsRes, error: claimsErr } = await userClient.auth.getClaims(token);
  const callerId = claimsRes?.claims?.sub as string | undefined;
  const callerEmail = claimsRes?.claims?.email as string | undefined;
  if (claimsErr || !callerId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
  if (password.length > 128) return json({ error: "Password is too long" }, 400);

  // Reject reusing the current password.
  if (callerEmail) {
    const probe = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: sameErr } = await probe.auth.signInWithPassword({ email: callerEmail, password });
    if (!sameErr) return json({ error: "Choose a password different from your current one" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error: uErr } = await admin.auth.admin.updateUserById(callerId, { password });
  if (uErr) return json({ error: uErr.message }, 400);

  const { error: sErr } = await admin
    .from("user_security")
    .upsert({ user_id: callerId, must_change_password: false }, { onConflict: "user_id" });
  if (sErr) return json({ error: sErr.message }, 500);

  return json({ ok: true });
});
