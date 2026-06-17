import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCurrency } from "@/lib/metrics";
import type { SpeedData } from "@/components/lead-perf/hooks";
import type { Totals } from "./useCommandData";

type Op = { label: string; impact: number; why: string; href: string };

export function TopOpportunities({ totals, speed }: { totals: Totals; speed: SpeedData | null }) {
  const ops: Op[] = [];
  const revPerAppt = totals.appointments ? totals.revenue / totals.appointments : 250;
  // Qualified-call gap
  const qualRate = totals.calls ? totals.qualifiedCalls / totals.calls : 0;
  if (totals.calls && qualRate < 0.5) {
    const additionalQual = Math.round(totals.calls * 0.5 - totals.qualifiedCalls);
    const apptConv = totals.qualifiedCalls ? totals.appointments / totals.qualifiedCalls : 0.3;
    const impact = Math.max(0, additionalQual * apptConv * revPerAppt);
    if (additionalQual > 0) ops.push({
      label: "Improve Call Qualification",
      impact,
      why: `${(qualRate * 100).toFixed(0)}% of calls are qualified. Reaching 50% recovers ~${additionalQual} qualified calls.`,
      href: "/calls",
    });
  }
  // Speed-to-lead
  if (speed && speed.total_leads) {
    if (speed.pct_under_5m < 60) {
      const lift = (60 - speed.pct_under_5m) / 100;
      const impact = Math.max(0, lift * speed.total_leads * 0.1 * revPerAppt);
      ops.push({
        label: "Speed to Lead",
        impact,
        why: `Only ${speed.pct_under_5m.toFixed(1)}% of leads get a response within 5 min. Industry target is 60%+.`,
        href: "/lead-performance",
      });
    }
    if (speed.pct_never_responded > 10) {
      const reachable = Math.round(speed.never_responded * 0.5);
      const impact = Math.max(0, reachable * 0.08 * revPerAppt);
      ops.push({
        label: "Recover Never-Responded Leads",
        impact,
        why: `${speed.pct_never_responded.toFixed(1)}% (${speed.never_responded}) of leads never got a human response.`,
        href: "/lead-performance",
      });
    }
  }
  // Appointment conversion
  const apptRate = totals.qualifiedCalls ? totals.appointments / totals.qualifiedCalls : 0;
  if (totals.qualifiedCalls && apptRate < 0.4) {
    const lift = 0.4 - apptRate;
    const impact = Math.max(0, totals.qualifiedCalls * lift * revPerAppt);
    ops.push({
      label: "Improve Appointment Set Rate",
      impact,
      why: `${(apptRate * 100).toFixed(0)}% of qualified calls become appointments. Lifting to 40% adds revenue.`,
      href: "/lead-performance",
    });
  }

  ops.sort((a, b) => b.impact - a.impact);
  const top = ops.slice(0, 4);

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold text-slate-900">Top Opportunities to Improve</h3>
          <Tooltip>
            <TooltipTrigger><Info className="size-3.5 text-slate-400" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">Ranked by estimated revenue lift from closing the gap.</TooltipContent>
          </Tooltip>
        </div>
        <Link to="/lead-performance" className="text-xs font-medium text-blue-600 hover:underline">View All Opportunities</Link>
      </div>
      {top.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500">No major gaps detected — performance is healthy across the funnel.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="py-2.5 pr-3 font-medium">Opportunity</th>
                <th className="py-2.5 pr-3 font-medium">Impact</th>
                <th className="py-2.5 pr-3 font-medium">Why It Matters</th>
                <th className="py-2.5 pr-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {top.map((o) => (
                <tr key={o.label} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="py-3.5 pr-3 font-medium text-slate-900">{o.label}</td>
                  <td className="py-3.5 pr-3 font-bold text-rose-500 tabular-nums">{fmtCurrency(o.impact)}</td>
                  <td className="py-3.5 pr-3 text-slate-600">{o.why}</td>
                  <td className="py-3.5 pr-3 text-right">
                    <Button asChild size="sm" variant="outline" className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50">
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