// Agency-wide Lead Reconciliation: pure helpers + injectable preflight. No secrets, no direct network.
import { classify, normMsg, sha256, type CtmActivity, type GhlSubmission, type HashedActivity } from "./logic.ts";

export const REPORTING_TAGS = ["Sale", "Good Lead", "Bad Lead", "Repeat Caller", "Misc", "Wrong Number", "SPAM / Dead Air / Hangup"];

const OPS = /(vaccin|waiver|upload|agreement|contract|release form|consent|liability|medical|vet record|payment|invoice|employ|job|hiring|career|survey|feedback|review request|testimonial|check.?in|pick.?up|drop.?off|internal|staff|onboarding packet)/i;
const INQ = /(contact|inquir|enquir|consult|evaluation|lead|new client|ppc|google ads|adwords|organic|website|yelp|facebook|boarding|training|quote|free|get started|request info)/i;

export type FormClass = "inquiry" | "operational" | "unclassified";

/** Name-based sorting. Anything not clearly one or the other stays unclassified (never guessed). */
export function classifyForm(name: string | null | undefined): { classification: FormClass; form_source: string | null } {
  const n = String(name ?? "");
  const ops = OPS.test(n), inq = INQ.test(n);
  const classification: FormClass = ops && !inq ? "operational" : inq && !ops ? "inquiry" : "unclassified";
  return { classification, form_source: classification === "inquiry" ? sourceOf(n) : null };
}

/** Source only when the form name states it. Otherwise null = unknown. */
export function sourceOf(name: string): string | null {
  if (/\b(ppc|google ads|adwords|gads)\b/i.test(name)) return "ppc";
  if (/\byelp\b/i.test(name)) return "yelp";
  if (/\b(facebook|meta|fb)\b/i.test(name)) return "facebook";
  if (/\b(organic|website)\b/i.test(name)) return "website";
  return null;
}

const STANDARD = new Set(["first_name", "last_name", "full_name", "name", "email", "phone", "eventData", "sessionId", "formId", "submissionId", "contactId",
  "address", "address1", "city", "state", "postal_code", "country", "terms_and_conditions", "signature", "date_of_birth", "company_name", "website", "source"]);

/** Picks the free-text question field. Returns null when no single field stands out. */
export function pickMessageKey(subs: GhlSubmission[]): { key: string | null; candidates: { key: string; share: number }[] } {
  if (!subs.length) return { key: null, candidates: [] };
  const hits = new Map<string, number>();
  for (const s of subs) for (const [k, v] of Object.entries(s.others ?? {})) {
    if (STANDARD.has(k) || typeof v !== "string") continue;
    if (v.trim().length >= 15 && /\s/.test(v.trim())) hits.set(k, (hits.get(k) ?? 0) + 1);
  }
  const candidates = [...hits.entries()].map(([key, n]) => ({ key, share: Math.round((n / subs.length) * 100) / 100 })).sort((a, b) => b.share - a.share);
  const [a, b] = candidates;
  const key = a && a.share >= 0.5 && (!b || b.share < a.share * 0.5) ? a.key : null;
  return { key, candidates: candidates.slice(0, 5) };
}

export interface Reactor { frt: string | null; numeric: string | null; name: string | null }
export type ActWithCustom = CtmActivity & { custom?: Record<string, string> };

export interface PreflightDeps {
  ghlForms: () => Promise<{ id: string; name: string }[]>;
  ghlSubs: (from: Date, to: Date) => Promise<GhlSubmission[]>;
  ctmReactors: () => Promise<Reactor[]>;
  ctmActs: (from: Date, to: Date, msgField: string) => Promise<ActWithCustom[]>;
  now: () => Date;
}
export interface Check { key: string; label: string; ok: boolean; hard: boolean; detail: string }

const DAY = 86400000;
const DEFAULT_MSG_FIELD = "how_can_we_help_your_dog";

