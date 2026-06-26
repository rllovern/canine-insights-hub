// One-shot seeder: creates Bob the demo viewer user, grants viewer role,
// and gives him access to every active property. Idempotent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOB_EMAIL = "bob@demo.rsk9insights.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1) Find or create Bob's auth user.
  let bobId: string | null = null;
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) return json({ error: listErr.message }, 500);
  const existing = list.users.find((u) => u.email?.toLowerCase() === BOB_EMAIL);
  if (existing) {
    bobId = existing.id;
  } else {
    const password = crypto.randomUUID() + "!Aa1";
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: BOB_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Bob (demo viewer)" },
    });
    if (createErr || !created.user) return json({ error: createErr?.message ?? "create failed" }, 500);
    bobId = created.user.id;
  }

  // 2) Ensure viewer role.
  await admin.from("user_roles").upsert(
    { user_id: bobId, role: "viewer" },
    { onConflict: "user_id,role" },
  );

  // 3) Grant access to every active property.
  const { data: props } = await admin.from("properties").select("id").eq("is_active", true);
  if (props && props.length > 0) {
    const rows = props.map((p: { id: string }) => ({ user_id: bobId, property_id: p.id }));
    await admin.from("viewer_property_access").upsert(rows, { onConflict: "user_id,property_id" });
  }

  return json({ bob_user_id: bobId, properties_granted: props?.length ?? 0 });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}