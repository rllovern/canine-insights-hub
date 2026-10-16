import { assert, assertEquals } from "jsr:@std/assert@1";
import { classifyForm, pickMessageKey, runPreflight, type PreflightDeps } from "./recon.ts";

Deno.test("form classification never guesses", () => {
  assertEquals(classifyForm("Google Ads PPC Form"), { classification: "inquiry", form_source: "ppc" });
  assertEquals(classifyForm("Website Organic"), { classification: "inquiry", form_source: "website" });
  assertEquals(classifyForm("Boarding Inquiry"), { classification: "inquiry", form_source: null }); // source unknown, not "website"
  assertEquals(classifyForm("Vaccine Records Upload").classification, "operational");
  assertEquals(classifyForm("Form 7").classification, "unclassified");
  assertEquals(classifyForm("Training contract consult").classification, "unclassified"); // conflicting signals
});

Deno.test("message key only when one field clearly stands out", () => {
  const s = (o: Record<string, unknown>) => ({ id: "x", createdAt: "2026-10-01T00:00:00Z", others: o });
  assertEquals(pickMessageKey([s({ q1: "my dog pulls on the leash a lot" }), s({ q1: "barks at every guest who arrives" })]).key, "q1");
  assertEquals(pickMessageKey([s({ q1: "my dog pulls on the leash", q2: "we live in a busy apartment" })]).key, null);
});

const base = (over: Partial<PreflightDeps> = {}): PreflightDeps => ({
  now: () => new Date("2026-10-15T12:00:00Z"),
  ghlForms: async () => [{ id: "f1", name: "Website Organic" }],
  ghlSubs: async () => Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, formId: "f1", contactId: `c${i}`, createdAt: `2026-10-0${i + 1}T10:00:00Z`, others: { msg: "my dog jumps on visitors constantly" } })),
  ctmReactors: async () => [{ frt: "FRTabc", numeric: "111", name: "Main" }],
  ctmActs: async () => Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, called_at_iso: `2026-10-0${i + 1}T10:00:30Z`, form_id: "111", contact_id: `c${i}`, submitted_at: null,
    message: "my dog jumps on visitors constantly", tag: "Good Lead", custom: { how_can_we_help_your_dog: "my dog jumps on visitors constantly" } })),
  ...over,
});
const ctx = { ghl_status: "connected", ctm_status: "connected", has_ghl: true, has_ctm: true };

Deno.test("preflight passes but never claims live validation", async () => {
  const r = await runPreflight(base(), ctx);
  assert(r.passed); assert(r.matching_verified);
  assertEquals(r.frt, "FRTabc"); assertEquals(r.form_numeric_id, "111");
  assert(r.checks.find((c) => c.key === "live_validation" && !c.ok));
});

Deno.test("paused connection holds the location", async () => {
  const r = await runPreflight(base(), { ...ctx, ghl_status: "paused" });
  assert(!r.passed);
});

Deno.test("multiple FormReactors with unclear routing hold the location", async () => {
  const r = await runPreflight(base({ ctmReactors: async () => [{ frt: "FRTa", numeric: "1", name: "A" }, { frt: "FRTb", numeric: "2", name: "B" }],
    ctmActs: async () => [] }), ctx);
  assert(!r.passed); assertEquals(r.frt, null);
});

Deno.test("too few submissions: passes to monitoring, matching not verified", async () => {
  const r = await runPreflight(base({ ghlSubs: async () => [] }), ctx);
  assert(r.passed); assert(!r.matching_verified);
});
