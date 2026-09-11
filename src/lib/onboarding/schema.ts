/**
 * Single source of truth for the location onboarding questionnaire.
 * Used by the public form, the review screen, the admin detail view and the
 * PDF / CSV / JSON exports, so a field only ever has to be described once.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "url"
  | "date"
  | "number"
  | "currency"
  | "select"
  | "radio"
  | "multiselect"
  | "boolean"
  | "confirm"
  | "hours"
  | "geolist"
  | "rank"
  | "repeatable";

export type Answers = Record<string, unknown>;

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
  /** Minimum characters for text / textarea answers. */
  minChars?: number;
  maxChars?: number;
  min?: number;
  max?: number;
  /** Repeatable / multiselect / geolist bounds. */
  minItems?: number;
  maxItems?: number;
  itemFields?: FieldDef[];
  itemLabel?: string;
  /** Only ask this when the predicate passes. */
  showIf?: (a: Answers) => boolean;
  /** Prefilled from the location record — shown read-only with a confirm tick. */
  prefillKey?: string;
}

export interface SectionDef {
  key: string;
  title: string;
  blurb?: string;
  estMinutes: number;
  /** Section must be complete before the questionnaire can be submitted. */
  required: boolean;
  fields: FieldDef[];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const HOUR_DAYS = DAYS;

const yes = (a: Answers, k: string) => a[k] === true || a[k] === "Yes";

export const SECTIONS: SectionDef[] = [
  {
    key: "start",
    title: "Start here",
    blurb:
      "This replaces the old business information spreadsheet. Most people finish in about 45 minutes, and it saves as you go — you can close this page and come back to the same link at any time.",
    estMinutes: 2,
    required: false,
    fields: [
      { key: "respondent_name", label: "Your name", type: "text", required: true, maxChars: 120 },
      { key: "respondent_role", label: "Your role at this location", type: "text", required: true, maxChars: 120 },
      { key: "respondent_email", label: "Best email for us", type: "email", required: true },
      { key: "respondent_phone", label: "Best phone number", type: "tel", required: true },
      {
        key: "confirm_location",
        label: "This is the correct location",
        type: "confirm",
        required: true,
        prefillKey: "location_label",
      },
    ],
  },
  {
    key: "basics",
    title: "Location basics",
    estMinutes: 5,
    required: true,
    fields: [
      { key: "business_name", label: "Business name exactly as it should appear in ads", type: "text", required: true, maxChars: 120 },
      { key: "street_address", label: "Street address", type: "text", required: true, help: "The address on your Google Business Profile." },
      { key: "city", label: "City", type: "text", required: true },
      { key: "state", label: "State", type: "text", required: true, maxChars: 2, placeholder: "OH" },
      { key: "postal_code", label: "ZIP code", type: "text", required: true },
      { key: "public_phone", label: "Public phone number", type: "tel", required: true, help: "The number customers see today. We will add call tracking on top of it, not replace it." },
      { key: "website_url", label: "Website address", type: "url", required: true },
      { key: "gbp_url", label: "Google Business Profile link", type: "url", required: false },
      {
        key: "usp",
        label: "What makes this location the obvious choice over any other trainer nearby?",
        type: "textarea",
        required: true,
        minChars: 200,
        help: "Write it the way you would say it to a customer on the phone. At least 200 characters.",
      },
      {
        key: "proof_points",
        label: "Proof points we can use in ads",
        type: "repeatable",
        required: true,
        minItems: 3,
        itemLabel: "Proof point",
        itemFields: [{ key: "text", label: "Proof point", type: "text", required: true, minChars: 15 }],
        help: "Numbers, awards, years in business, dogs trained, named results.",
      },
      {
        key: "guarantee_text",
        label: "Your guarantee, word for word",
        type: "textarea",
        required: true,
        minChars: 40,
        help: "This is used verbatim in ads and on landing pages, so it must be exactly what you stand behind.",
      },
    ],
  },
  {
    key: "hours",
    title: "Hours",
    blurb: "Ads only run when someone can answer. Tell us when that is.",
    estMinutes: 4,
    required: true,
    fields: [
      { key: "business_hours", label: "Business hours", type: "hours", required: true },
      {
        key: "phone_answered_hours_match",
        label: "Is the phone answered during exactly those hours?",
        type: "boolean",
        required: true,
      },
      {
        key: "phone_hours",
        label: "Hours the phone is actually answered",
        type: "hours",
        required: true,
        showIf: (a) => a.phone_answered_hours_match === false,
      },
      {
        key: "after_hours_handling",
        label: "What happens to a call outside those hours?",
        type: "select",
        required: true,
        options: ["Voicemail", "Answering service", "Forwards to a mobile", "Rings unanswered", "Other"],
      },
      {
        key: "after_hours_other",
        label: "Describe what happens",
        type: "text",
        required: true,
        showIf: (a) => a.after_hours_handling === "Other",
      },
      {
        key: "closed_dates",
        label: "Dates you are closed in the next 12 months",
        type: "repeatable",
        required: false,
        itemLabel: "Closure",
        itemFields: [
          { key: "date", label: "Date", type: "date", required: true },
          { key: "reason", label: "Reason", type: "text" },
        ],
      },
    ],
  },
  {
    key: "territory",
    title: "Territory",
    blurb: "Where you can take clients. We check this against every other location so two of you never bid against each other.",
    estMinutes: 5,
    required: true,
    fields: [
      {
        key: "territory_confirm",
        label: "The contracted territory below is correct",
        type: "confirm",
        required: true,
        prefillKey: "contracted_territory",
      },
      {
        key: "service_areas",
        label: "Cities, counties and ZIP codes you serve",
        type: "geolist",
        required: true,
        minItems: 1,
        help: "Add each area on its own line. Include the state, e.g. \"Ashtabula County, OH\".",
      },
      {
        key: "excluded_areas",
        label: "Areas inside that territory you do not want ads shown in",
        type: "geolist",
        required: false,
      },
      {
        key: "travel_radius_miles",
        label: "How far will you travel for an in-home session?",
        type: "number",
        required: true,
        min: 0,
        max: 300,
      },
      {
        key: "travel_fee",
        label: "Do you charge a travel fee beyond that?",
        type: "text",
        required: false,
      },
    ],
  },
  {
    key: "services",
    title: "Services and pricing",
    blurb: "Every program you actively sell, with real prices. Ads cannot quote a price we do not have.",
    estMinutes: 7,
    required: true,
    fields: [
      {
        key: "programs",
        label: "Programs",
        type: "repeatable",
        required: true,
        minItems: 3,
        itemLabel: "Program",
        itemFields: [
          { key: "name", label: "Program name", type: "text", required: true },
          { key: "description", label: "What the customer gets", type: "textarea", required: true, minChars: 120 },
          {
            key: "price_type",
            label: "Pricing",
            type: "select",
            required: true,
            options: ["Fixed price", "Price range", "Quote only"],
          },
          { key: "price_low", label: "Price (or low end)", type: "currency", required: true, showIf: (i) => i.price_type !== "Quote only" },
          { key: "price_high", label: "High end", type: "currency", showIf: (i) => i.price_type === "Price range" },
          { key: "duration", label: "Length of the program", type: "text", required: true },
          { key: "is_flagship", label: "This is the program we should push hardest", type: "boolean" },
        ],
      },
      {
        key: "offers",
        label: "Current offers or promotions",
        type: "repeatable",
        required: false,
        itemLabel: "Offer",
        itemFields: [
          { key: "text", label: "The offer, word for word", type: "text", required: true },
          { key: "expires_on", label: "Expiry date", type: "date", required: true, help: "Every offer needs an end date so ads never run an expired promotion." },
        ],
      },
      {
        key: "not_offered",
        label: "Anything you do NOT do that people often ask for",
        type: "textarea",
        required: false,
        help: "Helps us filter out leads you cannot serve.",
      },
    ],
  },
  {
    key: "trainers",
    title: "Trainers",
    blurb: "Optional for now — you can submit without this and send photos later, but ads perform better with real faces.",
    estMinutes: 4,
    required: false,
    fields: [
      {
        key: "trainer_list",
        label: "Trainers",
        type: "repeatable",
        required: false,
        itemLabel: "Trainer",
        itemFields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "title", label: "Title", type: "text" },
          { key: "bio", label: "Short bio", type: "textarea", minChars: 80 },
          { key: "certifications", label: "Certifications", type: "text" },
          { key: "years_experience", label: "Years of experience", type: "number", min: 0, max: 70 },
        ],
      },
      {
        key: "photos_note",
        label: "Where should we get trainer photos?",
        type: "textarea",
        required: false,
        help: "A shared drive link is fine. Photos need to be at least 800 pixels wide.",
      },
    ],
  },
  {
    key: "market",
    title: "Market and competitors",
    estMinutes: 5,
    required: true,
    fields: [
      {
        key: "competitors",
        label: "Your three biggest competitors",
        type: "repeatable",
        required: true,
        minItems: 3,
        maxItems: 8,
        itemLabel: "Competitor",
        itemFields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "website", label: "Website", type: "url" },
          { key: "why_they_win", label: "Why a customer picks them over you", type: "textarea", required: true, minChars: 60 },
        ],
      },
      {
        key: "ideal_client",
        label: "Describe your ideal client",
        type: "textarea",
        required: true,
        minChars: 150,
      },
      {
        key: "problem_ranking",
        label: "Rank the problems customers come to you with, most common first",
        type: "rank",
        required: true,
        options: [
          "Aggression / reactivity",
          "Puppy basics",
          "Obedience / manners",
          "Separation anxiety",
          "Leash pulling",
          "Protection / working dog",
          "Service or therapy dog",
          "Board and train convenience",
        ],
      },
      {
        key: "seasonality",
        label: "Which months are busiest and which are dead?",
        type: "textarea",
        required: true,
        minChars: 60,
      },
    ],
  },
  {
    key: "accounts",
    title: "Existing accounts and access",
    blurb: "We need access to advertise. If you are not sure whether something exists, say so — guessing costs more time than admitting it.",
    estMinutes: 6,
    required: true,
    fields: [
      { key: "has_google_ads", label: "Do you already have a Google Ads account?", type: "select", required: true, options: ["Yes", "No", "Not sure"] },
      { key: "google_ads_cid", label: "Google Ads customer ID", type: "text", required: true, placeholder: "123-456-7890", showIf: (a) => a.has_google_ads === "Yes" },
      { key: "has_ga4", label: "Do you have Google Analytics on the website?", type: "select", required: true, options: ["Yes", "No", "Not sure"] },
      { key: "ga4_id", label: "Analytics measurement ID", type: "text", placeholder: "G-XXXXXXXXXX", showIf: (a) => a.has_ga4 === "Yes" },
      { key: "has_gtm", label: "Do you have Google Tag Manager?", type: "select", required: true, options: ["Yes", "No", "Not sure"] },
      { key: "gtm_id", label: "Tag Manager container ID", type: "text", placeholder: "GTM-XXXXXX", showIf: (a) => a.has_gtm === "Yes" },
      { key: "gbp_access_owner", label: "Who owns the Google Business Profile?", type: "text", required: true },
      { key: "has_call_tracking", label: "Do you already use a call tracking system?", type: "select", required: true, options: ["Yes", "No", "Not sure"] },
      { key: "call_tracking_vendor", label: "Which one?", type: "text", required: true, showIf: (a) => a.has_call_tracking === "Yes" },
      { key: "has_crm", label: "Do you use a CRM?", type: "select", required: true, options: ["Yes", "No", "Not sure"] },
      { key: "crm_name", label: "Which CRM?", type: "text", required: true, showIf: (a) => a.has_crm === "Yes" },
      { key: "website_platform", label: "What is the website built on?", type: "text", required: true, placeholder: "WordPress, Squarespace, Wix…" },
      {
        key: "website_access_ack",
        label: "I understand a team member will contact me directly to arrange website access",
        type: "confirm",
        required: true,
        help: "Never send passwords through this form. We will set that up with you separately.",
      },
      { key: "access_contact", label: "Who should we contact about account access?", type: "text", required: true },
    ],
  },
  {
    key: "leads",
    title: "Lead and call handling",
    estMinutes: 6,
    required: true,
    fields: [
      {
        key: "phone_answerers",
        label: "Who answers the phone?",
        type: "repeatable",
        required: true,
        minItems: 1,
        itemLabel: "Person",
        itemFields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "role", label: "Role", type: "text" },
          { key: "days", label: "Days they cover", type: "multiselect", options: DAYS, required: true },
        ],
      },
      {
        key: "response_target_minutes",
        label: "How fast do you aim to call a new lead back?",
        type: "number",
        required: true,
        min: 1,
        max: 2880,
        help: "In minutes.",
      },
      {
        key: "followup_process",
        label: "Describe what happens from the moment a lead comes in",
        type: "textarea",
        required: true,
        minChars: 200,
      },
      {
        key: "booking_method",
        label: "How do people book?",
        type: "multiselect",
        required: true,
        options: ["Phone call", "Online scheduler", "Text message", "Web form then callback", "Walk in"],
      },
      { key: "scheduler_url", label: "Link to your online scheduler", type: "url", showIf: (a) => Array.isArray(a.booking_method) && (a.booking_method as string[]).includes("Online scheduler") },
      {
        key: "call_scoring_ack",
        label: "I understand every tracked call is scored, and that scoring drives which campaigns get budget",
        type: "confirm",
        required: true,
      },
      {
        key: "disqualifiers",
        label: "What makes a lead a bad fit?",
        type: "textarea",
        required: true,
        minChars: 80,
      },
    ],
  },
  {
    key: "budget",
    title: "Budget and targets",
    estMinutes: 4,
    required: true,
    fields: [
      { key: "budget_confirm", label: "The monthly ad budget below is correct", type: "confirm", required: true, prefillKey: "monthly_budget" },
      { key: "budget_change_note", label: "If it is changing, tell us the new number and when", type: "text" },
      { key: "target_cpl", label: "What would you like to pay per lead?", type: "currency", required: true },
      { key: "target_clients_per_month", label: "How many new clients a month do you want?", type: "number", required: true, min: 1, max: 500 },
      { key: "avg_client_value", label: "Average value of a client", type: "currency", required: true },
      { key: "close_rate", label: "Out of 10 good leads, how many become clients?", type: "number", required: true, min: 0, max: 10 },
      { key: "capacity_limit", label: "How many new clients a month can you actually handle?", type: "number", required: true, min: 1, max: 500 },
      {
        key: "growth_goal",
        label: "What does a successful first 90 days look like to you?",
        type: "textarea",
        required: true,
        minChars: 120,
      },
    ],
  },
];

