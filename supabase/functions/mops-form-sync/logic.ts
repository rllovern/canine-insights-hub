// Pure helpers for GHL -> CTM Form Sync. No network, no secrets.

export interface GhlSubmission {
  id: string; contactId?: string; formId?: string; name?: string; email?: string; createdAt: string;
  others?: Record<string, unknown>;
}
export interface CtmActivity {
  id: string; called_at_iso: string; form_id: string | null; contact_id: string | null; submitted_at: string | null; message: string | null;
  /** custom ghl_submission_id, when the sender stored one (Form Sync always does; WordPress usually does not). */
  submission_id?: string | null;
  trackback_id?: string | null;
  tag?: string | null;
}
export type HashedActivity = CtmActivity & { message_hash: string | null };

export const maskName = (v?: string) => (v ? v.trim().split(/\s+/).map((p) => p.slice(0, 1) + "***").join(" ") : null);
export const maskEmail = (v?: string) => {
  if (!v || !v.includes("@")) return v ? "***" : null;
  const [u, d] = v.split("@"); return `${u.slice(0, 1)}***@${d}`;
};
export const maskPhone = (v?: string) => (v ? `***${String(v).replace(/\D/g, "").slice(-4)}` : null);

export async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const normMsg = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function urlParam(url: unknown, key: string): string | null {
  try { return url ? new URL(String(url)).searchParams.get(key) : null; } catch { return null; }
}

export function attributionOf(s: GhlSubmission) {
  const o = s.others ?? {};
  const ev = (o.eventData ?? {}) as Record<string, any>;
  const up = (ev.url_params ?? {}) as Record<string, string>;
  const page = ev.page?.url ?? null;
  const pick = (k: string) => up[k] ?? (ev as Record<string, string>)[k] ?? urlParam(page, k) ?? null;
  return {
    gclid: pick("gclid"), gbraid: pick("gbraid"), wbraid: pick("wbraid"),
    gad_campaignid: pick("gad_campaignid"), gad_source: pick("gad_source"),
    utm_source: pick("utm_source"), utm_medium: pick("utm_medium"), utm_campaign: pick("utm_campaign"), utm_term: pick("utm_term"),
    landing_page: page, referrer: ev.referrer ?? null,
    ghl_source: ev.source ?? null, ghl_ad_source: ev.adSource ?? null,
    // GHL's own session ID. Not a CTM visitor session — never sent as visitor_sid.
    ghl_session_id: (o.sessionId as string) ?? null,
    submitted_at: s.createdAt,
  };
}

export type Verdict = { status: "matched" | "needs_review" | "pending_delivery"; activity_id?: string; candidates: { id: string; score: number; reasons: string[] }[] };

/** Scores CTM activities against one submission. Never matches on phone/email alone. */
export function matchSubmission(
  sub: { contact_id: string | null; submitted_at: string; message_hash: string | null; form_numeric_id: string },
  acts: HashedActivity[],
  claimed: Set<string>,
): Verdict {
  const t0 = Date.parse(sub.submitted_at);
  const cands = acts.filter((a) => a.form_id === sub.form_numeric_id && !claimed.has(a.id)).map((a) => {
    const reasons: string[] = []; let score = 0;
    const ta = Date.parse(a.submitted_at ?? a.called_at_iso);
    const dt = Math.abs(ta - t0) / 60000;
    const contact = !!sub.contact_id && a.contact_id === sub.contact_id;
    const msg = !!sub.message_hash && a.message_hash === sub.message_hash;
    if (contact) { score += 3; reasons.push("same GHL contact"); }
    if (msg) { score += 3; reasons.push("same message"); }
    if (dt <= 2) { score += 3; reasons.push("within 2 min"); } else if (dt <= 10) { score += 2; reasons.push("within 10 min"); }
    return { id: a.id, score, reasons, contact, msg, dt };
  }).filter((c) => c.contact || c.msg).sort((a, b) => b.score - a.score);
  const out = cands.map(({ id, score, reasons }) => ({ id, score, reasons }));
  if (!cands.length) return { status: "pending_delivery", candidates: [] };
  const top = cands[0];
  const strong = (c: typeof top) => c.contact && c.dt <= 10 && (c.msg || !sub.message_hash);
  if (strong(top) && !(cands[1] && strong(cands[1]))) return { status: "matched", activity_id: top.id, candidates: out };
  return { status: "needs_review", candidates: out };
}

