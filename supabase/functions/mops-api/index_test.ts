// Live denial tests against the deployed private endpoints.
import { assertEquals } from "jsr:@std/assert@1";

const URL_ = Deno.env.get("SUPABASE_URL") ?? "https://yptgdovnvmpgwcvfdnrq.supabase.co";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGdkb3Zudm1wZ3djdmZkbnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1Njg4NDIsImV4cCI6MjA5MzE0NDg0Mn0.CCSOSTs0AH8iA9GImavK9BpcDcjPO7VMTWYuzKOxYbs";
const fn = (name: string) => `${URL_}/functions/v1/${name}`;

async function status(name: string, headers: Record<string, string>, body: unknown) {
  const r = await fetch(fn(name), { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, ...headers }, body: JSON.stringify(body) });
  await r.text();
  return r.status;
}

for (const name of ["mops-api", "mops-ai"]) {
  Deno.test(`${name}: no token -> 404`, async () => {
    assertEquals(await status(name, {}, { op: "directory" }), 404);
  });
  Deno.test(`${name}: anon key as bearer -> 404`, async () => {
    assertEquals(await status(name, { Authorization: `Bearer ${ANON}` }, { op: "directory" }), 404);
  });
  Deno.test(`${name}: forged token -> 404`, async () => {
    assertEquals(await status(name, { Authorization: "Bearer abc.def.ghi" }, { op: "directory", user_id: "5a69d56f-7ae2-421b-8220-c741491511ed" }), 404);
  });
}

Deno.test("mops-ads-changes-sync: user/anon token -> 404", async () => {
  assertEquals(await status("mops-ads-changes-sync", { Authorization: `Bearer ${ANON}` }, {}), 404);
});

Deno.test("private RPCs are not callable from the browser", async () => {
  for (const rpc of ["mops_api", "mops_ingest_changes", "mops_audit_event", "mops_privilege_audit"]) {
    const r = await fetch(`${URL_}/rest/v1/rpc/${rpc}`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: "{}" });
    const t = await r.text();
    assertEquals(r.ok, false, `${rpc}: ${t}`);
  }
  const r = await fetch(`${URL_}/rest/v1/access_grants?select=*`, { headers: { apikey: ANON, "Accept-Profile": "mops" } });
  await r.text();
  assertEquals(r.ok, false);
});
