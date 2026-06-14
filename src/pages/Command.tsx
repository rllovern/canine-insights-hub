import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowUpRight, Building2, Globe2, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useProperties } from "@/contexts/PropertyContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { fmtCurrency, fmtNumber } from "@/lib/metrics";
import { cpl, cpgl, ratio, sumField } from "@/lib/scopedMetrics";
import { cn } from "@/lib/utils";

/**
 * Denominator rule (locked in Step 2 AC-1):
 *   total_leads = good_leads + bad_leads + projected_sale
 * Defined here once, read everywhere. Do not introduce a second definition.
 */
const PACING_GOOD_BAND = 0.15;
const PACING_WARN_BAND = 0.25;

type DailyRow = {
  property_id: string;
  date: string;
  cost: number | null;
  impressions: number | null;
  clicks: number | null;
  good_leads: number | null;
  bad_leads: number | null;
  projected_sale: number | null;
  verified_sale: number | null;
};

type TargetRow = {
  property_id: string;
  period_start: string;
  cpl_target: number | null;
  cpgl_target: number | null;
  monthly_ad_budget: number | null;
  monthly_good_leads_goal: number | null;
};

function dotClass(severity: "good" | "warning" | "critical" | "neutral") {
  switch (severity) {
    case "good": return "bg-emerald-500";
    case "warning": return "bg-amber-500";
    case "critical": return "bg-rose-500";
    default: return "bg-muted-foreground/40";
  }
}

// Signed, window-aware pacing severity.
// Compare actual spend in the window against expected spend in the SAME window
// (daily_budget × days_in_selected_window). delta = (actual − expected)/expected.
//   |delta| ≤ 5pt → good (on pace)
//   delta > +15pt → critical (overspend)
//   delta > +5pt  → warning (mild overspend)
//   delta < −5pt  → warning at most (underdelivering; never critical)
function pacingSeverity(spend: number, expectedSpend: number): "good" | "warning" | "critical" | "neutral" {
  if (!expectedSpend) return "neutral";
  const delta = (spend - expectedSpend) / expectedSpend;
  if (Math.abs(delta) <= 0.05) return "good";
  if (delta > 0.15) return "critical";
  return "warning";
}

function cplSeverity(value: number, target: number | null): "good" | "warning" | "critical" | "neutral" {
  if (!target) return "neutral";
  if (!value) return "neutral";
  if (value <= target) return "good";
  if (value <= target * 1.25) return "warning";
  return "critical";
}

function handlingSeverity(goodLeads: number, totalLeads: number): "good" | "warning" | "critical" | "neutral" {
  if (!totalLeads) return "neutral";
  const qual = goodLeads / totalLeads;
  if (qual >= 0.5) return "good";
  if (qual >= 0.25) return "warning";
  return "critical";
}

function severityRank(s: "good" | "warning" | "critical" | "neutral"): number {
  return { critical: 0, warning: 1, neutral: 2, good: 3 }[s];
}

type Sev = "good" | "warning" | "critical" | "neutral";

function rollupHealth(dims: { key: string; label: string; sev: Sev; reason?: string }[]): {
  sev: Sev;
  failing: { label: string; reason?: string }[];
} {
  const assessable = dims.filter((d) => d.sev !== "neutral");
  if (assessable.length === 0) return { sev: "neutral", failing: [] };
  const criticals = assessable.filter((d) => d.sev === "critical");
  if (criticals.length > 0) return { sev: "critical", failing: criticals.map((d) => ({ label: d.label, reason: d.reason })) };
  const warns = assessable.filter((d) => d.sev === "warning");
  if (warns.length > 0) return { sev: "warning", failing: warns.map((d) => ({ label: d.label, reason: d.reason })) };
  return { sev: "good", failing: [] };
}

function healthLabel(s: Sev): string {
  return s === "good" ? "Healthy" : s === "warning" ? "Warning" : s === "critical" ? "Critical" : "No target set";
}

