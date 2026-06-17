import { Link } from "react-router-dom";
import { ArrowRight, ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtCurrency, pctChange } from "@/lib/metrics";
import type { Totals } from "./useCommandData";

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
  const c = 2 * Math.PI * 62;
  const offset = c * (1 - score / 100);

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-6 h-full flex flex-col">
      <h3 className="text-base font-semibold text-slate-900">Revenue Capture Score</h3>
      <div className="mt-5 flex items-center gap-6 flex-1">
        <div className="relative size-40 shrink-0">
          <svg viewBox="0 0 140 140" className="size-full -rotate-90">
            <circle cx="70" cy="70" r="62" stroke="#e5e7eb" strokeWidth="10" fill="none" />
            <circle
              cx="70" cy="70" r="62" stroke={color} strokeWidth="10" fill="none"
              strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-4xl font-bold tabular-nums text-slate-900">{score}</div>
            <div className="text-xs text-slate-500 mt-0.5">/100</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-600 leading-snug">
            {score >= 75
              ? "Great performance! You're capturing more revenue compared to last week."
              : score >= 50
                ? "Solid execution with room to capture more revenue."
                : "Significant revenue is being left on the table."}
          </p>
          <div className="mt-5">
            <div className="text-sm font-semibold text-slate-900">Estimated Revenue Lost This Week</div>
            <div className="text-3xl font-bold text-rose-500 tabular-nums mt-1">{fmtCurrency(lost)}</div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
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
      <div className="mt-5">
        <Button asChild variant="outline" className="w-full bg-white border-slate-200 hover:bg-slate-50 text-slate-700">
          <Link to="/lead-performance">
            View Revenue Impact <ArrowRight className="ml-1 size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}