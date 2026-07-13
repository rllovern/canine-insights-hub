// Verified Sale reads from `ghl_opportunities` — GHL Won status is the source
// of truth for a sale, bucketed by `won_at`. Call Tracking is the only place
// that keeps reading daily_metrics.verified_sale.
// Call Tracking is the only place that keeps reading daily_metrics.verified_sale.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Group a UTC `won_at` timestamp by the viewer's local calendar day so the
// heatmap, runway, and record list all agree on which day a sale belongs to.
// (`won_at.slice(0, 10)` would use UTC and drift by a day for late-evening
// wins in westerly timezones.)
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDayBoundaryIso(day: string, boundary: "start" | "end"): string {
  const [year, month, date] = day.split("-").map(Number);
  const d = boundary === "start"
    ? new Date(year, month - 1, date, 0, 0, 0, 0)
    : new Date(year, month - 1, date, 23, 59, 59, 999);
  return d.toISOString();
}

export async function fetchVerifiedSalesByDate(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  if (propertyIds && propertyIds.length === 0) return {};

  let q = supabase
    .from("ghl_opportunities")
    .select("won_at")
    .eq("status", "won")
    .gte("won_at", localDayBoundaryIso(from, "start"))
    .lte("won_at", localDayBoundaryIso(to, "end"));
  if (propertyIds) q = q.in("property_id", propertyIds);
  const { data, error } = await q;
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { won_at: string | null }[]) {
    if (!r.won_at) continue;
    const day = localDayKey(r.won_at);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

export function useVerifiedSalesTotal(
  propertyIds: string[] | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: ["verified-sales-total", propertyIds?.join(",") ?? "all", from, to],
    queryFn: async () => {
      const map = await fetchVerifiedSalesByDate(propertyIds, from, to);
      return Object.values(map).reduce((a, b) => a + b, 0);
    },
  });
}

export function useVerifiedSalesByDate(
  propertyIds: string[] | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: ["verified-sales-by-date", propertyIds?.join(",") ?? "all", from, to],
    queryFn: () => fetchVerifiedSalesByDate(propertyIds, from, to),
  });
}

export interface SaleRecord {
  opportunity_id: string;
  property_id: string;
  contact_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string | null;
  won_at: string | null;
  amount: number | null;
}

export async function fetchSaleRecords(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<SaleRecord[]> {
  if (propertyIds && propertyIds.length === 0) return [];

  let q = supabase
    .from("ghl_opportunities")
    .select("id, property_id, contact_id, ghl_created_at, won_at, monetary_value, raw")
    .eq("status", "won")
    .gte("won_at", localDayBoundaryIso(from, "start"))
    .lte("won_at", localDayBoundaryIso(to, "end"))
    .order("won_at", { ascending: false });
  if (propertyIds) q = q.in("property_id", propertyIds);

  const { data: opps, error } = await q;
  if (error || !opps) return [];

  // Hydrate contact info in batches, scoped by property_id for RLS safety.
  const byProp = new Map<string, Set<string>>();
  for (const o of opps as Array<{ property_id: string; contact_id: string | null }>) {
    if (!o.contact_id) continue;
    if (!byProp.has(o.property_id)) byProp.set(o.property_id, new Set());
    byProp.get(o.property_id)!.add(o.contact_id);
  }

  const contactMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>();
  await Promise.all(
    Array.from(byProp.entries()).map(async ([pid, ids]) => {
      const idList = Array.from(ids);
      if (idList.length === 0) return;
      const { data } = await supabase
        .from("ghl_contacts")
        .select("ghl_contact_id, first_name, last_name, email, phone")
        .eq("property_id", pid)
        .in("ghl_contact_id", idList);
      for (const c of (data ?? []) as Array<{ ghl_contact_id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>) {
        contactMap.set(`${pid}:${c.ghl_contact_id}`, c);
      }
    }),
  );

  return (opps as Array<{
    id: string;
    property_id: string;
    contact_id: string | null;
    ghl_created_at: string | null;
    won_at: string | null;
    monetary_value: number | string | null;
    raw: Record<string, unknown> | null;
  }>).map((o) => {
    const c = o.contact_id ? contactMap.get(`${o.property_id}:${o.contact_id}`) : undefined;
    const nameParts = [c?.first_name, c?.last_name].filter(Boolean);
    const rawName = typeof o.raw?.["name"] === "string" ? (o.raw!["name"] as string) : null;
    return {
      opportunity_id: o.id,
      property_id: o.property_id,
      contact_id: o.contact_id,
      name: nameParts.length ? nameParts.join(" ") : rawName,
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      created_at: o.ghl_created_at,
      won_at: o.won_at,
      amount: o.monetary_value == null ? null : Number(o.monetary_value),
    };
  });
}

export function useSaleRecords(
  propertyIds: string[] | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: ["sale-records", propertyIds?.join(",") ?? "all", from, to],
    queryFn: () => fetchSaleRecords(propertyIds, from, to),
  });
}

