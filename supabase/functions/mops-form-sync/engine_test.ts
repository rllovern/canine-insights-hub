// Scenario tests for the Form Sync engine with in-memory GHL, CTM and ledger.
import { assertEquals } from "jsr:@std/assert@1";
import { runLocation, type Deps, type PostResult } from "./engine.ts";
import type { CtmActivity, GhlSubmission } from "./logic.ts";

const PPC = "qm5V09KmznBu9qr8Rg9R", ORG = "BhIOk9O1aBY67meflSjI", MSGKEY = "7JAaPjDMaiAPytxEaTzN";
const ACT = "2026-10-15T17:00:00Z";

function world(opts: { live?: boolean; now?: string } = {}) {
  let now = new Date(opts.now ?? "2026-10-15T19:00:00Z");
  const cfg = { production_watch_limit: 0, composite_match: false, ctm_form_reactor_id: "FRT", ctm_form_numeric_id: "238140", message_field: "how_can_we_help_your_dog", ghl_message_key: MSGKEY,
    delivery_enabled: true, lookback_minutes: 120, activation_at: ACT, grace_minutes: 15, qualify_minutes: 5, max_attempts: 6,
    form_map: { [PPC]: { form_name: "New Client Form", form_source: "ppc" }, [ORG]: { form_name: "New Client Form", form_source: "website" } } };
  const rows: any[] = []; const ghl: GhlSubmission[] = []; const ctm: CtmActivity[] = [];
  const posts: Record<string, string>[] = [];
  let postMode: "ok" | "fail500" | "timeout_but_created" = "ok";
  let seq = 1;
  const safety: string[] = [];
  const call: Deps["call"] = async (op, a: any = {}) => {
    if (op === "formsync_safety") { if (a.action === "stop") safety.push(a.reason); return { allowed: safety.length === 0, submissions: rows.slice(0, 5), ok: true }; }
    if (op === "formsync_config") return { config: cfg, checkpoint: null };
    if (op === "formsync_work") return { submissions: rows.filter((r) => ["received", "pending_delivery", "pending_verification", "failed"].includes(r.status) || (["matched", "delivered"].includes(r.status) && r.ctm_activity_id && r.qualification !== "classified")).map((r) => ({ ...r })) };
    if (op === "formsync_claimed") return { claimed: rows.filter((r) => r.ctm_activity_id).map((r) => r.ctm_activity_id) };
    if (op === "formsync_ingest") {
      let n = 0;
      for (const it of a.items) {
        if (rows.some((r) => r.ghl_submission_id === it.ghl_submission_id)) continue;
        const held = !(cfg.form_map as any)[it.ghl_form_id] || Date.parse(it.submitted_at) < Date.parse(ACT);
        rows.push({ id: `row${seq++}`, ...it, status: held ? "held" : "received", attempts: 0 }); n++;
      }
      return { new: n };
    }
    if (op === "formsync_claim") { const r = rows.find((x) => x.id === a.id); if (r && ["pending_delivery", "failed"].includes(r.status) && !r.lock) { r.lock = "L"; return { lock: "L" }; } return { lock: null }; }
    if (op === "formsync_set") {
      const r = rows.find((x) => x.id === a.id);
      if (!r || ["matched", "delivered", "held"].includes(r.status)) return { ok: false };
      if ("lock" in a) { if (r.lock !== a.lock) return { ok: false }; r.lock = null; }
      for (const k of ["status", "ctm_activity_id", "delivery_ref", "posted_at", "qualification", "last_error", "next_attempt_at", "recovered"]) if (k in a) r[k] = a[k] === "" ? null : a[k];
      if (a.count_attempt) r.attempts++;
      return { ok: true };
    }
    if (op === "formsync_qualify") { const r = rows.find((x) => x.id === a.id); r.qualification = a.qualification; r.ctm_tag = a.ctm_tag || null; return { ok: true }; }
    throw new Error("op " + op);
  };
  const deps: Deps = {
    call, live: opts.live ?? true, now: () => now,
    ghlList: async (f, t) => ghl.filter((s) => Date.parse(s.createdAt) >= f.getTime() && Date.parse(s.createdAt) <= t.getTime()),
    ctmList: async () => ctm.map((x) => ({ ...x })),
    ctmGet: async (id) => { const x = ctm.find((c) => c.id === id); return x ? { tag: x.tag ?? null, created_iso: x.called_at_iso } : null; },
    ctmPost: async (p): Promise<PostResult> => {
      posts.push(p);
      if (postMode === "fail500") return { kind: "ambiguous", error: "status 500" };
      const id = `CTM${seq++}`, ref = `tb-${id}`;
      ctm.push({ id, called_at_iso: now.toISOString(), form_id: "238140", contact_id: p.custom_field_ghl_contact_id, submitted_at: p.custom_submitted_at, message: p.custom_how_can_we_help_your_dog, submission_id: p.custom_ghl_submission_id, trackback_id: ref, tag: null });
      if (postMode === "timeout_but_created") return { kind: "ambiguous", error: "no response (TimeoutError)" };
      return { kind: "accepted", ref };
    },
  };
  const sub = (id: string, contact: string, at: string, form: string, msg: string): GhlSubmission =>
    ({ id, contactId: contact, formId: form, name: "Test Person", createdAt: at, others: { email: "t@example.com", phone: "2145550000", first_name: "Test", last_name: "Person", [MSGKEY]: msg, eventData: { url_params: { gclid: "GCLID123", gad_campaignid: "24360945481" } } } });
  const wp = (id: string, s: GhlSubmission) => ctm.push({ id, called_at_iso: s.createdAt, form_id: "238140", contact_id: s.contactId!, submitted_at: s.createdAt, message: String(s.others![MSGKEY]), submission_id: null, trackback_id: null, tag: "good lead" });
  return { deps, cfg, safety, rows, ghl, ctm, posts, sub, wp, setNow: (t: string) => { now = new Date(t); }, setPost: (m: typeof postMode) => { postMode = m; } };
}

