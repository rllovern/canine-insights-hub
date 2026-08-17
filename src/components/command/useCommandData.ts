import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { eachDateISO, rangeToISO, priorRange, type DateRange } from "@/lib/metrics";
import { totalLeads as canonicalTotalLeads, qualityRate as canonicalQualityRate, type LeadCounts } from "@/lib/leadModel";
import { fetchVerifiedSalesByDate } from "@/lib/verified-sales";
import { buildCampaignScope, isRowInScope, PPC_SOURCE, type CampaignLabelRow } from "@/lib/campaignScope";

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
  /** Won-deal count from the CRM (`ghl_opportunities`, status = 'won').
   * Distinct from `projected` (CTM AI-projected count kept only for quality-rate math). */
  sales: number;
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

async function fetchCampaignLabels(propertyIds: string[] | null): Promise<CampaignLabelRow[]> {
  if (!propertyIds || propertyIds.length === 0) return [];
  const { data, error } = await supabase
    .from("campaign_labels")
    .select("property_id, campaign")
    .in("property_id", propertyIds);
  if (error) throw error;
  return (data ?? []) as CampaignLabelRow[];
}

function zeroDay(date: string): DailyAgg {
  return { date, cost: 0, good_leads: 0, bad_leads: 0, projected_sale: 0, verified_sale: 0, calls: 0 };
}

async function fetchWindow(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<DailyAgg[]> {
  // daily_metrics: cost + leads + sales.
  // Apply the same scope rules the source/campaign report below uses so the
  // top-of-report KPI reconciles with the source breakdown:
  //  - Exclude the `GHL Won` disposition feed (not a media source).
  //  - For PPC rows on properties that ship a `campaign_labels` allow-list
  //    (shared Google Ads accounts like Winchester / NoVA), only count
  //    campaigns labeled to this location.
  const labels = await fetchCampaignLabels(propertyIds);

  // Records (calls + forms) come from the SAME rows as the leads/cost totals
  // so the KPI cards and the source breakdown can never diverge. No Entry /
  // Spam / Bad / Good / sales are slices INSIDE records, never additions.
  let dm = supabase
    .from("daily_metrics")
    .select("date, property_id, ad_source, campaign, cost, impressions, clicks, record_count, good_leads, bad_leads, projected_sale, verified_sale")
    .neq("ad_source", "GHL Won")
    .gte("date", from)
    .lte("date", to);
  if (propertyIds) dm = dm.in("property_id", propertyIds);
  const dmRes = await dm;
  if (dmRes.error) throw dmRes.error;

  const rows = (dmRes.data ?? []) as any[];
  const scope = buildCampaignScope(labels, rows);

  const map = new Map<string, DailyAgg>();
  for (const d of eachDateISO(new Date(from), new Date(to))) map.set(d, zeroDay(d));
  for (const r of rows) {
    if (!isRowInScope(r, scope)) continue;
    const day = map.get(r.date) ?? zeroDay(r.date);
    day.cost += Number(r.cost ?? 0);
    day.good_leads += Number(r.good_leads ?? 0);
    day.bad_leads += Number(r.bad_leads ?? 0);
    day.projected_sale += Number(r.projected_sale ?? 0);
    day.verified_sale += Number(r.verified_sale ?? 0);
    // `calls` is kept as the internal field name to avoid a wide rename;
    // semantically it holds Records = calls + forms.
    day.calls += Number(r.record_count ?? 0);
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
    appointments: verified,
    revenue: verified,
    // Canonical model — all lead totals/quality flow through leadModel.ts.
    good,
    projected,
    bad,
    totalLeads: canonicalTotalLeads(counts),
    qualityRate: canonicalQualityRate(counts),
    // Google-Sheet-imported sales count. Display-facing "Sales" everywhere
    // (except Call Tracking) reads this. Quality-rate math stays on
    // `projected` (CTM AI-projected) to preserve the transcript-based signal.
    sales: verified,
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
  // Shared Google Ads accounts (NoVA / Winchester) scope PPC rows through
  // campaign_labels. Call-tracking rows under Google PPC carry no spend
  // signals and are never in the allow-list, so they always pass through.
  const labels = await fetchCampaignLabels(propertyIds);

  let q = supabase
    .from("daily_metrics")
    .select("date, property_id, ad_source, campaign, cost, impressions, clicks, good_leads, bad_leads, projected_sale, verified_sale, record_count")
    .eq("ad_source", PPC_SOURCE)
    .gte("date", from)
    .lte("date", to);
  if (propertyIds) q = q.in("property_id", propertyIds);
  const res = await q;
  if (res.error) throw res.error;

  const rows = (res.data ?? []) as any[];
  const scope = buildCampaignScope(labels, rows);

  const map = new Map<string, DailyAgg>();
  for (const d of eachDateISO(new Date(from), new Date(to))) map.set(d, zeroDay(d));
  for (const r of rows) {
    if (!isRowInScope(r, scope)) continue;
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
    queryFn: async () => {
      const [rows, sales] = await Promise.all([
        fetchWindow(propertyIds, iso.from, iso.to),
        fetchVerifiedSalesByDate(propertyIds, iso.from, iso.to),
      ]);
      return rows.map((r) => ({ ...r, verified_sale: sales[r.date] ?? 0 }));
    },
  });
  const prior = useQuery({
    queryKey: ["command-window", key, cmpIso.from, cmpIso.to],
    queryFn: async () => {
      const [rows, sales] = await Promise.all([
        fetchWindow(propertyIds, cmpIso.from, cmpIso.to),
        fetchVerifiedSalesByDate(propertyIds, cmpIso.from, cmpIso.to),
      ]);
      return rows.map((r) => ({ ...r, verified_sale: sales[r.date] ?? 0 }));
    },
  });
  const targets = useQuery({
    queryKey: ["command-targets", key, periodStart],
    queryFn: () => fetchTargets(propertyIds, periodStart),
  });

  // Ads (Google PPC) parallel queries — fetched alongside Business so the
  // mode toggle is instant and Media Efficiency Ratio can render either way.
  const ppcCurrent = useQuery({
    queryKey: ["command-ppc-window", key, iso.from, iso.to],
    queryFn: async () => {
      const [rows, sales] = await Promise.all([
        fetchPpcWindow(propertyIds, iso.from, iso.to),
        fetchVerifiedSalesByDate(propertyIds, iso.from, iso.to),
      ]);
      return rows.map((r) => ({ ...r, verified_sale: sales[r.date] ?? 0 }));
    },
  });
  const ppcPrior = useQuery({
    queryKey: ["command-ppc-window", key, cmpIso.from, cmpIso.to],
    queryFn: async () => {
      const [rows, sales] = await Promise.all([
        fetchPpcWindow(propertyIds, cmpIso.from, cmpIso.to),
        fetchVerifiedSalesByDate(propertyIds, cmpIso.from, cmpIso.to),
      ]);
      return rows.map((r) => ({ ...r, verified_sale: sales[r.date] ?? 0 }));
    },
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