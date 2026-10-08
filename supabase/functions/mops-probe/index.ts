// Temporary compatibility probe. Deleted after the check.
import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rpc = await sb.rpc("mops_probe_rpc");
  const direct = await sb.schema("mops_probe").from("t").select("*");
  return new Response(JSON.stringify({
    rpc: rpc.data ?? rpc.error?.message,
    direct: direct.error?.message ?? "readable",
    dbUrlPresent: Boolean(Deno.env.get("SUPABASE_DB_URL")),
  }), { headers: { "Content-Type": "application/json" } });
});
