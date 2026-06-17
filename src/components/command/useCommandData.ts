import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { eachDateISO, rangeToISO, priorRange, type DateRange } from "@/lib/metrics";
import { totalLeads as canonicalTotalLeads, qualityRate as canonicalQualityRate, type LeadCounts } from "@/lib/leadModel";

export type DailyAgg = {
  date: string;
  cost: number;
  good_leads: number;
  bad_leads: number;
  projected_sale: number;
  verified_sale: number;
  calls: number;
};

export type Totals = {
  spend: number;
  calls: number;
  qualifiedCalls: number;
  appointments: number;
  revenue: number;
  totalLeads: number;
  /** Canonical lead-model fields (parallel tiers — never nested). */
  good: number;
  projected: number;
  bad: number;
  qualityRate: number;
};

export type CommandTargets = {
  cpl: number;
  cpgl: number;
  qualRate: number;
  projectionRate: number;
  costPerProjected: number;
  monthlyBudget: number | null;
};

export const DEFAULT_COMMAND_TARGETS: CommandTargets = {
  cpl: 200,
  cpgl: 400,
  qualRate: 0.45,
  projectionRate: 0.4,
  costPerProjected: 1000,
  monthlyBudget: null,
};

function zeroDay(date: string): DailyAgg {
  return { date, cost: 0, good_leads: 0, bad_leads: 0, projected_sale: 0, verified_sale: 0, calls: 0 };
}

async function fetchWindow(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<DailyAgg[]> {
  // daily_metrics: cost + leads + sales
  let dm = supabase
    .from("daily_metrics")
    .select("date, cost, good_leads, bad_leads, projected_sale, verified_sale")
    .gte("date", from)
    .lte("date", to);
  if (propertyIds) dm = dm.in("property_id", propertyIds);
  const dmRes = await dm;
  if (dmRes.error) throw dmRes.error;

  // ctm_calls: counts per day
  let cc = supabase
    .from("ctm_calls")
    .select("called_at, property_id")
    .gte("called_at", `${from}T00:00:00.000Z`)
    .lte("called_at", `${to}T23:59:59.999Z`);
  if (propertyIds) cc = cc.in("property_id", propertyIds);
  const ccRes = await cc;
  if (ccRes.error) throw ccRes.error;

  const map = new Map<string, DailyAgg>();
  for (const d of eachDateISO(new Date(from), new Date(to))) map.set(d, zeroDay(d));
  for (const r of (dmRes.data ?? []) as any[]) {
    const day = map.get(r.date) ?? zeroDay(r.date);
    day.cost += Number(r.cost ?? 0);
    day.good_leads += Number(r.good_leads ?? 0);
    day.bad_leads += Number(r.bad_leads ?? 0);
    day.projected_sale += Number(r.projected_sale ?? 0);
    day.verified_sale += Number(r.verified_sale ?? 0);
    map.set(r.date, day);
  }
  for (const r of (ccRes.data ?? []) as any[]) {
    const date = (r.called_at as string).slice(0, 10);
    const day = map.get(date) ?? zeroDay(date);
    day.calls += 1;
    map.set(date, day);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchTargets(propertyIds: string[] | null, periodStart: string): Promise<CommandTargets> {
  let q = supabase
    .from("property_targets")
    .select("property_id, cpl_target, cpgl_target, monthly_ad_budget")
    .eq("period_start", periodStart);
  if (propertyIds) q = q.in("property_id", propertyIds);
  const { data, error } = await q;
  if (error) return DEFAULT_COMMAND_TARGETS;

  const rows = (data ?? []) as any[];
  const cplTargets = rows.map((r) => Number(r.cpl_target ?? 0)).filter((n) => n > 0);
  const cpglTargets = rows.map((r) => Number(r.cpgl_target ?? 0)).filter((n) => n > 0);
  const monthlyBudgets = rows.map((r) => Number(r.monthly_ad_budget ?? 0)).filter((n) => n > 0);
  const avg = (vals: number[], fallback: number) => vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : fallback;
  const cpgl = avg(cpglTargets, DEFAULT_COMMAND_TARGETS.cpgl);
  const projectionRate = DEFAULT_COMMAND_TARGETS.projectionRate;

  return {
    cpl: avg(cplTargets, DEFAULT_COMMAND_TARGETS.cpl),
    cpgl,
    qualRate: DEFAULT_COMMAND_TARGETS.qualRate,
    projectionRate,
    costPerProjected: cpgl / projectionRate,
    monthlyBudget: monthlyBudgets.length ? monthlyBudgets.reduce((a, b) => a + b, 0) : null,
  };
}

export function totalsOf(rows: DailyAgg[]): Totals {
  let spend = 0, calls = 0, good = 0, bad = 0, projected = 0, verified = 0;
  for (const r of rows) {
    spend += r.cost;
    calls += r.calls;
    good += r.good_leads;
    bad += r.bad_leads;
    projected += r.projected_sale;
    verified += r.verified_sale;
  }
  const counts: LeadCounts = { bad, good, projected, verified };
  return {
    spend,
    calls,
    // Legacy aliases preserved for surfaces still wired to them.
    qualifiedCalls: good,
    appointments: projected,
    revenue: verified,
    // Canonical model — all lead totals/quality flow through leadModel.ts.
    good,
    projected,
    bad,
    totalLeads: canonicalTotalLeads(counts),
    qualityRate: canonicalQualityRate(counts),
  };
}

export function useCommandData(
  propertyIds: string[] | null,
  range: DateRange,
  compareRange: DateRange | null,
) {
  const iso = rangeToISO(range);
  const cmpIso = compareRange ? rangeToISO(compareRange) : rangeToISO(priorRange(range));
  const periodStart = `${iso.from.slice(0, 7)}-01`;

  const key = propertyIds?.join(",") ?? "all";

  const current = useQuery({
    queryKey: ["command-window", key, iso.from, iso.to],
    queryFn: () => fetchWindow(propertyIds, iso.from, iso.to),
  });
  const prior = useQuery({
    queryKey: ["command-window", key, cmpIso.from, cmpIso.to],
    queryFn: () => fetchWindow(propertyIds, cmpIso.from, cmpIso.to),
  });
  const targets = useQuery({
    queryKey: ["command-targets", key, periodStart],
    queryFn: () => fetchTargets(propertyIds, periodStart),
  });

  // CTM call-score distribution for AI Quality card (we have buckets but they
  // are lead-quality buckets, not AI Excellent/Good/Average/Poor — surface
  // raw bucket counts and let the card decide what to render).
  const buckets = useQuery({
    queryKey: ["command-buckets", key, iso.from, iso.to],
    queryFn: async () => {
      let q = supabase
        .from("ctm_calls")
        .select("call_score_bucket, call_score_label")
        .gte("called_at", `${iso.from}T00:00:00.000Z`)
        .lte("called_at", `${iso.to}T23:59:59.999Z`);
      if (propertyIds) q = q.in("property_id", propertyIds);
      const { data, error } = await q;
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as any[]) {
        const k = (row.call_score_bucket as string | null) ?? "unscored";
        counts[k] = (counts[k] ?? 0) + 1;
      }
      return counts;
    },
  });

  return {
    isLoading: current.isLoading || prior.isLoading,
    currentDaily: current.data ?? [],
    priorDaily: prior.data ?? [],
    current: totalsOf(current.data ?? []),
    prior: totalsOf(prior.data ?? []),
    targets: targets.data ?? DEFAULT_COMMAND_TARGETS,
    buckets: buckets.data ?? {},
    bucketsLoading: buckets.isLoading,
    compareRangeIso: cmpIso,
  };
}