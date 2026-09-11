// Server-side mirror of the questionnaire rules. The browser runs the full
// schema in src/lib/onboarding/schema.ts; this re-checks the parts that matter
// for data integrity so a crafted request can never store junk.

export type Answers = Record<string, unknown>;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Required keys per required section, with minimum text length where it applies. */
const REQUIRED: Record<string, Array<{ key: string; minChars?: number; minItems?: number }>> = {
  basics: [
    { key: "business_name" },
    { key: "street_address" },
    { key: "city" },
    { key: "state" },
    { key: "postal_code" },
    { key: "public_phone" },
    { key: "website_url" },
    { key: "usp", minChars: 200 },
    { key: "proof_points", minItems: 3 },
    { key: "guarantee_text", minChars: 40 },
  ],
  hours: [{ key: "business_hours" }, { key: "after_hours_handling" }],
  territory: [{ key: "territory_confirm" }, { key: "service_areas", minItems: 1 }, { key: "travel_radius_miles" }],
  services: [{ key: "programs", minItems: 3 }],
  market: [
    { key: "competitors", minItems: 3 },
    { key: "ideal_client", minChars: 150 },
    { key: "problem_ranking", minItems: 8 },
    { key: "seasonality", minChars: 60 },
  ],
  accounts: [
    { key: "has_google_ads" },
    { key: "has_ga4" },
    { key: "has_gtm" },
    { key: "gbp_access_owner" },
    { key: "has_call_tracking" },
    { key: "has_crm" },
    { key: "website_platform" },
    { key: "website_access_ack" },
    { key: "access_contact" },
  ],
  leads: [
    { key: "phone_answerers", minItems: 1 },
    { key: "response_target_minutes" },
    { key: "followup_process", minChars: 200 },
    { key: "booking_method", minItems: 1 },
    { key: "call_scoring_ack" },
    { key: "disqualifiers", minChars: 80 },
  ],
  budget: [
    { key: "budget_confirm" },
    { key: "target_cpl" },
    { key: "target_clients_per_month" },
    { key: "avg_client_value" },
    { key: "close_rate" },
    { key: "capacity_limit" },
    { key: "growth_goal", minChars: 120 },
  ],
};

const blank = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0) || v === false;

export function normalize(answers: Answers): Answers {
  const a = { ...answers };
  if (typeof a.google_ads_cid === "string") a.google_ads_cid = a.google_ads_cid.replace(/\D/g, "");
  for (const k of ["public_phone", "respondent_phone"]) {
    if (typeof a[k] === "string") {
      const d = (a[k] as string).replace(/\D/g, "");
      a[k] = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
    }
  }
  if (typeof a.state === "string") a.state = (a.state as string).trim().toUpperCase().slice(0, 2);
  return a;
}

/** Format-level checks that run on every save. */
export function formatErrors(a: Answers): string[] {
  const errs: string[] = [];
  const cid = typeof a.google_ads_cid === "string" ? a.google_ads_cid.replace(/\D/g, "") : "";
  if (a.has_google_ads === "Yes" && cid && cid.length !== 10) errs.push("Google Ads customer ID must be 10 digits");
  if (a.ga4_id && !/^G-[A-Z0-9]{6,12}$/i.test(String(a.ga4_id).trim())) errs.push("Analytics measurement ID looks wrong");
  if (a.gtm_id && !/^GTM-[A-Z0-9]{5,9}$/i.test(String(a.gtm_id).trim())) errs.push("Tag Manager container ID looks wrong");
  if (a.respondent_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(a.respondent_email))) errs.push("Email address is not valid");
  for (const key of ["business_hours", "phone_hours"]) {
    const h = a[key] as Record<string, { closed?: boolean; open?: string; close?: string }> | undefined;
    if (!h) continue;
    for (const d of DAYS) {
      const row = h[d];
      if (!row || row.closed) continue;
      if (row.open && row.close && row.close <= row.open) errs.push(`${d}: closing time must be after opening time`);
    }
  }
  return errs;
}

