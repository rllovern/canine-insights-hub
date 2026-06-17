/**
 * Canonical lead model — the ONLY place TypeScript computes lead totals or
 * quality. SQL mirror lives in `public.v_lead_counts_daily` and
 * `public.lead_quality_rollup`. Every page reads through this module; no
 * surface re-derives total leads or quality rate locally.
 *
 * Three mutually-exclusive real-lead tiers (bad, good, AI-projected).
 * `projected` is NEVER inside `good`, NEVER subtracted, NEVER a forecast.
 */

export type LeadCounts = {
  bad: number;
  good: number;
  projected: number;
  spam?: number;
  noEntry?: number;
  verified?: number;
};

/** Total Leads = bad + good + AI-projected. Three exclusive tiers. */
export const totalLeads = (c: LeadCounts) => c.bad + c.good + c.projected;

/** Quality numerator = good + AI-projected (both are quality outcomes). */
export const qualityNumerator = (c: LeadCounts) => c.good + c.projected;

/** Quality rate = (good + projected) ÷ total. Ratio-of-sums when aggregating. */
export const qualityRate = (c: LeadCounts) => {
  const t = totalLeads(c);
  return t ? qualityNumerator(c) / t : 0;
};

/** Absolute, fixed quality targets. Never derived from any single location. */
export const QUALITY_TARGETS = { green: 0.55, amber: 0.45 } as const;

/** Highest-volume location (Winchester). Shown as benchmark, NOT threshold. */
export const WINCHESTER_BENCHMARK = 0.50;

/** Suppress noisy rates on small samples — fall back to absolute counts. */
export const LOW_SAMPLE_BASE = 25;

export type QualityTier = "green" | "amber" | "red" | "low-sample";

export function qualityTier(rate: number, base: number): QualityTier {
  if (base < LOW_SAMPLE_BASE) return "low-sample";
  if (rate >= QUALITY_TARGETS.green) return "green";
  if (rate >= QUALITY_TARGETS.amber) return "amber";
  return "red";
}

/** Canonical UI label for the projected-sale tier. Never "expected sales". */
export const PROJECTED_LABEL = "AI-projected sale";

/** Tailwind color helpers so every page styles the same tier the same way. */
export const TIER_TEXT: Record<QualityTier, string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-rose-600",
  "low-sample": "text-slate-500",
};
export const TIER_DOT: Record<QualityTier, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  "low-sample": "bg-slate-400",
};

export function formatQualityRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Helper: build canonical totals/quality for an arbitrary row that already
 * carries `bad_leads`, `good_leads`, `projected_sale` columns. Use this from
 * grouped-by-source / grouped-by-campaign tables so they never re-derive
 * total_leads or quality_rate inline.
 */
export function rowLeadCounts(row: {
  bad_leads?: number | null;
  good_leads?: number | null;
  projected_sale?: number | null;
  verified_sale?: number | null;
}): LeadCounts {
  return {
    bad: Number(row.bad_leads ?? 0),
    good: Number(row.good_leads ?? 0),
    projected: Number(row.projected_sale ?? 0),
    verified: Number(row.verified_sale ?? 0),
  };
}

export function rowTotalLeads(row: Parameters<typeof rowLeadCounts>[0]) {
  return totalLeads(rowLeadCounts(row));
}

export function rowQualityRate(row: Parameters<typeof rowLeadCounts>[0]) {
  return qualityRate(rowLeadCounts(row));
}