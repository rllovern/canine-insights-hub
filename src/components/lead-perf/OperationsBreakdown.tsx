import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StatusPill, Status } from "./StatusPill";
import { DrillIssue, formatNum } from "@/lib/leadPerf";
import { SpeedData, HandlingData } from "./hooks";

type Row = {
  category: string;
  metric: string;
  value: string | number;
  status: Status;
  drill?: DrillIssue;
};

function bandStatus(value: number, total: number, kind: "bad-when-high" | "good-when-high"): Status {
  if (total === 0) return "neutral";
  const r = value / total;
  if (kind === "bad-when-high") {
    if (r >= 0.5) return "critical";
    if (r >= 0.2) return "bad";
    if (r > 0)    return "warn";
    return "good";
  } else {
    if (r >= 0.5) return "good";
    if (r >= 0.2) return "warn";
    if (r > 0)    return "bad";
    return "critical";
  }
}

export function OperationsBreakdown({
  speed, handling, loading, onDrill,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  if (loading || !handling || !speed) return <Skeleton className="h-80 w-full rounded-lg" />;

  const total = handling.new || 0;
  const unassigned = Math.max(0, total - handling.assigned);
  const zero = handling.leads_zero_human_attempts;
  const one = handling.leads_one_human_attempt;
  const threePlus = handling.leads_three_plus_attempts;

  const rows: Row[] = [
    { category: "Ownership", metric: "New Leads",           value: total,                 status: "neutral" },
    { category: "Ownership", metric: "Assigned Leads",      value: handling.assigned,     status: bandStatus(handling.assigned, total, "good-when-high") },
    { category: "Ownership", metric: "Unassigned Leads",    value: unassigned,            status: bandStatus(unassigned, total, "bad-when-high"), drill: unassigned > 0 ? "unassigned" : undefined },

    { category: "Follow-Up", metric: "Zero Human Attempts", value: zero,                  status: bandStatus(zero, total, "bad-when-high"), drill: zero > 0 ? "never_responded" : undefined },
    { category: "Follow-Up", metric: "One Human Attempt",   value: one,                   status: one > 0 ? "bad" : "neutral" },
    { category: "Follow-Up", metric: "Avg Human Attempts",  value: Number(handling.avg_human_attempts).toFixed(2), status: "neutral" },
    { category: "Follow-Up", metric: "Worked 3+ Times",     value: threePlus,             status: threePlus > 0 ? "good" : "neutral" },

    { category: "Stale",     metric: `Stale >${handling.stale_after_hours}h`,           value: handling.stale_count,          status: handling.stale_count > 0 ? "warn" : "good", drill: handling.stale_count > 0 ? "stale" : undefined },
    { category: "Stale",     metric: `Critical Stale >${handling.critical_stale_after_hours}h`, value: handling.critical_stale_count, status: handling.critical_stale_count > 0 ? "critical" : "good", drill: handling.critical_stale_count > 0 ? "critical_stale" : undefined },
    { category: "Stale",     metric: "Currently Waiting",   value: speed.currently_waiting, status: speed.currently_waiting > 0 ? "warn" : "good", drill: speed.currently_waiting > 0 ? "currently_waiting" : undefined },
  ];

  let lastCat = "";
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="border-b px-3 py-2">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-foreground">Operations Breakdown</h3>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r, i) => {
            const showCat = r.category !== lastCat;
            lastCat = r.category;
            return (
              <tr
                key={i}
                className={cn(
                  "border-b last:border-0",
                  r.drill && "hover:bg-muted/40 cursor-pointer",
                  showCat && i > 0 && "border-t-2 border-t-border/60",
                )}
                onClick={r.drill ? () => onDrill(r.drill!) : undefined}
              >
                <td className="px-3 py-1.5 w-[80px] text-[10.5px] uppercase tracking-wide text-muted-foreground/80 font-medium align-top">
                  {showCat ? r.category : ""}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.metric}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  {typeof r.value === "number" ? formatNum(r.value) : r.value}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <StatusPill status={r.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}