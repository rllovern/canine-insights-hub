import { format, parseISO, subDays, differenceInDays } from "date-fns";
import type { MetricRow } from "./data-sources";

export const fmtCurrency = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n || 0);
export const fmtNumber = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n || 0);
export const fmtPct = (n: number, digits = 1) => `${(n || 0).toFixed(digits)}%`;
export const fmtDate = (s: string) => format(parseISO(s), "MMM d");

export type DateRange = { from: Date; to: Date };

export const presetRanges = {
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
} as const;

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

export function sumMetrics(rows: MetricRow[]) {
  return rows.reduce(
    (acc, r) => {
      acc.cost += Number(r.cost);
      acc.impressions += r.impressions;
      acc.clicks += r.clicks;
      acc.record_count += r.record_count;
      acc.no_entry += r.no_entry;
      acc.leads += r.leads;
      acc.good_leads += r.good_leads;
      acc.bad_leads += r.bad_leads;
      acc.medicaid += r.medicaid ?? 0;
      acc.spam += r.spam;
      acc.admissions += r.admissions;
      acc.sessions += r.sessions;
      acc.users += r.users;
      return acc;
    },
    { cost: 0, impressions: 0, clicks: 0, record_count: 0, no_entry: 0, leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, spam: 0, admissions: 0, sessions: 0, users: 0 }
  );
}

export type Totals = ReturnType<typeof sumMetrics>;

// Group rows by date -> sum
export function groupByDate(rows: MetricRow[]) {
  const map = new Map<string, Totals & { date: string }>();
  for (const r of rows) {
    const ex = map.get(r.date) ?? { date: r.date, cost: 0, impressions: 0, clicks: 0, record_count: 0, no_entry: 0, leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, spam: 0, admissions: 0, sessions: 0, users: 0 };
    ex.cost += Number(r.cost);
    ex.impressions += r.impressions;
    ex.clicks += r.clicks;
    ex.record_count += r.record_count;
    ex.no_entry += r.no_entry;
    ex.leads += r.leads;
    ex.good_leads += r.good_leads;
    ex.bad_leads += r.bad_leads;
    ex.medicaid += r.medicaid ?? 0;
    ex.spam += r.spam;
    ex.admissions += r.admissions;
    ex.sessions += r.sessions;
    ex.users += r.users;
    map.set(r.date, ex);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Group rows by date AND ad_source -> rows have date + per-source values
export function groupByDateAndSource(rows: MetricRow[], metric: keyof Totals) {
  const sources = Array.from(new Set(rows.map((r) => r.ad_source)));
  const dateMap = new Map<string, Record<string, number> & { date: string }>();
  for (const r of rows) {
    const ex = dateMap.get(r.date) ?? ({ date: r.date } as any);
    ex[r.ad_source] = (ex[r.ad_source] || 0) + Number(r[metric] || 0);
    dateMap.set(r.date, ex);
  }
  const series = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  // ensure all sources present per row
  for (const row of series) for (const s of sources) if (row[s] === undefined) row[s] = 0;
  return { series, sources };
}

export function groupBySource(rows: MetricRow[]) {
  const map = new Map<string, Totals & { ad_source: string }>();
  for (const r of rows) {
    const ex = map.get(r.ad_source) ?? { ad_source: r.ad_source, cost: 0, impressions: 0, clicks: 0, record_count: 0, no_entry: 0, leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, spam: 0, admissions: 0, sessions: 0, users: 0 };
    ex.cost += Number(r.cost);
    ex.impressions += r.impressions;
    ex.clicks += r.clicks;
    ex.record_count += r.record_count;
    ex.no_entry += r.no_entry;
    ex.leads += r.leads;
    ex.good_leads += r.good_leads;
    ex.bad_leads += r.bad_leads;
    ex.medicaid += r.medicaid ?? 0;
    ex.spam += r.spam;
    ex.admissions += r.admissions;
    ex.sessions += r.sessions;
    ex.users += r.users;
    map.set(r.ad_source, ex);
  }
  return Array.from(map.values());
}

export function groupByCampaign(rows: MetricRow[]) {
  const map = new Map<string, Totals & { ad_source: string; campaign: string }>();
  for (const r of rows) {
    const key = `${r.ad_source}::${r.campaign}`;
    const ex = map.get(key) ?? { ad_source: r.ad_source, campaign: r.campaign, cost: 0, impressions: 0, clicks: 0, record_count: 0, no_entry: 0, leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, spam: 0, admissions: 0, sessions: 0, users: 0 };
    ex.cost += Number(r.cost);
    ex.impressions += r.impressions;
    ex.clicks += r.clicks;
    ex.record_count += r.record_count;
    ex.no_entry += r.no_entry;
    ex.leads += r.leads;
    ex.good_leads += r.good_leads;
    ex.bad_leads += r.bad_leads;
    ex.medicaid += r.medicaid ?? 0;
    ex.spam += r.spam;
    ex.admissions += r.admissions;
    ex.sessions += r.sessions;
    ex.users += r.users;
    map.set(key, ex);
  }
  return Array.from(map.values());
}

export const SOURCE_COLORS: Record<string, string> = {
  "Google PPC": "hsl(var(--chart-1))",
  "Organic": "hsl(var(--chart-2))",
  "Website": "hsl(var(--chart-3))",
  "Yelp": "hsl(var(--chart-6))",
  "Facebook": "hsl(var(--chart-4))",
  "Twitter": "hsl(var(--chart-5))",
  "Other": "hsl(var(--chart-7))",
};
