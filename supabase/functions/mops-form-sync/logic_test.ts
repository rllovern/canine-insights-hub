import { assertEquals } from "jsr:@std/assert@1";
import { maskEmail, maskPhone, matchSubmission } from "./logic.ts";

const act = (id: string, contact: string | null, at: string, hash: string | null) => ({ id, called_at_iso: at, form_id: "238140", contact_id: contact, submitted_at: at, message: null, message_hash: hash });
const sub = (contact: string, at: string, hash: string | null) => ({ contact_id: contact, submitted_at: at, message_hash: hash, form_numeric_id: "238140" });

Deno.test("same contact submitting twice minutes apart: each finds only its own activity", () => {
  const acts = [act("A1", "c1", "2026-10-14T18:00:00Z", "h1"), act("A2", "c1", "2026-10-14T18:06:00Z", "h2")];
  const claimed = new Set<string>();
  const v1 = matchSubmission(sub("c1", "2026-10-14T18:00:10Z", "h1"), acts, claimed);
  assertEquals(v1.status, "matched"); assertEquals(v1.activity_id, "A1"); claimed.add("A1");
  const v2 = matchSubmission(sub("c1", "2026-10-14T18:06:05Z", "h2"), acts, claimed);
  assertEquals(v2.activity_id, "A2");
});
Deno.test("second submission with no CTM activity is not suppressed", () => {
  const v = matchSubmission(sub("c1", "2026-10-14T18:30:00Z", "h3"), [act("A1", "c1", "2026-10-14T18:00:00Z", "h1")], new Set(["A1"]));
  assertEquals(v.status, "pending_delivery");
});
Deno.test("contact match but far apart in time goes to review", () => {
  const v = matchSubmission(sub("c1", "2026-10-14T20:00:00Z", "h9"), [act("A1", "c1", "2026-10-14T18:00:00Z", "h1")], new Set());
  assertEquals(v.status, "needs_review");
});
Deno.test("two equally strong candidates go to review", () => {
  const v = matchSubmission(sub("c1", "2026-10-14T18:00:00Z", null), [act("A1", "c1", "2026-10-14T18:01:00Z", null), act("A2", "c1", "2026-10-14T18:02:00Z", null)], new Set());
  assertEquals(v.status, "needs_review");
});
Deno.test("phone/email never used; masking hides contact details", () => {
  assertEquals(maskEmail("gigi@example.com"), "g***@example.com");
  assertEquals(maskPhone("+1 (214) 555-1234"), "***1234");
});