export default function Command() {
  const { mode, propertyIds, propertyId, label } = useScope();
  const { range, rangePreset } = useDateRange();
  const { properties } = useProperties();

  const fromIso = range.from.toISOString().slice(0, 10);
  const toIso = range.to.toISOString().slice(0, 10);

  const q = useQuery({
    queryKey: ["command-daily", propertyIds?.join(",") ?? "all", fromIso, toIso],
    queryFn: async (): Promise<DailyRow[]> => {
      let query = supabase.from("daily_metrics").select("property_id, date, cost, impressions, clicks, good_leads, bad_leads, projected_sale, verified_sale")
        .gte("date", fromIso).lte("date", toIso);
      if (propertyIds) query = query.in("property_id", propertyIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DailyRow[];
    },
  });

  const periodStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }, []);

  const targetsQ = useQuery({
    queryKey: ["command-targets", propertyIds?.join(",") ?? "all", periodStart],
    queryFn: async (): Promise<TargetRow[]> => {
      let query = supabase
        .from("property_targets")
        .select("property_id, period_start, cpl_target, cpgl_target, monthly_ad_budget, monthly_good_leads_goal")
        .eq("period_start", periodStart);
      if (propertyIds) query = query.in("property_id", propertyIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    },
  });

  const targetsByProperty = useMemo(() => {
    const m = new Map<string, TargetRow>();
    for (const t of targetsQ.data ?? []) m.set(t.property_id, t);
    return m;
  }, [targetsQ.data]);

  const rows = q.data ?? [];

  const portfolio = useMemo(() => {
    const spend = sumField(rows, "cost");
    const goodLeads = sumField(rows, "good_leads");
    const badLeads = sumField(rows, "bad_leads");
    const projectedSale = sumField(rows, "projected_sale");
    const verifiedSale = sumField(rows, "verified_sale");
    const clicks = sumField(rows, "clicks");
    const impressions = sumField(rows, "impressions");
    const totalLeads = goodLeads + badLeads + projectedSale;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const pctMonth = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
    const daysInCurrentMonth = end.getDate();
    // Single window source: derive days_in_selected_window from the same
    // date-range the actual-spend query uses. Inclusive of both ends.
    const daysInWindow = Math.max(
      1,
      Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1,
    );
    const windowFraction = daysInWindow / daysInCurrentMonth;
    const totalBudget = (targetsQ.data ?? []).reduce((s, t) => s + (t.monthly_ad_budget ?? 0), 0);
    const totalGoal = (targetsQ.data ?? []).reduce((s, t) => s + (t.monthly_good_leads_goal ?? 0), 0);
    return {
      spend, goodLeads, badLeads, projectedSale, verifiedSale, totalLeads, clicks, impressions,
      cplValue: cpl(spend, totalLeads),
      cpglValue: cpgl(spend, goodLeads),
      qualRate: ratio(goodLeads, totalLeads),
      pctMonth,
      daysInWindow,
      daysInCurrentMonth,
      windowFraction,
      expectedSpend: totalBudget ? totalBudget * windowFraction : 0,
      expectedGoodLeads: totalGoal ? totalGoal * windowFraction : 0,
      totalBudget,
      totalGoal,
    };
  }, [rows, targetsQ.data, range.from, range.to]);

  const locationGrid = useMemo(() => {
    const byProperty = new Map<string, { spend: number; goodLeads: number; badLeads: number; projectedSale: number; verifiedSale: number }>();
    for (const r of rows) {
      const cur = byProperty.get(r.property_id) ?? { spend: 0, goodLeads: 0, badLeads: 0, projectedSale: 0, verifiedSale: 0 };
      cur.spend += r.cost ?? 0;
      cur.goodLeads += r.good_leads ?? 0;
      cur.badLeads += r.bad_leads ?? 0;
      cur.projectedSale += r.projected_sale ?? 0;
      cur.verifiedSale += r.verified_sale ?? 0;
      byProperty.set(r.property_id, cur);
    }
    const visible = mode === "property" && propertyId
      ? properties.filter((p) => p.id === propertyId)
      : properties;
    const isCustom = rangePreset === "custom";
    const items = visible.map((p) => {
      const agg = byProperty.get(p.id) ?? { spend: 0, goodLeads: 0, badLeads: 0, projectedSale: 0, verifiedSale: 0 };
      const totalLeads = agg.goodLeads + agg.badLeads + agg.projectedSale;
      const target = targetsByProperty.get(p.id);
      const budget = target?.monthly_ad_budget ?? 0;
      const cplTarget = target?.cpl_target ?? null;
      const cpglTarget = target?.cpgl_target ?? null;
      const expectedSpend = budget ? budget * portfolio.windowFraction : 0;
      const pacing: Sev = isCustom && budget
        ? "neutral"
        : pacingSeverity(agg.spend, expectedSpend);
      const cplValue = cpl(agg.spend, totalLeads);
      const cpglValue = cpgl(agg.spend, agg.goodLeads);
      const cplSev = cplSeverity(cplValue, cplTarget);
      const cpglSev = cplSeverity(cpglValue, cpglTarget);
      const handlingSev = handlingSeverity(agg.goodLeads, totalLeads);
      const qual = totalLeads ? agg.goodLeads / totalLeads : 0;
      const paceDeltaPt = expectedSpend ? ((agg.spend - expectedSpend) / expectedSpend) * 100 : 0;
      const paceDirection = paceDeltaPt > 0 ? "over" : "under";
      const dims: { key: string; label: string; sev: Sev; reason?: string }[] = [
        {
          key: "pacing",
          label: "Pacing",
          sev: pacing,
          reason: !budget
            ? undefined
            : isCustom
              ? "Pacing: select MTD or a trailing window"
              : `${fmtCurrency(agg.spend)} spent vs ${fmtCurrency(expectedSpend)} expected over ${portfolio.daysInWindow}d — ${Math.abs(paceDeltaPt).toFixed(0)}pt ${paceDirection} pace`,
        },
        {
          key: "cpl",
          label: "CPL",
          sev: cplSev,
          reason: cplTarget && cplValue ? `${fmtCurrency(cplValue)} vs ${fmtCurrency(cplTarget)} target` : undefined,
        },
        {
          key: "cpgl",
          label: "CPGL",
          sev: cpglSev,
          reason: cpglTarget && cpglValue ? `${fmtCurrency(cpglValue)} vs ${fmtCurrency(cpglTarget)} target` : undefined,
        },
        {
          key: "handling",
          label: "Handling",
          sev: handlingSev,
          reason: totalLeads ? `${(qual * 100).toFixed(0)}% qual rate (${fmtNumber(agg.goodLeads)} / ${fmtNumber(totalLeads)})` : undefined,
        },
      ];
      const health = rollupHealth(dims);
      const worst = [pacing, cplSev, cpglSev, handlingSev].sort((a, b) => severityRank(a) - severityRank(b))[0];
      return { property: p, agg, totalLeads, cplValue, cpglValue, cplTarget, cpglTarget, budget, pacing, cplSev, cpglSev, handlingSev, worst, dims, health };
    });
    return items.sort((a, b) => severityRank(a.health.sev) - severityRank(b.health.sev));
  }, [rows, properties, mode, propertyId, portfolio.windowFraction, portfolio.daysInWindow, rangePreset, targetsByProperty]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2.5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            {mode === "agency" ? <Globe2 className="size-4 text-primary" /> : <Building2 className="size-4 text-primary" />}
            Command
          </h1>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">
            {label} · {format(range.from, "MMM d")} – {format(range.to, "MMM d, yyyy")}
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">Phase 1 · portfolio + status grid</Badge>
      </div>

      {/* Portfolio summary */}
      <Card className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Portfolio</div>
        {q.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
            <Metric
              label="Spend"
              value={fmtCurrency(portfolio.spend)}
              sub={portfolio.totalBudget ? `of ${fmtCurrency(portfolio.expectedSpend)} expected` : undefined}
            />
            <Metric
              label="Good leads"
              value={fmtNumber(portfolio.goodLeads)}
              sub={portfolio.totalGoal ? `of ${fmtNumber(Math.round(portfolio.expectedGoodLeads))} expected` : undefined}
            />
            <Metric label="Total leads" value={fmtNumber(portfolio.totalLeads)} />
            <Metric label="Projected sales" value={fmtNumber(portfolio.projectedSale)} sub="CTM AI projection" />
            <Metric label="Verified sales" value="—" sub="Close data not yet piped" />
            <Metric label="CPL" value={portfolio.cplValue ? fmtCurrency(portfolio.cplValue) : "—"} />
            <Metric label="CPGL" value={portfolio.cpglValue ? fmtCurrency(portfolio.cpglValue) : "—"} />
            <Metric label="Qual rate" value={portfolio.totalLeads ? `${(portfolio.qualRate * 100).toFixed(0)}%` : "—"} />
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Month elapsed: {(portfolio.pctMonth * 100).toFixed(0)}%. Rates computed as Σ numerator ÷ Σ denominator across scope.
          Total leads = good + bad + projected sale. Projected sales are provisional CTM AI transcript projections; verified sales come only from GHL Won and show as unavailable until close data is piped.
        </p>
      </Card>

      {/* Location status grid */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Location status</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", dotClass("good"))} /> good</span>
            <span className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", dotClass("warning"))} /> warn</span>
            <span className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", dotClass("critical"))} /> critical</span>
            <span className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", dotClass("neutral"))} /> no target</span>
          </div>
        </div>
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : locationGrid.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No properties in scope.</div>
        ) : (
          <div className="divide-y divide-border">
            {locationGrid.map((row) => (
              <div key={row.property.id} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{row.property.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {fmtCurrency(row.agg.spend)} spend · {fmtNumber(row.totalLeads)} total leads · {fmtNumber(row.agg.goodLeads)} good leads · {fmtNumber(row.agg.projectedSale)} projected sales · verified sales unavailable
                    <span className="block text-muted-foreground/70">
                      CPL {row.cplValue ? fmtCurrency(row.cplValue) : "—"}{row.cplTarget ? ` target ${fmtCurrency(row.cplTarget)}` : " target unset"} · CPGL {row.cpglValue ? fmtCurrency(row.cpglValue) : "—"}{row.cpglTarget ? ` target ${fmtCurrency(row.cpglTarget)}` : " target unset"}
                    </span>
                  </div>
                </div>
                <HealthDot health={row.health} dims={row.dims} />
                <Link
                  to={`/lead-performance`}
                  className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Open <ArrowUpRight className="size-3" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Error feed placeholder — Step 3 */}
      <Card className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Error feed</div>
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <MinusCircle className="size-4" />
          Error feed (Lanes A + B) ships in Step 3 of the Command Layer build.
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function DotGroup({ pacing, cpl, cpgl, handling }: {
  pacing: "good" | "warning" | "critical" | "neutral";
  cpl: "good" | "warning" | "critical" | "neutral";
  cpgl: "good" | "warning" | "critical" | "neutral";
  handling: "good" | "warning" | "critical" | "neutral";
}) {
  return (
    <div className="flex items-center gap-1.5" title="pacing · CPL · CPGL · handling">
      <span className={cn("size-2.5 rounded-full", dotClass(pacing))} title={`pacing: ${pacing}`} />
      <span className={cn("size-2.5 rounded-full", dotClass(cpl))} title={`CPL: ${cpl}`} />
      <span className={cn("size-2.5 rounded-full", dotClass(cpgl))} title={`CPGL: ${cpgl}`} />
      <span className={cn("size-2.5 rounded-full", dotClass(handling))} title={`handling: ${handling}`} />
    </div>
  );
}

function HealthDot({
  health,
  dims,
}: {
  health: { sev: Sev; failing: { label: string; reason?: string }[] };
  dims: { key: string; label: string; sev: Sev; reason?: string }[];
}) {
  const verdict = healthLabel(health.sev);
  const failingLine =
    health.failing.length > 0
      ? `${verdict}: ${health.failing
          .map((f) => (f.reason ? `${f.label} ${f.reason}` : f.label))
          .join(", ")}`
      : health.sev === "good"
        ? "All assessable dimensions within target."
        : "No targets set for this location.";
  return (
    <HoverCard openDelay={80} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={failingLine}
          className="inline-flex items-center justify-center rounded-full p-1 hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <span className={cn("size-3 rounded-full ring-1 ring-border", dotClass(health.sev))} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72 p-3 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{verdict}</div>
        <div className="text-xs">{failingLine}</div>
        <div className="pt-2 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Breakdown</div>
          <ul className="space-y-1">
            {dims.map((d) => (
              <li key={d.key} className="flex items-start gap-2 text-[11px]">
                <span className={cn("size-2 rounded-full mt-1 shrink-0", dotClass(d.sev))} />
                <span className="font-medium w-16 shrink-0">{d.label}</span>
                <span className="text-muted-foreground">{d.reason ?? "no target set"}</span>
              </li>
            ))}
          </ul>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}