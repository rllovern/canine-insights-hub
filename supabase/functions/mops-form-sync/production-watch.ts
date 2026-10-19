import { normMsg, type CtmActivity, type GhlSubmission } from "./logic.ts";

export const NORCAL = "a5f7eeea-dfe6-4ec2-a9eb-895d99c0c465";

/** Conservative evidence only; an existing tag is not evidence of AskAI provenance. */
export function productionEvidence(sub: GhlSubmission, messageKey: string, source: string, formId: string, acts: CtmActivity[]) {
  const inquiry = String(sub.others?.[messageKey] ?? "");
  const candidates = acts.filter((a) => {
    if (a.submission_id) return a.submission_id === sub.id;
    if (a.form_id !== formId || !sub.contactId || a.contact_id !== sub.contactId) return false;
    const within = Math.abs(Date.parse(a.submitted_at ?? a.called_at_iso) - Date.parse(sub.createdAt)) <= 120000;
    const sameSource = String(a.custom?.form_source ?? "").toLowerCase() === source.toLowerCase();
    return within && sameSource && (!normMsg(a.message) || normMsg(a.message) === normMsg(inquiry));
  });
  return { activity_ids: candidates.map((a) => a.id), activity_count: candidates.length,
    inquiry_present: !!normMsg(inquiry), inquiry_complete: candidates.length === 1 && !!normMsg(inquiry) && String(candidates[0].message ?? "").trim() === inquiry.trim() };
}