/**
 * Full duplicate check: exact GHL submission ID first, then the CTM receipt reference
 * from our own post, then contact + message + time scoring. Activities that carry a
 * DIFFERENT submission ID are never considered — two submissions are never merged
 * because they share a contact, email or phone.
 */
export function classify(
  sub: { ghl_submission_id: string; contact_id: string | null; submitted_at: string; message_hash: string | null; delivery_ref?: string | null },
  formNumericId: string,
  acts: HashedActivity[],
  claimed: Set<string>,
): Verdict & { via?: string } {
  const exact = acts.filter((a) => a.submission_id && a.submission_id === sub.ghl_submission_id);
  if (exact.length === 1) return { status: "matched", activity_id: exact[0].id, via: "submission_id", candidates: [{ id: exact[0].id, score: 10, reasons: ["same GHL submission ID"] }] };
  if (exact.length > 1) return { status: "needs_review", via: "submission_id", candidates: exact.map((a) => ({ id: a.id, score: 10, reasons: ["same GHL submission ID (more than one CTM activity)"] })) };
  if (sub.delivery_ref) {
    const ref = acts.find((a) => a.trackback_id && a.trackback_id === sub.delivery_ref);
    if (ref) return { status: "matched", activity_id: ref.id, via: "receipt", candidates: [{ id: ref.id, score: 10, reasons: ["CTM receipt reference from our delivery"] }] };
  }
  const pool = acts.filter((a) => !a.submission_id);
  return { ...matchSubmission({ contact_id: sub.contact_id, submitted_at: sub.submitted_at, message_hash: sub.message_hash, form_numeric_id: formNumericId }, pool, claimed), via: "score" };
}

export interface FormMapEntry { form_name: string; form_source: string; label?: string }

export function buildCtmPayload(s: GhlSubmission, messageKey: string | null, messageField: string, form: FormMapEntry) {
  const o = s.others ?? {};
  const a = attributionOf(s);
  const first = String(o.first_name ?? ""); const last = String(o.last_name ?? "");
  const out: Record<string, string> = {
    caller_name: `${first} ${last}`.trim() || s.name || "",
    email: String(o.email ?? s.email ?? "").trim().toLowerCase(),
    phone_number: String(o.phone ?? "").replace(/\D/g, "").slice(-10),
    country_code: "1",
    [`custom_${messageField}`]: messageKey ? String(o[messageKey] ?? "").trim() : "",
    custom_form_name: form.form_name,
    custom_form_source: form.form_source,
    custom_field_ghl_contact_id: s.contactId ?? "",
    custom_ghl_submission_id: s.id,
    custom_submitted_at: s.createdAt,
    custom_recovered_by: "Form Sync",
  };
  const opt: Record<string, string | null> = {
    custom_ft_landing_page: a.landing_page, custom_ft_referrer: a.referrer,
    custom_gclid: a.gclid, custom_gbraid: a.gbraid, custom_wbraid: a.wbraid,
    custom_gad_campaignid: a.gad_campaignid, custom_gad_source: a.gad_source,
    custom_utm_source: a.utm_source, custom_utm_medium: a.utm_medium, custom_utm_campaign: a.utm_campaign, custom_utm_term: a.utm_term,
  };
  for (const [k, v] of Object.entries(opt)) if (v) out[k] = String(v);
  // Deliberately no visitor_sid: GHL's session ID is not a CTM visitor ID.
  return out;
}

/** Masked copy for display. */
export function maskPayload(p: Record<string, string>, messageField: string) {
  return { ...p, caller_name: maskName(p.caller_name), email: maskEmail(p.email), phone_number: maskPhone(p.phone_number),
    ...(p.custom_gclid ? { custom_gclid: `${p.custom_gclid.slice(0, 6)}…` } : {}),
    [`custom_${messageField}`]: p[`custom_${messageField}`] ? `[${p[`custom_${messageField}`].length} characters, hidden]` : "" };
}

/** Retry spacing after a definite CTM rejection: 5, 10, 20, 40, 80 min… capped at 6 h. */
export const backoffMinutes = (attempt: number) => Math.min(360, 5 * 2 ** Math.max(0, attempt - 1));
