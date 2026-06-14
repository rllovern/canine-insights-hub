import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowUpRight, Building2, Globe2, AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useProperties } from "@/contexts/PropertyContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { fmtCurrency, fmtNumber } from "@/lib/metrics";
import { cpl, ratio, sumField } from "@/lib/scopedMetrics";
import { cn } from "@/lib/utils";

type DailyRow = {
  property_id: string;
  date: string;
  cost: number | null;
  impressions: number | null;
  clicks: number | null;
  good_leads: number | null;
  bad_leads: number | null;
};

function dotClass(severity: "good" | "warning" | "critical" | "neutral") {
  switch (severity) {
    case "good": return "bg-emerald-500";
    case "warning": return "bg-amber-500";
    case "critical": return "bg-rose-500";
    default: return "bg-muted-foreground/40";
  }
}

function pacingSeverity(spend: number, budget: number, pctMonthElapsed: number): "good" | "warning" | "critical" | "neutral" {
  if (!budget) return "neutral";
  const pace = spend / budget;
  const delta = pace - pctMonthElapsed;
  if (Math.abs(delta) <= 0.15) return "good";
  if (Math.abs(delta) <= 0.25) return "warning";
  return "critical";
}

function cplSeverity(value: number, target: number | null): "good" | "warning" | "critical" | "neutral" {
  if (!value || !target) return "neutral";
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

export default function Command() {
  const { mode, propertyIds, propertyId, label } = useScope();
  const { range } = useDateRange();
  const { properties } = useProperties();

  const fromIso = range.from.toISOString().slice(0, 10);
  const toIso = range.to.toISOString().slice(0, 10);

  const q = useQuery({
    queryKey: ["command-daily", propertyIds?.join(",") ?? "all", fromIso, toIso],
    queryFn: async (): Promise<DailyRow[]> => {
      let query = supabase.from("daily_metrics").select("property_id, date, cost, impressions, clicks, good_leads, bad_leads")
        .gte("date", fromIso).lte("date", toIso);
      if (propertyIds) query = query.in("property_id", propertyIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DailyRow[];
    },
  });

  const rows = q.data ?? [];

  const portfolio = useMemo(() => {
    const spend = sumField(rows, "cost");
    const goodLeads = sumField(rows, "good_leads");
    const badLeads = sumField(rows, "bad_leads");
    const clicks = sumField(rows, "clicks");
    const impressions = sumField(rows, "impressions");
    const totalLeads = goodLeads + badLeads;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const pctMonth = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
    return {
      spend, goodLeads, badLeads, totalLeads, clicks, impressions,
      blendedCpl: cpl(spend, goodLeads),
      qualRate: ratio(goodLeads, totalLeads),
      pctMonth,
    };
  }, [rows]);

  const locationGrid = useMemo(() => {
    const byProperty = new Map<string, { spend: number; goodLeads: number; badLeads: number }>();
    for (const r of rows) {
      const cur = byProperty.get(r.property_id) ?? { spend: 0, goodLeads: 0, badLeads: 0 };
      cur.spend += r.cost ?? 0;
      cur.goodLeads += r.good_leads ?? 0;
      cur.badLeads += r.bad_leads ?? 0;
      byProperty.set(r.property_id, cur);
    }
    const visible = mode === "property" && propertyId
      ? properties.filter((p) => p.id === propertyId)
      : properties;
    const items = visible.map((p) => {
      const agg = byProperty.get(p.id) ?? { spend: 0, goodLeads: 0, badLeads: 0 };
      const totalLeads = agg.goodLeads + agg.badLeads;
      const pacing = pacingSeverity(agg.spend, /* budget unknown here */ 0, portfolio.pctMonth);
      const cplValue = cpl(agg.spend, agg.goodLeads);
      const cplSev = cplSeverity(cplValue, null);
      const handlingSev = handlingSeverity(agg.goodLeads, totalLeads);
      const worst = [pacing, cplSev, handlingSev].sort((a, b) => severityRank(a) - severityRank(b))[0];
      return { property: p, agg, totalLeads, cplValue, pacing, cplSev, handlingSev, worst };
    });
    return items.sort((a, b) => severityRank(a.worst) - severityRank(b.worst));
  }, [rows, properties, mode, propertyId, portfolio.pctMonth]);

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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Metric label="Spend" value={fmtCurrency(portfolio.spend)} />
            <Metric label="Good leads" value={fmtNumber(portfolio.goodLeads)} />
            <Metric label="Total leads" value={fmtNumber(portfolio.totalLeads)} />
            <Metric label="Blended CPL" value={portfolio.blendedCpl ? fmtCurrency(portfolio.blendedCpl) : "—"} />
            <Metric label="Qual rate" value={portfolio.totalLeads ? `${(portfolio.qualRate * 100).toFixed(0)}%` : "—"} />
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Month elapsed: {(portfolio.pctMonth * 100).toFixed(0)}%. Rates computed as Σ numerator ÷ Σ denominator across scope.
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
                    {fmtCurrency(row.agg.spend)} spend · {fmtNumber(row.agg.goodLeads)} good leads · CPL {row.cplValue ? fmtCurrency(row.cplValue) : "—"}
                  </div>
                </div>
                <DotGroup pacing={row.pacing} cpl={row.cplSev} handling={row.handlingSev} />
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function DotGroup({ pacing, cpl, handling }: {
  pacing: "good" | "warning" | "critical" | "neutral";
  cpl: "good" | "warning" | "critical" | "neutral";
  handling: "good" | "warning" | "critical" | "neutral";
}) {
  return (
    <div className="flex items-center gap-1.5" title="pacing · CPL · handling">
      <span className={cn("size-2.5 rounded-full", dotClass(pacing))} title={`pacing: ${pacing}`} />
      <span className={cn("size-2.5 rounded-full", dotClass(cpl))} title={`CPL: ${cpl}`} />
      <span className={cn("size-2.5 rounded-full", dotClass(handling))} title={`handling: ${handling}`} />
    </div>
  );
}