export const REVIEW_SECTION_KEY = "review";

export function sectionByKey(key: string) {
  return SECTIONS.find((s) => s.key === key);
}

export function totalEstimatedMinutes() {
  return SECTIONS.reduce((n, s) => n + s.estMinutes, 0);
}

export function visibleFields(section: SectionDef, answers: Answers): FieldDef[] {
  return section.fields.filter((f) => !f.showIf || f.showIf(answers));
}

function isBlank(v: unknown) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Validate one field's value. Returns an error message or null. */
export function validateField(f: FieldDef, value: unknown, scope: Answers): string | null {
  if (f.type === "confirm") {
    return f.required && value !== true ? "Please confirm this to continue" : null;
  }
  if (isBlank(value)) return f.required ? "This is required" : null;

  switch (f.type) {
    case "text":
    case "textarea": {
      const s = String(value).trim();
      if (f.minChars && s.length < f.minChars) return `Please write at least ${f.minChars} characters (${s.length} so far)`;
      if (f.maxChars && s.length > f.maxChars) return `Keep this under ${f.maxChars} characters`;
      break;
    }
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value))) return "Enter a valid email address";
      break;
    case "tel": {
      const digits = String(value).replace(/\D/g, "");
      if (digits.length !== 10 && !(digits.length === 11 && digits.startsWith("1"))) return "Enter a 10-digit US phone number";
      break;
    }
    case "url":
      if (!/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(String(value).trim())) return "Enter a full web address starting with https://";
      break;
    case "number":
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) return "Enter a number";
      if (f.min !== undefined && n < f.min) return `Must be at least ${f.min}`;
      if (f.max !== undefined && n > f.max) return `Must be ${f.max} or less`;
      break;
    }
    case "multiselect":
    case "geolist": {
      const arr = value as unknown[];
      if (f.minItems && arr.length < f.minItems) return `Choose at least ${f.minItems}`;
      if (f.maxItems && arr.length > f.maxItems) return `Choose no more than ${f.maxItems}`;
      break;
    }
    case "rank": {
      const arr = value as unknown[];
      if (!Array.isArray(arr) || arr.length !== (f.options?.length ?? 0)) return "Please rank every option";
      break;
    }
    case "hours": {
      const h = value as Record<string, { closed?: boolean; open?: string; close?: string }>;
      for (const d of DAYS) {
        const row = h?.[d];
        if (!row || row.closed) continue;
        if (!row.open || !row.close) return `${d}: add an opening and closing time, or mark it closed`;
        if (row.close <= row.open) return `${d}: closing time must be after opening time`;
      }
      if (DAYS.every((d) => h?.[d]?.closed)) return "At least one day must be open";
      break;
    }
    case "repeatable": {
      const rows = (value as Answers[]) ?? [];
      if (f.minItems && rows.length < f.minItems) return `Add at least ${f.minItems}`;
      if (f.maxItems && rows.length > f.maxItems) return `Add no more than ${f.maxItems}`;
      for (let i = 0; i < rows.length; i++) {
        for (const sub of f.itemFields ?? []) {
          if (sub.showIf && !sub.showIf(rows[i])) continue;
          const err = validateField(sub, rows[i]?.[sub.key], rows[i]);
          if (err) return `${f.itemLabel ?? "Item"} ${i + 1} — ${sub.label}: ${err}`;
        }
      }
      break;
    }
    default:
      break;
  }

  // Cross-field format rules that also run on the server.
  if (f.key === "google_ads_cid") {
    const digits = String(value).replace(/\D/g, "");
    if (digits.length !== 10) return "A Google Ads customer ID is 10 digits";
  }
  if (f.key === "ga4_id" && !/^G-[A-Z0-9]{6,12}$/i.test(String(value).trim())) return "Looks like G-XXXXXXXXXX";
  if (f.key === "gtm_id" && !/^GTM-[A-Z0-9]{5,9}$/i.test(String(value).trim())) return "Looks like GTM-XXXXXX";

  void scope;
  return null;
}

