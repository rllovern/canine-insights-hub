import { format, parseISO, subDays, differenceInDays } from "date-fns";
import type { MetricRow } from "./data-sources";

export const fmtCurrency = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n || 0);
export const fmtNumber = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n || 0);
export const fmtPct = (n: number, digits = 1) => `${(n || 0).toFixed(digits)}%`;
export const fmtPercent = (n: number | null, digits = 1) =>
  n == null ? "—" : `${n.toFixed(digits)}%`;
export const fmtDate = (s: string) => format(parseISO(s), "MMM d");

export type DateRange = { from: Date; to: Date };

export function eachDateISO(from: Date, to: Date): string[] {
  const out: string[] = [];
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(format(d, "yyyy-MM-dd"));
  }
  return out;
}

/**
 * Ensure series has one row per day in [from, to]. Missing dates are filled
 * with `defaults` (e.g. zeros for known keys) so trend lines stay continuous.
 */
export function fillDateRange<T extends { date: string }>(
  series: T[],
  from: Date,
  to: Date,
  defaults: Partial<T> = {} as Partial<T>,
): T[] {
  const map = new Map(series.map((r) => [r.date, r]));
  return eachDateISO(from, to).map(
    (date) => (map.get(date) ?? ({ date, ...defaults } as unknown as T)),
  );
}

export function getRange(days: number): DateRange {
  const to = new Date();
  return { from: subDays(to, days - 1), to };
}
export function priorRange(r: DateRange): DateRange {
  const span = differenceInDays(r.to, r.from) + 1;
  return { from: subDays(r.from, span), to: subDays(r.to, span) };
}
export function rangeToISO(r: DateRange) {
  return { from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
}
export function pctChange(curr: number, prev: number): number {
  if (!prev) return curr ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}

// Per-call helpers used by CTM
export const costPerCall = (cost: number, n: number) => (n ? cost / n : null);
export const costPerLead = (cost: number, leads: number) => (leads ? cost / leads : 0);
export const ctr = (clicks: number, imp: number) => (imp ? (clicks / imp) * 100 : null);
export const cpc = (cost: number, clicks: number) => (clicks ? cost / clicks : null);

const ZERO = { cost: 0, impressions: 0, clicks: 0, record_count: 0, no_entry: 0, leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, spam: 0, projected_sale: 0, verified_sale: 0, sessions: 0, users: 0 };

export function sumMetrics(rows: MetricRow[]) {
  return rows.reduce((acc: any, r: any) => {
    for (const k of Object.keys(ZERO)) acc[k] += Number(r[k] ?? 0);
    return acc;
  }, { ...ZERO });
}

export type Totals = ReturnType<typeof sumMetrics>;

export function groupByDate(rows: MetricRow[]) {
  const map = new Map<string, any>();
  for (const r of rows as any[]) {
    const ex = map.get(r.date) ?? { date: r.date, ...ZERO };
    for (const k of Object.keys(ZERO)) ex[k] += Number(r[k] ?? 0);
    map.set(r.date, ex);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function groupByDateAndSource(rows: MetricRow[], metric: keyof Totals) {
  const sources = Array.from(new Set(rows.map((r) => r.ad_source)));
  const dateMap = new Map<string, any>();
  for (const r of rows) {
    const ex = dateMap.get(r.date) ?? ({ date: r.date } as any);
    ex[r.ad_source] = (ex[r.ad_source] || 0) + Number((r as any)[metric] || 0);
    dateMap.set(r.date, ex);
  }
  const series = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  for (const row of series) for (const s of sources) if (row[s] === undefined) row[s] = 0;
  return { series, sources };
}

export function groupBySource(rows: MetricRow[]) {
  const map = new Map<string, any>();
  for (const r of rows as any[]) {
    const ex = map.get(r.ad_source) ?? { ad_source: r.ad_source, ...ZERO };
    for (const k of Object.keys(ZERO)) ex[k] += Number(r[k] ?? 0);
    map.set(r.ad_source, ex);
  }
  return Array.from(map.values());
}

export function groupByCampaign(rows: MetricRow[]) {
  const map = new Map<string, any>();
  for (const r of rows as any[]) {
    const key = `${r.ad_source}::${r.campaign}`;
    const ex = map.get(key) ?? { ad_source: r.ad_source, campaign: r.campaign, ...ZERO };
    for (const k of Object.keys(ZERO)) ex[k] += Number(r[k] ?? 0);
    map.set(key, ex);
  }
  return Array.from(map.values());
}

export const SOURCE_COLORS: Record<string, string> = {
  "Google PPC": "hsl(var(--chart-1))",
  "Facebook": "hsl(var(--chart-2))",
  "Organic": "hsl(var(--chart-3))",
  "Website": "hsl(var(--chart-4))",
  "Yelp": "hsl(var(--chart-5))",
  "Direct": "hsl(var(--chart-6))",
  "Referral": "hsl(var(--chart-7))",
  "Other": "hsl(var(--chart-8))",
};
