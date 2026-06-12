import { Skeleton } from "@/components/ui/skeleton";
import { DrillIssue, formatDuration, formatNum, formatPct, pctOf } from "@/lib/leadPerf";
import { SpeedData, HandlingData } from "./hooks";

type Row = {
  metric: string;
  value: string;
  detail: string;
  drill?: DrillIssue;
};

export function SpeedToLeadTable({
  speed, handling, loading, onDrill,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  if (loading || !speed) return <Skeleton className="h-56 w-full rounded-lg" />;

  const total = speed.total_leads || 0;
  const respPct = pctOf(speed.responded, total) ?? 0;
  const under5 = Math.round((speed.pct_under_5m / 100) * total);
  const under15 = Math.round((speed.pct_under_15m / 100) * total);
  const under1 = Math.round((speed.pct_under_1m / 100) * total);
  const missed5 = Math.max(0, total - under5);

  const rows: Row[] = [
    {
      metric: "Human Response Rate",
      value: formatPct(respPct),
      detail: `${formatNum(speed.responded)} of ${formatNum(total)} leads`,
    },
    {
      metric: "Median Human Response",
      value: formatDuration(speed.median_human_raw_seconds),
      detail: speed.median_human_business_seconds != null
        ? `${formatDuration(speed.median_human_business_seconds)} business-hours`
        : "raw wall-clock",
    },
    {
      metric: "Responded Under 1 Min",
      value: formatPct(speed.pct_under_1m),
      detail: `${formatNum(under1)} of ${formatNum(total)}`,
    },
    {
      metric: "Responded Under 5 Min",
      value: formatPct(speed.pct_under_5m),
      detail: `${formatNum(under5)} of ${formatNum(total)}`,
    },
    {
      metric: "Responded Under 15 Min",
      value: formatPct(speed.pct_under_15m),
      detail: `${formatNum(under15)} of ${formatNum(total)}`,
    },
    {
      metric: "Missed 5-Min SLA",
      value: formatPct(pctOf(missed5, total)),
      detail: `${formatNum(missed5)} of ${formatNum(total)}`,
      drill: missed5 > 0 ? "slow_response" : undefined,
    },
    {
      metric: "No Human Response",
      value: formatNum(speed.never_responded),
      detail: `${formatPct(speed.pct_never_responded)} of leads`,
      drill: speed.never_responded > 0 ? "never_responded" : undefined,
    },
    {
      metric: "Currently Waiting",
      value: formatNum(speed.currently_waiting),
      detail: `open ≤ ${speed.active_window_days}d, no human reply`,
      drill: speed.currently_waiting > 0 ? "currently_waiting" : undefined,
    },
  ];

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="border-b px-3 py-2 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-foreground">Speed to Lead</h3>
        <span className="text-[10.5px] text-muted-foreground">Human follow-up only</span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={r.drill ? "border-b last:border-0 hover:bg-muted/40 cursor-pointer" : "border-b last:border-0"}
              onClick={r.drill ? () => onDrill(r.drill!) : undefined}
            >
              <td className="px-3 py-1.5 text-muted-foreground">{r.metric}</td>
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{r.value}</td>
              <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground tabular-nums w-[42%]">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AutomationInsightLine({
  speed, handling, loading,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
}) {
  if (loading || !speed || !handling) return null;
  return (
    <p className="text-[11.5px] text-muted-foreground px-1">
      Automation median: <span className="text-foreground font-medium">{formatDuration(speed.median_automation_seconds)}</span>.{" "}
      Human median: <span className="text-foreground font-medium">{formatDuration(speed.median_human_raw_seconds)}</span>.{" "}
      Gap: <span className="text-foreground font-medium">{formatDuration(speed.human_vs_automation_gap_seconds ?? null)}</span>.{" "}
      Automation touches per lead: <span className="text-foreground font-medium">{Number(handling.avg_automation_touches ?? 0).toFixed(2)}</span>.{" "}
      AI is bucketed into automation for v1.
    </p>
  );
}