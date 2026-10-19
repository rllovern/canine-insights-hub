import { assertEquals } from "jsr:@std/assert@1";
import { classify, type HashedActivity } from "./logic.ts";
const act = (id: string, t: string, o: Partial<HashedActivity> = {}): HashedActivity => ({ id, called_at_iso: t, submitted_at: t, form_id: "238734", contact_id: "c1", message: null, message_hash: null, custom: { form_source: "website" }, ...o });
const sub = { ghl_submission_id: "s1", contact_id: "c1", submitted_at: "2026-10-19T20:11:57Z", message_hash: "h", form_source: "website" };
Deno.test("composite off: empty CTM message stays in review", () => {
  assertEquals(classify(sub, "238734", [act("a", "2026-10-19T20:11:58Z")], new Set()).status, "needs_review");
});
Deno.test("composite on: same contact+source within 2 min matches", () => {
  const v = classify(sub, "238734", [act("a", "2026-10-19T20:11:58Z")], new Set(), { composite: true });
  assertEquals([v.status, v.activity_id], ["matched", "a"]);
});
Deno.test("composite never accepts a different message", () => {
  assertEquals(classify(sub, "238734", [act("a", "2026-10-19T20:11:58Z", { message: "x", message_hash: "other" })], new Set(), { composite: true }).status, "needs_review");
});
Deno.test("composite rejects other source or >2 min", () => {
  assertEquals(classify(sub, "238734", [act("a", "2026-10-19T20:11:58Z", { custom: { form_source: "ppc" } })], new Set(), { composite: true }).status, "needs_review");
  assertEquals(classify(sub, "238734", [act("a", "2026-10-19T20:16:00Z")], new Set(), { composite: true }).status, "needs_review");
});
Deno.test("two composite candidates are held for review", () => {
  assertEquals(classify(sub, "238734", [act("a", "2026-10-19T20:11:58Z"), act("b", "2026-10-19T20:12:30Z")], new Set(), { composite: true }).status, "needs_review");
});
Deno.test("phone/email alone never match (no contact)", () => {
  assertEquals(classify(sub, "238734", [act("a", "2026-10-19T20:11:58Z", { contact_id: null })], new Set(), { composite: true }).status, "pending_delivery");
});
