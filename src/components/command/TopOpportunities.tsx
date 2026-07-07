import { Link } from "react-router-dom";
import { Info, AlertOctagon, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SpeedData } from "@/components/lead-perf/hooks";
import type { CommandTargets, Totals } from "./useCommandData";
import { DEFAULT_COMMAND_TARGETS } from "./useCommandData";
import { TIPS } from "./tooltips";
import { CARD_CHROME } from "./cardChrome";
import { cn } from "@/lib/utils";
import {
  qualityRate as canonicalQualityRate,
  qualityNumerator,
  totalLeads as canonicalTotalLeads,
  qualityTier,
  QUALITY_TARGETS,
  LOW_SAMPLE_CAVEAT,
  formatQualityRate,
  type LeadCounts,
} from "@/lib/leadModel";

type Op = { label: string; severity: "critical" | "warning"; why: string; href: string; formula: string };
type Flag = { label: string; severity: "critical" | "warning"; why: string; href: string };

export function TopOpportunities({ totals, speed, targets = DEFAULT_COMMAND_TARGETS }: { totals: Totals; speed: SpeedData | null; targets?: CommandTargets }) {
  const ops: Op[] = [];
  // Cost-impact formula is intentionally not rendered as dollars yet.
  // Anchoring rule: impact may render only after the unit cost, source counts,
  // target rate, and source freshness are all attributable and stable. The prior
  // formula mixed live period spend with fallback conversion constants, which is
  // why opportunity dollars could swing by ~200x between builds.

  // Lead-quality gap — judged on canonical (good + sales) ÷ total
  // tiers from leadModel.ts. Never good ÷ calls (that's the banned
  // record-denominator that caused the false "Critical" verdict).
  const counts: LeadCounts = { bad: totals.bad, good: totals.good, projected: totals.projected };
  const base = canonicalTotalLeads(counts);
  const rate = canonicalQualityRate(counts);
  const tier = qualityTier(rate, base);
  // Guard: provisional samples (above the suppression floor but below the
  // caveat threshold) are informational only — never fire opportunities.
  if ((tier === "amber" || tier === "red") && base >= LOW_SAMPLE_CAVEAT) {
    const gap = Math.max(0, Math.round(base * QUALITY_TARGETS.green - qualityNumerator(counts)));
    ops.push({
      label: "Improve Lead Quality",
      severity: tier === "red" ? "critical" : "warning",
      why: `${formatQualityRate(rate)} quality ((good + sales) ÷ ${base} leads). Target ${formatQualityRate(QUALITY_TARGETS.green)}${gap > 0 ? ` · ~${gap} more quality leads to hit target` : ""}.`,
      href: "/calls",
      formula: "Pending dollar impact: quality-lead gap × anchored cost-per-quality-lead.",
    });
  }
  // Speed-to-lead
  if (speed && speed.total_leads) {
    if (speed.pct_under_5m < 60) {
      ops.push({
        label: "Speed to Lead",
        severity: speed.pct_under_5m < 30 ? "critical" : "warning",
        why: `Only ${speed.pct_under_5m.toFixed(1)}% of leads get a response within 5 min. Industry target is 60%+.`,
        href: "/lead-performance",
        formula: "Pending dollar impact: leads outside SLA × verified SLA lift × anchored cost-per-qualified lead.",
      });
    }
    if (speed.pct_never_responded > 10) {
      ops.push({
        label: "Recover Never-Responded Leads",
        severity: speed.pct_never_responded > 25 ? "critical" : "warning",
        why: `${speed.pct_never_responded.toFixed(1)}% (${speed.never_responded}) of leads never got a human response.`,
        href: "/lead-performance",
        formula: "Pending dollar impact: never-responded leads × verified recovery rate × anchored cost-per-qualified lead.",
      });
    }
  }
  // Appointment conversion
  const apptRate = totals.qualifiedCalls ? totals.appointments / totals.qualifiedCalls : 0;
  if (totals.qualifiedCalls && apptRate < targets.projectionRate) {
    ops.push({
      label: "Improve Projection Rate",
      severity: apptRate < targets.projectionRate * 0.6 ? "critical" : "warning",
      why: `${(apptRate * 100).toFixed(0)}% of qualified calls become projected sales. Target is ${(targets.projectionRate * 100).toFixed(0)}%.`,
      href: "/lead-performance",
      formula: "Pending dollar impact: projected-sale gap × anchored cost-per-projected sale.",
    });
  }

  const severityOrder = { critical: 0, warning: 1 } as const;
  ops.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.label.localeCompare(b.label));
  const top = ops.slice(0, 3);

  // Lane A — Data integrity (stale syncs in the last 24h)
  const integrity = useQuery({
    queryKey: ["command-integrity"],
    queryFn: async (): Promise<Flag[]> => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("sync_runs")
        .select("source, property_id, status, started_at, error_message")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) return [];
      const seen = new Set<string>();
      const flags: Flag[] = [];
      for (const r of (data ?? []) as any[]) {
        const k = `${r.property_id}:${r.source}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (r.status === "failure") {
          flags.push({
            label: `${r.source} sync failed`,
            severity: "critical",
            why: r.error_message ?? "Most recent sync run failed in the last 24h.",
            href: "/admin/api-health",
          });
        }
      }
      return flags.slice(0, 3);
    },
  });

  const lanes = (integrity.data ?? []).length + top.length;

  return (
    <div className={cn(CARD_CHROME, "p-4")}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-900">Top Opportunities to Improve</h3>
          <Tooltip>
            <TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.topOpps}</TooltipContent>
          </Tooltip>
        </div>
        <Link to="/lead-performance" className="text-[11px] font-medium text-blue-600 hover:underline">View All Opportunities</Link>
      </div>
      {lanes === 0 ? (
        <div className="py-3 text-center text-xs text-slate-500">No major gaps detected — performance is healthy across the funnel.</div>
      ) : (
        <div className="overflow-x-auto">
          {(integrity.data ?? []).length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-1 flex items-center gap-1">
                <AlertOctagon className="size-3 text-rose-500" /> Lane A · Data integrity
              </div>
              <ul className="space-y-1">
                {integrity.data!.map((f) => (
                  <li key={f.label} className="flex items-start gap-2 text-xs border-l-2 border-rose-400 bg-rose-50/50 px-2 py-1 rounded-r">
                    <span className="font-semibold text-rose-700">{f.label}</span>
                    <span className="text-slate-600 flex-1 truncate">{f.why}</span>
                    <Link to={f.href} className="text-blue-600 hover:underline text-[11px]">Fix</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {top.length > 0 && (
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-1 flex items-center gap-1">
              <TrendingDown className="size-3 text-amber-500" /> Lane B · Performance
            </div>
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="py-1.5 pr-3 font-medium">Opportunity</th>
                <th className="py-1.5 pr-3 font-medium">Cost Impact</th>
                <th className="py-1.5 pr-3 font-medium">Why It Matters</th>
                <th className="py-1.5 pr-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {top.slice(0, 3).map((o) => (
                <tr key={o.label} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="py-1.5 pr-3 font-medium text-slate-900">{o.label}</td>
                  <td className="py-1.5 pr-3 font-bold text-amber-600 tabular-nums">
                    <Tooltip>
                      <TooltipTrigger asChild><span className="cursor-help">Pending</span></TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs leading-snug">{o.formula}</TooltipContent>
                    </Tooltip>
                  </td>
                  <td className="py-1.5 pr-3 text-slate-600">{o.why}</td>
                  <td className="py-1.5 pr-3 text-right">
                    <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[11px] bg-white border-slate-200 text-slate-700 hover:bg-slate-50">
                      <Link to={o.href}>View Details</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}