export async function runPreflight(d: PreflightDeps, ctx: { ghl_status: string | null; ctm_status: string | null; has_ghl: boolean; has_ctm: boolean }) {
  const checks: Check[] = [];
  const add = (key: string, label: string, ok: boolean, hard: boolean, detail: string) => checks.push({ key, label, ok, hard, detail });
  const out = { passed: false, matching_verified: false, checks, reasons: [] as string[], forms: [] as any[], frt: null as string | null, form_numeric_id: null as string | null, message_field: null as string | null };
  const finish = () => {
    out.reasons = checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
    out.passed = checks.every((c) => c.ok || !c.hard);
    return out;
  };

  const connOk = ctx.has_ghl && ctx.has_ctm && ctx.ghl_status !== "paused" && ctx.ctm_status !== "paused";
  add("connections", "Saved GHL and CTM connections", connOk, true,
    connOk ? "Both present" : !ctx.has_ghl ? "GHL connection or token missing" : !ctx.has_ctm ? "CTM account missing" : "A connection is paused");
  if (!connOk) return finish();

  const now = d.now(), from = new Date(now.getTime() - 30 * DAY);
  let forms: { id: string; name: string }[] = [], subs: GhlSubmission[] = [];
  try { forms = await d.ghlForms(); add("ghl_forms", "GHL forms readable", true, true, `${forms.length} forms`); }
  catch (e) { add("ghl_forms", "GHL forms readable", false, true, (e as Error).message); return finish(); }
  try { subs = await d.ghlSubs(from, now); add("ghl_subs", "GHL submissions readable (all pages)", true, true, `${subs.length} in 30 days`); }
  catch (e) { add("ghl_subs", "GHL submissions readable (all pages)", false, true, (e as Error).message); return finish(); }

  const byForm = new Map<string, GhlSubmission[]>();
  for (const s of subs) if (s.formId) byForm.set(s.formId, [...(byForm.get(s.formId) ?? []), s]);
  out.forms = forms.map((f) => {
    const c = classifyForm(f.name); const fs = byForm.get(f.id) ?? []; const m = pickMessageKey(fs);
    return { id: f.id, name: f.name, classification: c.classification, form_source: c.form_source, message_key: m.key, message_key_candidates: m.candidates, submissions_30d: fs.length };
  });
  const inquiry = out.forms.filter((f) => f.classification === "inquiry");
  const unclassified = out.forms.filter((f) => f.classification === "unclassified" && f.submissions_30d > 0);
  add("forms_inquiry", "Customer-inquiry forms identified", inquiry.length > 0, true, inquiry.length ? inquiry.map((f) => f.name).join(", ") : "No form could be confidently identified as a customer inquiry");
  add("forms_unclassified", "Active forms needing classification", unclassified.length === 0, false, unclassified.length ? `${unclassified.length} active form(s) need your review: ${unclassified.map((f) => f.name).join(", ")}` : "None");
  const unknownSrc = inquiry.filter((f) => !f.form_source);
  add("forms_source", "Inquiry form sources known", unknownSrc.length === 0, false, unknownSrc.length ? `Source unknown for: ${unknownSrc.map((f) => f.name).join(", ")}` : "All known");

  let reactors: Reactor[] = [];
  try { reactors = await d.ctmReactors(); }
  catch (e) { add("ctm_reactors", "CTM FormReactors readable", false, true, (e as Error).message); return finish(); }
  let acts: ActWithCustom[] = [];
  try { acts = await d.ctmActs(from, now, DEFAULT_MSG_FIELD); add("ctm_acts", "CTM activities readable (all pages)", true, true, `${acts.length} activities in 30 days`); }
  catch (e) { add("ctm_acts", "CTM activities readable (all pages)", false, true, (e as Error).message); return finish(); }

  const formActs = acts.filter((a) => a.form_id);
  const formIds = [...new Set(formActs.map((a) => a.form_id as string))];
  let reactor: Reactor | null = null;
  if (reactors.length === 1) reactor = reactors[0];
  else if (reactors.length > 1 && formIds.length === 1) reactor = reactors.find((r) => r.numeric === formIds[0]) ?? null;
  const numeric = reactor?.numeric ?? (reactor && formIds.length === 1 ? formIds[0] : null);
  const reactorOk = !!reactor?.frt && !!numeric;
  add("ctm_reactor", "This location's own CTM FormReactor", reactorOk, true,
    reactorOk ? `${reactor!.name ?? "FormReactor"} (${numeric})` : reactors.length === 0 ? "No FormReactor found in this location's CTM account"
      : reactors.length > 1 ? `${reactors.length} FormReactors found; cannot tell which receives website leads` : "FormReactor found but its identifiers could not be read");
  if (!reactorOk) return finish();
  out.frt = reactor!.frt; out.form_numeric_id = numeric;

  // CTM message field: keep the agency default when present, otherwise detect a single long-text field.
  const onForm = formActs.filter((a) => a.form_id === numeric);
  const keyHits = new Map<string, number>();
  for (const a of onForm) for (const [k, v] of Object.entries(a.custom ?? {})) if (typeof v === "string" && v.trim().length >= 15 && /\s/.test(v)) keyHits.set(k, (keyHits.get(k) ?? 0) + 1);
  const ranked = [...keyHits.entries()].sort((a, b) => b[1] - a[1]);
  const msgField = keyHits.has(DEFAULT_MSG_FIELD) ? DEFAULT_MSG_FIELD : ranked[0]?.[0] ?? null;
  out.message_field = msgField;
  add("ctm_message_field", "CTM message field identified", !!msgField, true, msgField ?? "No free-text field found on recent CTM form activities");
  if (!msgField) return finish();

  // Matching rehearsal (read-only): recent inquiry submissions vs existing CTM form activities.
  const reAct = msgField === DEFAULT_MSG_FIELD ? onForm : onForm.map((a) => ({ ...a, message: a.custom?.[msgField] ?? null }));
  const hashed: HashedActivity[] = await Promise.all(reAct.map(async (a) => ({ ...a, message_hash: a.message ? await sha256(normMsg(a.message)) : null })));
  const inquiryIds = new Map(inquiry.map((f) => [f.id, f]));
  const sample = subs.filter((s) => s.formId && inquiryIds.has(s.formId) && Date.parse(s.createdAt) < now.getTime() - 30 * 60000);
  const claimed = new Set<string>(); let matched = 0, review = 0; const tagged: string[] = [];
  for (const s of sample) {
    const key = inquiryIds.get(s.formId!)!.message_key;
    const msg = key ? (s.others ?? {})[key] : null;
    const v = classify({ ghl_submission_id: s.id, contact_id: s.contactId ?? null, submitted_at: s.createdAt, message_hash: msg ? await sha256(normMsg(msg)) : null }, numeric!, hashed, claimed);
    if (v.status === "matched" && v.activity_id) { matched++; claimed.add(v.activity_id); const t = hashed.find((a) => a.id === v.activity_id)?.tag; if (t) tagged.push(t); }
    else if (v.status === "needs_review") review++;
  }
  const rate = sample.length ? matched / sample.length : 0;
  out.matching_verified = sample.length >= 3 && rate >= 0.8;
  add("matching", "Matching against website-delivered leads", out.matching_verified, false,
    sample.length < 3 ? `Only ${sample.length} recent inquiry submission(s); not enough to verify matching` : `${matched} of ${sample.length} matched (${Math.round(rate * 100)}%), ${review} ambiguous`);
  const known = tagged.filter((t) => REPORTING_TAGS.includes(t)).length;
  add("qualification", "Existing AskAI tagging observed", matched > 0 && known / matched >= 0.5, false, matched ? `${known} of ${matched} matched leads carry one of the seven reporting tags` : "No matched leads to observe");
  add("live_validation", "Server delivery validated for this location", false, false, "Not yet tested live. Monitoring only until you approve live sending.");
  return finish();
}
