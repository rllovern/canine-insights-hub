import { assertEquals } from "jsr:@std/assert@1";
import { productionEvidence } from "./production-watch.ts";
import type { CtmActivity, GhlSubmission } from "./logic.ts";
const s: GhlSubmission = { id: "s", contactId: "c", createdAt: "2026-10-19T22:30:00Z", others: { inquiry: "Full dog training question" } };
const a: CtmActivity = { id: "a", form_id: "238734", contact_id: "c", called_at_iso: "2026-10-19T22:31:00Z", submitted_at: null, message: "Full dog training question", custom: { form_source: "ppc" } };
const evidence = (acts: CtmActivity[], sub = s) => productionEvidence(sub, "inquiry", "ppc", "238734", acts);
Deno.test("NorCal watch requires correct contact, source and at most two minutes", () => {
  assertEquals(evidence([a]).activity_count, 1);
  assertEquals(evidence([{ ...a, contact_id: "other" }]).activity_count, 0);
  assertEquals(evidence([{ ...a, custom: { form_source: "website" } }]).activity_count, 0);
  assertEquals(evidence([{ ...a, called_at_iso: "2026-10-19T22:32:01Z" }]).activity_count, 0);
});
Deno.test("NorCal conflicting messages never match and truncated inquiry is not complete", () => {
  assertEquals(evidence([{ ...a, message: "Different question" }]).activity_count, 0);
  assertEquals(evidence([{ ...a, submission_id: "s", message: "Full dog" }]).inquiry_complete, false);
});
Deno.test("NorCal first-five watch detects multiple activities including exact submission IDs", () => {
  assertEquals(evidence([a, { ...a, id: "b" }]).activity_count, 2);
  assertEquals(evidence([{ ...a, submission_id: "s" }, { ...a, id: "b", submission_id: "s" }]).activity_count, 2);
});
Deno.test("NorCal empty inquiry is never confirmed complete despite an existing Good Lead tag", () => {
  const r = evidence([{ ...a, message: "", tag: "Good Lead" }], { ...s, others: { inquiry: "" } });
  assertEquals(r.inquiry_present, false); assertEquals(r.inquiry_complete, false);
});