import { format, parseISO, subDays, differenceInDays } from "date-fns";

export const fmtCurrency = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n || 0);
export const fmtNumber = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n || 0);
export const fmtPct = (n: number, digits = 1) => `${(n || 0).toFixed(digits)}%`;
export const fmtDate = (s: string) => format(parseISO(s), "MMM d");

export type DateRange = { from: Date; to: Date };
export function getRange(days: number): DateRange { const to = new Date(); return { from: subDays(to, days - 1), to }; }
export function priorRange(r: DateRange): DateRange { const span = differenceInDays(r.to, r.from) + 1; return { from: subDays(r.from, span), to: subDays(r.to, span) }; }
export function rangeToISO(r: DateRange) { return { from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") }; }
export function pctChange(curr: number, prev: number): number { if (!prev) return curr ? 100 : 0; return ((curr - prev) / prev) * 100; }

// Per-call metric helpers (used by CTM components)
export const costPerCall = (cost: number, n: number) => (n ? cost / n : null);
export const ctr = (clicks: number, imp: number) => (imp ? (clicks / imp) * 100 : null);
export const cpc = (cost: number, clicks: number) => (clicks ? cost / clicks : null);

export const SOURCE_COLORS: Record<string, string> = {
  "Google PPC": "hsl(var(--chart-1))",
  "Organic": "hsl(var(--chart-2))",
  "Website": "hsl(var(--chart-3))",
  "Yelp": "hsl(var(--chart-5))",
  "Facebook": "hsl(var(--chart-4))",
  "Other": "hsl(var(--chart-5))",
};