Deno.test("1. new PPC submission delivered by WordPress is matched, never re-sent", async () => {
  const w = world(); const s = w.sub("g1", "c1", "2026-10-15T18:00:00Z", PPC, "My dog pulls on the leash"); w.ghl.push(s); w.wp("W1", s);
  await runLocation(w.deps, "p"); await runLocation(w.deps, "p");
  assertEquals(w.rows[0].status, "matched"); assertEquals(w.rows[0].ctm_activity_id, "W1"); assertEquals(w.posts.length, 0);
});

Deno.test("2. new organic submission delivered by WordPress is matched, never re-sent", async () => {
  const w = world(); const s = w.sub("g2", "c2", "2026-10-15T18:10:00Z", ORG, "Puppy training please"); w.ghl.push(s); w.wp("W2", s);
  await runLocation(w.deps, "p");
  assertEquals(w.rows[0].status, "matched"); assertEquals(w.posts.length, 0);
});

Deno.test("3. submission missing from CTM waits out the grace period, then is recovered exactly once", async () => {
  const w = world({ now: "2026-10-15T18:05:00Z" }); const s = w.sub("g3", "c3", "2026-10-15T18:00:00Z", PPC, "Aggressive with other dogs"); w.ghl.push(s);
  await runLocation(w.deps, "p");
  assertEquals(w.posts.length, 0); assertEquals(w.rows[0].status, "pending_delivery"); // inside 15-min grace
  w.setNow("2026-10-15T18:16:00Z"); await runLocation(w.deps, "p");
  assertEquals(w.posts.length, 1); assertEquals(w.rows[0].status, "delivered"); assertEquals(w.rows[0].recovered, true);
  const p = w.posts[0];
  assertEquals([p.custom_form_name, p.custom_form_source, p.custom_ghl_submission_id, p.custom_submitted_at, p.custom_gclid, p.custom_how_can_we_help_your_dog],
    ["New Client Form", "ppc", "g3", "2026-10-15T18:00:00Z", "GCLID123", "Aggressive with other dogs"]);
  assertEquals("visitor_sid" in p, false);
  w.setNow("2026-10-15T18:30:00Z"); await runLocation(w.deps, "p"); await runLocation(w.deps, "p");
  assertEquals(w.posts.length, 1);
  // AskAI never tagged it -> dashboard flag only; no tag written.
  assertEquals(w.rows[0].qualification, "needs_qualification"); assertEquals(w.ctm[0].tag, null);
  w.ctm[0].tag = "good lead"; await runLocation(w.deps, "p");
  assertEquals(w.rows[0].qualification, "classified"); assertEquals(w.rows[0].ctm_tag, "good lead");
});

