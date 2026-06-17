import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtCurrency, pctChange } from "@/lib/metrics";
import type { Totals } from "./useCommandData";

function scoreOf(t: Totals): number {
  if (!t.calls && !t.totalLeads) return 0;
  const qual = t.calls ? t.qualifiedCalls / t.calls : 0;
  const appt = t.qualifiedCalls ? t.appointments / t.qualifiedCalls : 0;
  const rev  = t.appointments ? Math.min(1, t.revenue ? 1 : 0.4) : 0;
  // weighted 40 / 35 / 25
  return Math.round(Math.min(100, qual * 40 + appt * 35 + rev * 25 + 5));
}

function ringColor(score: number) {
  if (score >= 75) return "hsl(142 71% 45%)"; // emerald
  if (score >= 50) return "hsl(38 92% 50%)";  // amber
  return "hsl(0 84% 60%)";                    // rose
}

export function RevenueCaptureScore({ current, prior }: { current: Totals; prior: Totals }) {
  const score = scoreOf(current);
  const priorScore = scoreOf(prior);
  const delta = pctChange(score, priorScore);
  // Rough lost revenue: if conversion bumped to 60%, what would revenue be?
  const targetConv = 0.6;
  const expected = current.appointments * (current.appointments ? (current.revenue / current.appointments) : 0) +
    Math.max(0, current.qualifiedCalls * targetConv - current.appointments) * (current.appointments ? current.revenue / current.appointments : 250);
  const lost = Math.max(0, expected - current.revenue);
  const color = ringColor(score);
  const c = 2 * Math.PI * 56;
  const offset = c * (1 - score / 100);
  return (
    <Card className="p-5 h-full flex flex-col">
      <h3 className="text-sm font-semibold">Revenue Capture Score</h3>
      <div className="mt-4 flex items-center gap-5 flex-1">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 140 140" className="size-full -rotate-90">
            <circle cx="70" cy="70" r="56" stroke="hsl(var(--muted))" strokeWidth="12" fill="none" />
            <circle
              cx="70" cy="70" r="56" stroke={color} strokeWidth="12" fill="none"
              strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-3xl font-bold tabular-nums">{score}</div>
            <div className="text-[10px] text-muted-foreground">/100</div>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {score >= 75
              ? "Great performance! You're capturing strong revenue this period."
              : score >= 50
                ? "Solid execution with room to capture more revenue."
                : "Significant revenue is being left on the table."}
          </p>
          <div className="mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estimated Revenue Lost This Period</div>
            <div className="text-2xl font-bold text-rose-500 tabular-nums">{fmtCurrency(lost)}</div>
            <div className="text-[10.5px] text-muted-foreground">
              {priorScore ? `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)}% vs prior period` : "no prior comparison"}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/lead-performance">
            View Revenue Impact <ArrowRight className="ml-1 size-3.5" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}