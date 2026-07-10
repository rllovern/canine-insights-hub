import type { RunwayMetrics } from "./RevenueRunway";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function statusSentence(m: RunwayMetrics): string {
  if (m.fullPeriodTarget <= 0) return "Set a revenue target to see runway insights.";
  if (m.actualToDate === 0 && m.elapsedDays <= 1) return "Waiting on the first sale of the period.";
  const projPctOfGoal = (m.projectedFinish / m.fullPeriodTarget) * 100;
  if (m.isPast) {
    return `Closed ${projPctOfGoal.toFixed(0)}% of the 90-day pace target for this period.`;
  }
  const varPct = Math.abs(m.variance / (m.targetPaceToDate || 1)) * 100;
  const projDelta = (projPctOfGoal - 100);
  if (m.variance >= 0 && projPctOfGoal >= 100) {
    return `Revenue is ${currency.format(m.variance)} ahead of pace and is projected to finish ${projDelta.toFixed(1)}% above target.`;
  }
  if (m.variance >= 0 && projPctOfGoal < 100) {
    return `Revenue is currently ahead of pace, but the projected finish falls short of the target by ${Math.abs(projDelta).toFixed(1)}%.`;
  }
  return `Revenue is ${currency.format(Math.abs(m.variance))} behind pace; hitting the target requires ${currency.format(m.requiredDailyPace)}/day for the remaining ${m.remainingDays} day${m.remainingDays === 1 ? "" : "s"}.`;
  void varPct; // reserved for future copy variant
}

export function RunwayStatus({ metrics }: { metrics: RunwayMetrics | null }) {
  if (!metrics) {
    return (
      <div className="text-sm text-muted-foreground">Waiting on runway data…</div>
    );
  }
  const stats: Array<{ label: string; value: string }> = [
    { label: "Remaining", value: currency.format(metrics.remainingRevenue) },
    { label: "Days left", value: String(metrics.remainingDays) },
    { label: "Required / day", value: currency.format(metrics.requiredDailyPace) },
    { label: "Current / day", value: currency.format(metrics.currentDailyPace) },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className="text-base font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-foreground/80">{statusSentence(metrics)}</div>
    </div>
  );
}