Deno.test("4. two legitimate submissions from the same contact: WordPress sent one, only the other is recovered", async () => {
  const w = world();
  const a = w.sub("g4a", "c4", "2026-10-15T18:00:00Z", PPC, "First question"); const b = w.sub("g4b", "c4", "2026-10-15T18:20:00Z", PPC, "Second, different question");
  w.ghl.push(a, b); w.wp("W4", a);
  await runLocation(w.deps, "p");
  const ra = w.rows.find((r) => r.ghl_submission_id === "g4a"), rb = w.rows.find((r) => r.ghl_submission_id === "g4b");
  assertEquals(ra.status, "matched"); assertEquals(rb.status, "delivered"); assertEquals(w.posts.length, 1); assertEquals(w.posts[0].custom_ghl_submission_id, "g4b");
});

Deno.test("5. temporary CTM failure: no duplicate, verified before retry, delivered once CTM recovers", async () => {
  const w = world(); const s = w.sub("g5", "c5", "2026-10-15T18:00:00Z", PPC, "Help with barking"); w.ghl.push(s);
  w.setPost("fail500"); await runLocation(w.deps, "p");
  assertEquals(w.rows[0].status, "pending_verification"); assertEquals(w.posts.length, 1);
  w.setPost("ok"); w.setNow("2026-10-15T19:05:00Z"); await runLocation(w.deps, "p");
  assertEquals(w.posts.length, 1); // still inside verification window: no retry
  w.setNow("2026-10-15T19:20:00Z"); await runLocation(w.deps, "p");
  assertEquals(w.posts.length, 2); assertEquals(w.rows[0].status, "delivered"); assertEquals(w.ctm.length, 1);
});

Deno.test("6. ambiguous response where CTM actually created the activity: reconciled, never re-posted", async () => {
  const w = world(); const s = w.sub("g6", "c6", "2026-10-15T18:00:00Z", PPC, "Leash reactive"); w.ghl.push(s);
  w.setPost("timeout_but_created"); await runLocation(w.deps, "p");
  // Immediate re-check finds it by submission ID on the next run.
  w.setPost("ok"); w.setNow("2026-10-15T19:30:00Z"); await runLocation(w.deps, "p");
  assertEquals(w.posts.length, 1); assertEquals(w.ctm.length, 1); assertEquals(w.rows[0].status, "delivered");
});

Deno.test("historical and ambiguous: pre-activation submissions stay held; unclear matches go to review", async () => {
  const w = world();
  w.ghl.push(w.sub("old", "c7", "2026-10-15T16:30:00Z", PPC, "Before activation"));
  const s = w.sub("g8", "c8", "2026-10-15T18:00:00Z", PPC, "Text differs");
  w.ghl.push(s);
  w.ctm.push({ id: "W8a", called_at_iso: "2026-10-15T18:01:00Z", form_id: "238140", contact_id: "c8", submitted_at: "2026-10-15T18:01:00Z", message: "x", submission_id: null, trackback_id: null, tag: null });
  w.ctm.push({ id: "W8b", called_at_iso: "2026-10-15T18:02:00Z", form_id: "238140", contact_id: "c8", submitted_at: "2026-10-15T18:02:00Z", message: "y", submission_id: null, trackback_id: null, tag: null });
  await runLocation(w.deps, "p", { from: "2026-10-15T16:00:00Z" });
  assertEquals(w.rows.find((r) => r.ghl_submission_id === "old").status, "held");
  assertEquals(w.rows.find((r) => r.ghl_submission_id === "g8").status, "needs_review");
  assertEquals(w.posts.length, 0);
});

