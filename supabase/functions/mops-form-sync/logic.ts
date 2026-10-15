// Pure helpers for GHL -> CTM Form Sync. No network, no secrets.

export interface GhlSubmission {
  id: string; contactId?: string; formId?: string; name?: string; email?: string; createdAt: string;
  others?: Record<string, unknown>;
}
export interface CtmActivity { id: string; called_at_iso: string; form_id: string | null; contact_id: string | null; submitted_at: string | null; message: string | null }

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

export function attributionOf(s: GhlSubmission) {
  const o = s.others ?? {};
  const ev = (o.eventData ?? {}) as Record<string, any>;
  const up = (ev.url_params ?? {}) as Record<string, string>;
  return {
    gclid: up.gclid ?? null, gbraid: up.gbraid ?? null, wbraid: up.wbraid ?? null,
    gad_campaignid: up.gad_campaignid ?? null, gad_source: up.gad_source ?? null,
    utm_source: up.utm_source ?? null, utm_medium: up.utm_medium ?? null, utm_campaign: up.utm_campaign ?? null,
    landing_page: ev.page?.url ?? null, referrer: ev.referrer ?? null,
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
  acts: (CtmActivity & { message_hash: string | null })[],
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

export function buildCtmPayload(s: GhlSubmission, messageKey: string | null, messageField: string) {
  const o = s.others ?? {};
  const a = attributionOf(s);
  const first = String(o.first_name ?? ""); const last = String(o.last_name ?? "");
  return {
    caller_name: `${first} ${last}`.trim() || s.name || "",
    email: String(o.email ?? s.email ?? ""),
    phone_number: String(o.phone ?? ""),
    country_code: "1",
    [`custom_${messageField}`]: messageKey ? String(o[messageKey] ?? "") : "",
    custom_form_name: "GHL Form Sync",
    custom_field_ghl_contact_id: s.contactId ?? "",
    custom_ghl_submission_id: s.id,
    custom_submitted_at: s.createdAt,
    custom_ft_landing_page: a.landing_page ?? "",
    custom_gclid: a.gclid ?? "",
    custom_gad_campaignid: a.gad_campaignid ?? "",
  };
}

/** Masked copy for display in the dry-run report. */
export function maskPayload(p: Record<string, string>, messageField: string) {
  return { ...p, caller_name: maskName(p.caller_name), email: maskEmail(p.email), phone_number: maskPhone(p.phone_number),
    [`custom_${messageField}`]: p[`custom_${messageField}`] ? `[${p[`custom_${messageField}`].length} characters, hidden]` : "" };
}