/** Sections that are still incomplete. Empty array means the form can submit. */
export function incompleteSections(a: Answers): string[] {
  const out: string[] = [];
  for (const [section, fields] of Object.entries(REQUIRED)) {
    for (const f of fields) {
      const v = a[f.key];
      if (blank(v)) { out.push(section); break; }
      if (f.minChars && String(v).trim().length < f.minChars) { out.push(section); break; }
      if (f.minItems && (!Array.isArray(v) || v.length < f.minItems)) { out.push(section); break; }
    }
  }
  return out;
}

export type Flag = { flag_type: string; severity: string; field_key?: string; detail: string };

/** Review notes raised automatically for staff. */
export function buildFlags(a: Answers, otherAreas: Array<{ label: string; areas: string[] }>): Flag[] {
  const flags: Flag[] = [];

  const mine = ((a.service_areas as string[]) ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const other of otherAreas) {
    const hits = other.areas.filter((x) => mine.includes(x.trim().toLowerCase()));
    if (hits.length) {
      flags.push({
        flag_type: "territory_overlap",
        severity: "high",
        field_key: "service_areas",
        detail: `Overlaps ${other.label}: ${hits.join(", ")}`,
      });
    }
  }

  const cpl = Number(a.target_cpl);
  const value = Number(a.avg_client_value);
  const close = Number(a.close_rate);
  if (Number.isFinite(cpl) && cpl > 0 && cpl < 40) {
    flags.push({ flag_type: "unrealistic_cpl", severity: "warning", field_key: "target_cpl", detail: `Target of $${cpl} per lead is well below what comparable locations achieve.` });
  }
  if (Number.isFinite(cpl) && Number.isFinite(value) && Number.isFinite(close) && close > 0) {
    const costPerClient = (cpl * 10) / close;
    if (costPerClient > value) {
      flags.push({
        flag_type: "unprofitable_targets",
        severity: "high",
        field_key: "target_cpl",
        detail: `At $${cpl} per lead and ${close} in 10 closing, a client costs about $${Math.round(costPerClient)} against a client value of $${value}.`,
      });
    }
  }

  const capacity = Number(a.capacity_limit);
  const wanted = Number(a.target_clients_per_month);
  if (Number.isFinite(capacity) && Number.isFinite(wanted) && wanted > capacity) {
    flags.push({ flag_type: "capacity_gap", severity: "warning", field_key: "capacity_limit", detail: `Wants ${wanted} clients a month but can only handle ${capacity}.` });
  }

  if (a.has_call_tracking === "Yes") {
    flags.push({ flag_type: "existing_call_tracking", severity: "warning", field_key: "call_tracking_vendor", detail: `Already running ${a.call_tracking_vendor ?? "another call tracking system"} — check for number conflicts before launch.` });
  }

  for (const k of ["has_google_ads", "has_ga4", "has_gtm", "has_call_tracking", "has_crm"]) {
    if (a[k] === "Not sure") flags.push({ flag_type: "unknown_account", severity: "info", field_key: k, detail: "Owner is not sure — needs an audit before launch." });
  }

  // Ads scheduled into hours nobody answers.
  const hours = (a.phone_answered_hours_match === false ? a.phone_hours : a.business_hours) as
    | Record<string, { closed?: boolean }>
    | undefined;
  if (hours && DAYS.every((d) => hours[d]?.closed) === false) {
    const closedDays = DAYS.filter((d) => hours[d]?.closed);
    if (closedDays.length >= 3) {
      flags.push({ flag_type: "coverage_gap", severity: "info", field_key: "business_hours", detail: `Phone unanswered on ${closedDays.join(", ")} — ad schedule should match.` });
    }
  }

  const offers = (a.offers as Array<{ text?: string; expires_on?: string }>) ?? [];
  for (const o of offers) {
    if (o?.expires_on && new Date(o.expires_on) < new Date()) {
      flags.push({ flag_type: "expired_offer", severity: "warning", field_key: "offers", detail: `Offer already expired: ${o.text ?? ""}` });
    }
  }

  if (!Array.isArray(a.trainer_list) || (a.trainer_list as unknown[]).length === 0) {
    flags.push({ flag_type: "partial_section", severity: "info", field_key: "trainer_list", detail: "Trainers section submitted empty — follow up for names and photos." });
  }

  return flags;
}
