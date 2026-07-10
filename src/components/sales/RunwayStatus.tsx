import type { RunwayMetrics } from "./RevenueRunway";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function statusSentence(m: RunwayMetrics): string {
  if (m.actualToDate === 0 && m.elapsedDays <= 1 && m.availableGoodLeads === 0) {
    return "Waiting on the first sale of the period.";
  }
  const paceClause = m.fullPeriodTarget > 0
    ? (m.variance >= 0
        ? `Revenue is ${currency.format(m.variance)} ahead of pace.`
        : `Revenue is ${currency.format(Math.abs(m.variance))} behind pace.`)
    : null;
  const forecastClause = `Based on ${m.availableGoodLeads} available good lead${m.availableGoodLeads === 1 ? "" : "s"}, a ${(m.closeRate * 100).toFixed(0)}% assumed close rate, and a ${currency.format(m.avgDealValue)} average deal value, revenue is projected to finish at ${currency.format(m.projectedFinish)}.`;
  const targetClause = m.fullPeriodTarget > 0
    ? (m.projectedFinish >= m.fullPeriodTarget
        ? `That is ${currency.format(m.projectedFinish - m.fullPeriodTarget)} above the ${currency.format(m.fullPeriodTarget)} target.`
        : `That is ${currency.format(m.fullPeriodTarget - m.projectedFinish)} below the ${currency.format(m.fullPeriodTarget)} target.`)
    : null;
  return [paceClause, forecastClause, targetClause].filter(Boolean).join(" ");
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
    { label: "Expected additional", value: currency.format(metrics.expectedAdditionalRevenue) },
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