Deno.test("never merges different submission IDs; delivery off means no posts", async () => {
  const w = world({ live: false }); const s = w.sub("g9", "c9", "2026-10-15T18:00:00Z", PPC, "Same text");
  w.ghl.push(s);
  w.ctm.push({ id: "X", called_at_iso: s.createdAt, form_id: "238140", contact_id: "c9", submitted_at: s.createdAt, message: "Same text", submission_id: "OTHER", trackback_id: null, tag: null });
  await runLocation(w.deps, "p");
  assertEquals(w.rows[0].status, "pending_delivery"); assertEquals(w.posts.length, 0);
});

const NC = "a5f7eeea-dfe6-4ec2-a9eb-895d99c0c465";
Deno.test("NorCal missing GHL inquiry is held for review and never posted", async () => {
  const w = world(); w.cfg.production_watch_limit = 5;
  w.ghl.push(w.sub("n1", "c1", "2026-10-15T18:00:00Z", PPC, ""));
  await runLocation(w.deps, NC);
  assertEquals(w.rows[0].status, "needs_review"); assertEquals(w.posts.length, 0);
});
Deno.test("NorCal ambiguous recovery immediately disables sending and never retries", async () => {
  const w = world(); w.cfg.production_watch_limit = 5;
  w.ghl.push(w.sub("n2", "c2", "2026-10-15T18:00:00Z", PPC, "Inquiry")); w.setPost("fail500");
  try { await runLocation(w.deps, NC); } catch { /* expected pause */ }
  assertEquals(w.posts.length, 1); assertEquals(w.safety.length, 1);
  w.setNow("2026-10-15T19:20:00Z");
  try { await runLocation(w.deps, NC); } catch { /* verify, no retry */ }
  assertEquals(w.posts.length, 1);
});
Deno.test("NorCal Good Lead tag with no proven AskAI remains needs qualification", async () => {
  const w = world(); w.cfg.production_watch_limit = 5;
  const s = w.sub("n3", "c3", "2026-10-15T18:00:00Z", PPC, "Inquiry"); w.ghl.push(s); w.wp("a", s);
  await runLocation(w.deps, NC);
  assertEquals(w.rows[0].qualification, "needs_qualification"); assertEquals(w.posts.length, 0);
});
Deno.test("NorCal fresh pre-send check applies composite matching and prevents late website duplicate", async () => {
  const w = world(); w.cfg.production_watch_limit = 5; w.cfg.composite_match = true;
  const s = w.sub("n4", "c4", "2026-10-15T18:00:00Z", PPC, "Inquiry"); w.ghl.push(s);
  let reads = 0;
  w.deps.ctmList = async () => ++reads === 1 ? [] : [{ id: "late", called_at_iso: s.createdAt, form_id: "238140", contact_id: "c4", submitted_at: s.createdAt, message: null, custom: { form_source: "ppc" } }];
  await runLocation(w.deps, NC);
  assertEquals(w.rows[0].status, "matched"); assertEquals(w.posts.length, 0);
});
Deno.test("NorCal duplicated submission IDs immediately pause sending", async () => {
  const w = world(); w.cfg.production_watch_limit = 5;
  const s = w.sub("n5", "c5", "2026-10-15T18:00:00Z", PPC, "Inquiry"); w.ghl.push(s);
  w.wp("a", s); w.wp("b", s); w.ctm.forEach(a => a.submission_id = "n5");
  try { await runLocation(w.deps, NC); } catch { /* pause */ }
  assertEquals(w.safety.length, 1); assertEquals(w.posts.length, 0);
});
