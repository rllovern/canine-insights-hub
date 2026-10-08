// Static security checks for Marketing Ops. Fails if a private endpoint skips
// the shared guard, reads the service key directly, or if any non-private
// function (Bob, reports, sync, onboarding) references the private system.
import { assert } from "jsr:@std/assert@1";

const root = new URL("../../", import.meta.url).pathname;
const CRON_ONLY = new Set(["mops-ads-changes-sync"]);

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith("_test.ts")) yield p;
  }
}

Deno.test("every mops-* user endpoint uses the shared guard and never the service key", async () => {
  for await (const e of Deno.readDir(root)) {
    if (!e.isDirectory || !e.name.startsWith("mops-") || CRON_ONLY.has(e.name)) continue;
    const src = await Deno.readTextFile(`${root}${e.name}/index.ts`);
    assert(/Deno\.serve\(mopsHandler\(/.test(src), `${e.name} must use Deno.serve(mopsHandler(...))`);
    assert(!src.includes("SUPABASE_SERVICE_ROLE_KEY"), `${e.name} must not read the service key`);
    assert(!src.includes("createClient"), `${e.name} must not create its own database client`);
  }
});

Deno.test("cron-only private job rejects user tokens and only uses ingest functions", async () => {
  const src = await Deno.readTextFile(`${root}mops-ads-changes-sync/index.ts`);
  assert(src.includes("get_cron_secret_v2"), "must verify the cron secret");
  assert(!src.includes("mops_api"), "cron job must not call the user data entry point");
  assert(!src.includes("getClaims") && !src.includes("auth.getUser"), "cron job must not accept user sessions");
});

Deno.test("no function outside mops-* references the private system", async () => {
  for await (const e of Deno.readDir(root)) {
    if (!e.isDirectory || e.name.startsWith("mops-") || e.name === "_shared") continue;
    for await (const f of walk(`${root}${e.name}`)) {
      const src = await Deno.readTextFile(f);
      assert(!/mops_|schema\(["']mops["']\)|\bmops\./.test(src), `${f} references Marketing Ops`);
    }
  }
  for await (const f of walk(`${root}_shared`)) {
    if (f.includes("/_shared/mops/")) continue;
    const src = await Deno.readTextFile(f);
    assert(!/mops_|\bmops\./.test(src), `${f} references Marketing Ops`);
  }
});