// ─── Revenue Runway: CTM Good Lead + avg-deal-value hooks ────────────────
//
// Fixed target = prior-30-day CTM Good Lead baseline × 30% × avg-deal-value.
// Forecast     = closedRevenueToDate + (current-period Good Lead pace ×
//                remainingDays × 30% × avg-deal-value).
// Target and forecast fail independently.

const BENCHMARK_CLOSE_RATE = 0.3;

export type CtmCoverageStatus = "ok" | "confirmed_zero" | "partial_coverage" | "missing_data";
export type DealValueStatus = "verified_90d" | "expanded_180d" | "no_deal_value";

export interface CtmCoverage {
  total: number;
  dailyAvg: number;
  coveredDays: number;
  expectedDays: number;
  coveredPropertyDays: number;
  expectedPropertyDays: number;
  status: CtmCoverageStatus;
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysUtc(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

async function fetchCtmCoverage(
  propertyIds: string[] | null,
  allPropertyCount: number,
  fromDay: string,
  toDay: string,
  expectedDays: number,
): Promise<CtmCoverage> {
  const scopeCount = propertyIds ? propertyIds.length : allPropertyCount;
  const empty: CtmCoverage = {
    total: 0,
    dailyAvg: 0,
    coveredDays: 0,
    expectedDays,
    coveredPropertyDays: 0,
    expectedPropertyDays: expectedDays * scopeCount,
    status: "missing_data",
  };
  if (scopeCount === 0 || expectedDays <= 0) return empty;

  let q = supabase
    .from("daily_metrics")
    .select("property_id, date, good_leads")
    .gte("date", fromDay)
    .lte("date", toDay);
  if (propertyIds) q = q.in("property_id", propertyIds);
  const { data, error } = await q;
  if (error || !data) return empty;

  let total = 0;
  const dayKeys = new Set<string>();
  const pairKeys = new Set<string>();
  for (const r of data as Array<{ property_id: string; date: string; good_leads: number | null }>) {
    total += r.good_leads ?? 0;
    dayKeys.add(r.date);
    pairKeys.add(`${r.property_id}:${r.date}`);
  }
  const coveredPropertyDays = pairKeys.size;
  const expectedPropertyDays = expectedDays * scopeCount;
  let status: CtmCoverageStatus;
  if (coveredPropertyDays === 0) status = "missing_data";
  else if (coveredPropertyDays < expectedPropertyDays) status = "partial_coverage";
  else if (total === 0) status = "confirmed_zero";
  else status = "ok";

  return {
    total,
    dailyAvg: total / expectedDays,
    coveredDays: dayKeys.size,
    expectedDays,
    coveredPropertyDays,
    expectedPropertyDays,
    status,
  };
}

export function useCtmGoodLeadBaseline(
  propertyIds: string[] | null,
  allPropertyCount: number,
  targetPeriodStart: Date | null,
  enabled = true,
) {
  const from = targetPeriodStart ? isoDay(addDaysUtc(targetPeriodStart, -30)) : null;
  const to = targetPeriodStart ? isoDay(addDaysUtc(targetPeriodStart, -1)) : null;
  return useQuery({
    enabled: enabled && !!from && !!to,
    queryKey: ["ctm-good-lead-baseline", propertyIds?.join(",") ?? "all", allPropertyCount, from, to],
    queryFn: () => fetchCtmCoverage(propertyIds, allPropertyCount, from!, to!, 30),
  });
}

export function useCtmGoodLeadsToDate(
  propertyIds: string[] | null,
  allPropertyCount: number,
  targetPeriodStart: Date | null,
  asOfDate: Date | null,
  enabled = true,
) {
  const from = targetPeriodStart ? isoDay(targetPeriodStart) : null;
  const to = asOfDate ? isoDay(asOfDate) : null;
  const expectedDays = from && to
    ? Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1)
    : 0;
  return useQuery({
    // Skip entirely when the period hasn't started (asOfDate == null).
    enabled: enabled && !!from && !!to && expectedDays > 0,
    queryKey: ["ctm-good-leads-to-date", propertyIds?.join(",") ?? "all", allPropertyCount, from, to],
    queryFn: () => fetchCtmCoverage(propertyIds, allPropertyCount, from!, to!, expectedDays),
  });
}

export interface AvgDealValue {
  value: number | null;
  sampleSize: number;
  status: DealValueStatus;
}

async function fetchWonDealMean(
  propertyIds: string[] | null,
  fromIso: string,
  toIso: string,
): Promise<{ mean: number; n: number }> {
  if (propertyIds && propertyIds.length === 0) return { mean: 0, n: 0 };
  let q = supabase
    .from("ghl_opportunities")
    .select("monetary_value, raw")
    .eq("status", "won")
    .not("won_at", "is", null)
    .gt("monetary_value", 0)
    .gte("won_at", fromIso)
    .lte("won_at", toIso);
  if (propertyIds) q = q.in("property_id", propertyIds);
  const { data, error } = await q;
  if (error || !data) return { mean: 0, n: 0 };
  let sum = 0;
  let n = 0;
  for (const r of data as Array<{ monetary_value: number | string | null; raw: Record<string, unknown> | null }>) {
    // Explicit exclusions only — never invent filters that aren't reliably tracked.
    const raw = r.raw ?? {};
    if (raw["refunded"]) continue;
    if (raw["cancelled"]) continue;
    if (raw["duplicate_group_id"]) continue;
    const v = r.monetary_value == null ? 0 : Number(r.monetary_value);
    if (!Number.isFinite(v) || v <= 0) continue;
    sum += v;
    n += 1;
  }
  return { mean: n > 0 ? sum / n : 0, n };
}

export function useAvgDealValue(
  propertyIds: string[] | null,
  anchorDate: Date | null,
  enabled = true,
) {
  const anchor = anchorDate ? isoDay(anchorDate) : null;
  return useQuery({
    enabled: enabled && !!anchor,
    queryKey: ["avg-deal-value", propertyIds?.join(",") ?? "all", anchor],
    queryFn: async (): Promise<AvgDealValue> => {
      const end = new Date(anchor!);
      end.setDate(end.getDate() - 1);
      const endIso = end.toISOString();
      const start90 = new Date(end);
      start90.setDate(end.getDate() - 89);
      const s90 = await fetchWonDealMean(propertyIds, start90.toISOString(), endIso);
      if (s90.n >= 20) return { value: s90.mean, sampleSize: s90.n, status: "verified_90d" };
      const start180 = new Date(end);
      start180.setDate(end.getDate() - 179);
      const s180 = await fetchWonDealMean(propertyIds, start180.toISOString(), endIso);
      if (s180.n >= 20) return { value: s180.mean, sampleSize: s180.n, status: "expanded_180d" };
      return { value: null, sampleSize: s180.n, status: "no_deal_value" };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export type TargetDataStatus =
  | "verified_90d"
  | "expanded_180d"
  | "no_good_lead_baseline"
  | "no_deal_value";

export interface RevenueTargetResult {
  target: number | null;
  benchmarkCloseRate: number;
  targetPeriodDays: number;
  baselineCtmGoodLeads30d: number;
  baselineDailyCtmGoodLeads: number;
  baselineCoverage: CtmCoverage | null;
  expectedCtmGoodLeadsForPeriod: number;
  avgDealValue: number | null;
  avgDealSampleSize: number;
  targetDataStatus: TargetDataStatus;
  isLoading: boolean;
}

export function useRevenueTarget(
  propertyIds: string[] | null,
  allPropertyCount: number,
  period: { targetPeriodStart: Date; targetPeriodEnd: Date; targetPeriodDays: number },
): RevenueTargetResult {
  const baseline = useCtmGoodLeadBaseline(propertyIds, allPropertyCount, period.targetPeriodStart);
  const dv = useAvgDealValue(propertyIds, period.targetPeriodStart);
  const isLoading = baseline.isLoading || dv.isLoading;

  const cov = baseline.data ?? null;
  const dvVal = dv.data?.value ?? null;
  const dvStatus = dv.data?.status ?? "no_deal_value";

  const baselineOk = cov && (cov.status === "ok" || cov.status === "confirmed_zero");
  const baselineDaily = baselineOk ? cov!.total / 30 : 0;
  const expected = baselineDaily * period.targetPeriodDays;

  let target: number | null = null;
  let status: TargetDataStatus;
  if (!baselineOk) {
    status = "no_good_lead_baseline";
  } else if (dvVal == null) {
    status = "no_deal_value";
  } else {
    status = dvStatus === "expanded_180d" ? "expanded_180d" : "verified_90d";
    target = expected * BENCHMARK_CLOSE_RATE * dvVal;
  }

  return {
    target,
    benchmarkCloseRate: BENCHMARK_CLOSE_RATE,
    targetPeriodDays: period.targetPeriodDays,
    baselineCtmGoodLeads30d: cov?.total ?? 0,
    baselineDailyCtmGoodLeads: baselineDaily,
    baselineCoverage: cov,
    expectedCtmGoodLeadsForPeriod: expected,
    avgDealValue: dvVal,
    avgDealSampleSize: dv.data?.sampleSize ?? 0,
    targetDataStatus: status,
    isLoading,
  };
}

export type ForecastDataStatus =
  | "verified_90d"
  | "expanded_180d"
  | "no_deal_value"
  | "no_elapsed_period"
  | "missing_current_ctm"
  | "unavailable";

export interface RevenueForecastResult {
  projectedFinish: number | null;
  forecastMethod: "ctm_future_good_lead_pace" | "unavailable";
  closedRevenueToDate: number;
  ctmGoodLeadsToDate: number;
  currentPeriodCoverage: CtmCoverage | null;
  elapsedDays: number;
  remainingDays: number;
  currentGoodLeadDailyRate: number;
  projectedFutureGoodLeads: number;
  projectedFutureWins: number;
  projectedFutureRevenue: number;
  benchmarkCloseRate: number;
  avgDealValue: number | null;
  forecastDataStatus: ForecastDataStatus;
  isLoading: boolean;
}

export function useRevenueForecast(
  propertyIds: string[] | null,
  allPropertyCount: number,
  period: { targetPeriodStart: Date; targetPeriodEnd: Date; asOfDate: Date | null; elapsedDays: number; remainingDays: number },
  closedRevenueToDate: number,
): RevenueForecastResult {
  const current = useCtmGoodLeadsToDate(
    propertyIds,
    allPropertyCount,
    period.targetPeriodStart,
    period.asOfDate,
  );
  const dv = useAvgDealValue(propertyIds, period.targetPeriodStart);
  const isLoading = current.isLoading || dv.isLoading;

  const cov = current.data ?? null;
  const dvVal = dv.data?.value ?? null;
  const dvStatus = dv.data?.status ?? "no_deal_value";

  const base = {
    closedRevenueToDate,
    ctmGoodLeadsToDate: cov?.total ?? 0,
    currentPeriodCoverage: cov,
    elapsedDays: period.elapsedDays,
    remainingDays: period.remainingDays,
    benchmarkCloseRate: BENCHMARK_CLOSE_RATE,
    avgDealValue: dvVal,
    currentGoodLeadDailyRate: 0,
    projectedFutureGoodLeads: 0,
    projectedFutureWins: 0,
    projectedFutureRevenue: 0,
  };

  if (period.asOfDate == null || period.elapsedDays <= 0) {
    return {
      ...base,
      projectedFinish: null,
      forecastMethod: "unavailable",
      forecastDataStatus: "no_elapsed_period",
      isLoading,
    };
  }
  if (dvVal == null) {
    return { ...base, projectedFinish: null, forecastMethod: "unavailable", forecastDataStatus: "no_deal_value", isLoading };
  }
  const covOk = cov && (cov.status === "ok" || cov.status === "confirmed_zero");
  if (!covOk) {
    return { ...base, projectedFinish: null, forecastMethod: "unavailable", forecastDataStatus: "missing_current_ctm", isLoading };
  }

  const rate = cov!.total / period.elapsedDays;
  const futureGL = rate * period.remainingDays;
  const futureWins = futureGL * BENCHMARK_CLOSE_RATE;
  const futureRev = futureWins * dvVal;
  const projectedFinish = Math.max(closedRevenueToDate, closedRevenueToDate + futureRev);
  const status: ForecastDataStatus = dvStatus === "expanded_180d" ? "expanded_180d" : "verified_90d";

  return {
    ...base,
    currentGoodLeadDailyRate: rate,
    projectedFutureGoodLeads: futureGL,
    projectedFutureWins: futureWins,
    projectedFutureRevenue: futureRev,
    projectedFinish,
    forecastMethod: "ctm_future_good_lead_pace",
    forecastDataStatus: status,
    isLoading,
  };
}

// ─── Pure series builder (used by chart + tests) ─────────────────────────
export interface RunwaySeriesPoint {
  date: string;
  actual: number | null;
  target: number | null;
  projection: number | null;
}

export function buildRunwaySeries(args: {
  targetPeriodStart: Date;
  targetPeriodDays: number;
  elapsedDays: number;
  remainingDays: number;
  actualByDay: Record<string, number>; // daily revenue keyed by yyyy-MM-dd
  target: number | null;
  closedRevenueToDate: number;
  projectedFutureRevenue: number;
  hasForecast: boolean;
}): RunwaySeriesPoint[] {
  const {
    targetPeriodStart, targetPeriodDays, elapsedDays, remainingDays,
    actualByDay, target, closedRevenueToDate, projectedFutureRevenue, hasForecast,
  } = args;
  const out: RunwaySeriesPoint[] = [];
  let cum = 0;
  for (let i = 0; i < targetPeriodDays; i++) {
    const d = new Date(targetPeriodStart);
    d.setDate(d.getDate() + i);
    const key = isoDay(d);
    let actual: number | null = null;
    if (i < elapsedDays) {
      cum += actualByDay[key] ?? 0;
      actual = cum;
    }
    const targetVal = target == null ? null : target * ((i + 1) / targetPeriodDays);

    let projection: number | null = null;
    if (hasForecast && elapsedDays > 0 && remainingDays > 0) {
      if (i === elapsedDays - 1) {
        projection = closedRevenueToDate;
      } else if (i >= elapsedDays) {
        const progress = (i - (elapsedDays - 1)) / remainingDays;
        projection = closedRevenueToDate + projectedFutureRevenue * progress;
      }
    }
    out.push({ date: key, actual, target: targetVal, projection });
  }
  return out;
}