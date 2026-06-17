import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { eachDateISO, rangeToISO, priorRange, type DateRange } from "@/lib/metrics";
import { totalLeads as canonicalTotalLeads, qualityRate as canonicalQualityRate, type LeadCounts } from "@/lib/leadModel";

export type CommandMode = "business" | "ads";

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

const PPC_SOURCE = "Google PPC";

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

  // Records superset (calls + forms) — canonical source for the funnel's
  // top stage. No Entry / Spam / Bad / Good / AI-projected are slices
  // INSIDE records, never additions on top. Counting ctm_calls rows here
  // would double-count by stacking call rows on top of records.
  let rc = supabase
    .from("v_lead_counts_daily")
    .select("date, records")
    .gte("date", from)
    .lte("date", to);
  if (propertyIds) rc = rc.in("property_id", propertyIds);
  const rcRes = await rc;
  if (rcRes.error) throw rcRes.error;

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
  for (const r of (rcRes.data ?? []) as any[]) {
    const day = map.get(r.date) ?? zeroDay(r.date);
    // `calls` is kept as the internal field name to avoid a wide rename;
    // semantically it now holds Records = calls + forms.
    day.calls += Number(r.records ?? 0);
    map.set(r.date, day);
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

/**
 * Fetch PPC-only daily slice from daily_metrics for the given window.
 * `calls` is filled from daily_metrics.record_count (PPC-attributed records
 * — v_lead_counts_daily isn't source-split today).
 */
async function fetchPpcWindow(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<DailyAgg[]> {
  // Build the allowed campaign set from campaign_labels so PPC rows that
  // belong to a different location are excluded from the Ads view. If a property has no
  // labels, we don't filter — that keeps locations without a mapping working.
  let allowed: Set<string> | null = null;
  if (propertyIds && propertyIds.length > 0) {
    const { data: labels, error: labelErr } = await supabase
      .from("campaign_labels")
      .select("campaign")
      .in("property_id", propertyIds);
    if (labelErr) throw labelErr;
    if (labels && labels.length > 0) {
      allowed = new Set((labels as any[]).map((r) => r.campaign as string));
    }
  }

  let q = supabase
    .from("daily_metrics")
    .select("date, campaign, cost, good_leads, bad_leads, projected_sale, verified_sale, record_count")
    .eq("ad_source", PPC_SOURCE)
    .gte("date", from)
    .lte("date", to);
  if (propertyIds) q = q.in("property_id", propertyIds);
  if (allowed && allowed.size > 0) {
    q = q.in("campaign", Array.from(allowed));
  }
  const res = await q;
  if (res.error) throw res.error;

  const map = new Map<string, DailyAgg>();
  for (const d of eachDateISO(new Date(from), new Date(to))) map.set(d, zeroDay(d));
  for (const r of (res.data ?? []) as any[]) {
    const day = map.get(r.date) ?? zeroDay(r.date);
    day.cost += Number(r.cost ?? 0);
    day.good_leads += Number(r.good_leads ?? 0);
    day.bad_leads += Number(r.bad_leads ?? 0);
    day.projected_sale += Number(r.projected_sale ?? 0);
    day.verified_sale += Number(r.verified_sale ?? 0);
    day.calls += Number(r.record_count ?? 0);
    map.set(r.date, day);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
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

  // Ads (Google PPC) parallel queries — fetched alongside Business so the
  // mode toggle is instant and Media Efficiency Ratio can render either way.
  const ppcCurrent = useQuery({
    queryKey: ["command-ppc-window", key, iso.from, iso.to],
    queryFn: () => fetchPpcWindow(propertyIds, iso.from, iso.to),
  });
  const ppcPrior = useQuery({
    queryKey: ["command-ppc-window", key, cmpIso.from, cmpIso.to],
    queryFn: () => fetchPpcWindow(propertyIds, cmpIso.from, cmpIso.to),
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
    // Ads-mode parallel slice.
    adsCurrentDaily: ppcCurrent.data ?? [],
    adsPriorDaily: ppcPrior.data ?? [],
    adsCurrent: totalsOf(ppcCurrent.data ?? []),
    adsPrior: totalsOf(ppcPrior.data ?? []),
    adsLoading: ppcCurrent.isLoading || ppcPrior.isLoading,
  };
}