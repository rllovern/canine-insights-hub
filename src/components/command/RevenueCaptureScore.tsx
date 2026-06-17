import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown, ArrowUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { fmtCurrency, pctChange } from "@/lib/metrics";
import type { Totals } from "./useCommandData";
import { TIPS } from "./tooltips";

function scoreOf(t: Totals): number {
  if (!t.calls && !t.totalLeads) return 0;
  const qual = t.calls ? t.qualifiedCalls / t.calls : 0;
  const appt = t.qualifiedCalls ? t.appointments / t.qualifiedCalls : 0;
  const rev  = t.appointments ? Math.min(1, t.revenue ? 1 : 0.4) : 0;
  return Math.round(Math.min(100, qual * 40 + appt * 35 + rev * 25 + 5));
}

function ringColor(score: number) {
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

export function RevenueCaptureScore({ current, prior }: { current: Totals; prior: Totals }) {
  const score = scoreOf(current);
  const priorScore = scoreOf(prior);
  const delta = pctChange(score, priorScore);
  const revPerAppt = current.appointments ? current.revenue / current.appointments : 250;
  const targetConv = 0.6;
  const expected = current.qualifiedCalls * targetConv * revPerAppt;
  const lost = Math.max(0, expected - current.revenue);
  const color = ringColor(score);
  const c = 2 * Math.PI * 48;
  const offset = c * (1 - score / 100);

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-4 h-full flex flex-col">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-slate-900">Revenue Capture Score</h3>
        <Tooltip>
          <TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.revenueCapture}</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-2 flex items-center gap-4 flex-1">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r="48" stroke="#e5e7eb" strokeWidth="10" fill="none" />
            <circle
              cx="60" cy="60" r="48" stroke={color} strokeWidth="10" fill="none"
              strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-2xl font-bold tabular-nums text-slate-900 leading-none">{score}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">/100</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-slate-600 leading-snug">
            {score >= 75
              ? "Great performance — capturing more revenue vs prior period."
              : score >= 50
                ? "Solid — room to capture more revenue."
                : "Significant revenue being left on the table."}
          </p>
          <div className="mt-2">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-900">
              <span>Estimated Revenue Lost</span>
              <Tooltip>
                <TooltipTrigger asChild><button type="button"><Info className="size-3 text-slate-400" /></button></TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.revenueLost}</TooltipContent>
              </Tooltip>
            </div>
            <div className="text-xl font-bold text-rose-500 tabular-nums mt-0.5">{fmtCurrency(lost)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
              {priorScore ? (
                <>
                  {delta < 0 ? <ArrowDown className="size-3 text-rose-500" /> : <ArrowUp className="size-3 text-emerald-500" />}
                  <span className={delta < 0 ? "text-rose-500 font-semibold" : "text-emerald-600 font-semibold"}>{Math.abs(delta).toFixed(1)}%</span>
                  <span>vs prior period</span>
                </>
              ) : "no prior comparison"}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2">
        <Button asChild variant="outline" size="sm" className="w-full h-8 bg-white border-slate-200 hover:bg-slate-50 text-slate-700 text-xs">
          <Link to="/lead-performance">
            View Revenue Impact <ArrowRight className="ml-1 size-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}