export function validateSection(section: SectionDef, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of visibleFields(section, answers)) {
    const err = validateField(f, answers[f.key], answers);
    if (err) errors[f.key] = err;
  }
  return errors;
}

export function sectionComplete(section: SectionDef, answers: Answers): boolean {
  return Object.keys(validateSection(section, answers)).length === 0;
}

/** Sections that block submit until they are clean. */
export function outstandingSections(answers: Answers): SectionDef[] {
  return SECTIONS.filter((s) => s.required && !sectionComplete(s, answers));
}

/** Flat, human-readable answer list — used by the PDF, CSV and admin view. */
export function flattenAnswers(answers: Answers): Array<{ section: string; label: string; value: string }> {
  const rows: Array<{ section: string; label: string; value: string }> = [];
  const render = (f: FieldDef, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (f.type === "hours") {
      const h = v as Record<string, { closed?: boolean; open?: string; close?: string }>;
      return DAYS.map((d) => `${d}: ${h?.[d]?.closed ? "Closed" : `${h?.[d]?.open ?? "?"}–${h?.[d]?.close ?? "?"}`}`).join("; ");
    }
    if (f.type === "repeatable") {
      const rowsIn = (v as Answers[]) ?? [];
      return rowsIn
        .map((r, i) =>
          `${i + 1}) ` +
          (f.itemFields ?? [])
            .filter((sf) => r[sf.key] !== undefined && r[sf.key] !== "")
            .map((sf) => `${sf.label}: ${Array.isArray(r[sf.key]) ? (r[sf.key] as string[]).join(", ") : String(r[sf.key])}`)
            .join(" | "),
        )
        .join("\n");
    }
    if (Array.isArray(v)) return (v as unknown[]).map(String).join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };
  for (const s of SECTIONS) {
    for (const f of s.fields) {
      if (f.showIf && !f.showIf(answers)) continue;
      rows.push({ section: s.title, label: f.label, value: render(f, answers[f.key]) });
    }
  }
  return rows;
}
