/**
 * Central calculated-field utilities. All functions return `null` for
 * divide-by-zero or missing inputs — never NaN or Infinity. UI should render
 * `null` as an em dash ("—").
 */

const safe = (numerator: number, denominator: number): number | null => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
};

export const costPerCall = (cost: number, recordCount: number) => safe(cost, recordCount);
export const costPerGoodLead = (cost: number, goodLeads: number) => safe(cost, goodLeads);
export const costPerBadLead = (cost: number, badLeads: number) => safe(cost, badLeads);
export const costPerLead = (cost: number, leads: number) => safe(cost, leads);
export const costPerIntake = (cost: number, admissions: number) => safe(cost, admissions);

export const ctr = (clicks: number, impressions: number) => safe(clicks, impressions);
export const cpc = (cost: number, clicks: number) => safe(cost, clicks);
export const cpm = (cost: number, impressions: number) => {
  const v = safe(cost, impressions);
  return v === null ? null : v * 1000;
};

/** Format helpers — UI-only, default behavior */
export const fmtCurrency = (v: number | null | undefined, currency = "USD") =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);

export const fmtNumber = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("en-US").format(v);

export const fmtPercent = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;