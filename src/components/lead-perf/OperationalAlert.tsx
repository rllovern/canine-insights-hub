import { AlertTriangle, CheckCircle2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DrillIssue, formatDuration, formatNum, formatPct, pctOf } from "@/lib/leadPerf";
import { SpeedData, HandlingData } from "./hooks";

type Tone = "good" | "warn" | "bad";

type StatItem = { tone: Tone; value: string; label: string; drill?: DrillIssue };
type Action  = { label: string; drill: DrillIssue; tone: Tone };

function toneRing(tone: Tone) {
  if (tone === "bad") return "border-rose-500/60 bg-rose-500/[0.06]";
  if (tone === "warn") return "border-amber-500/60 bg-amber-500/[0.05]";
  return "border-emerald-500/40 bg-emerald-500/[0.04]";
}
function toneText(tone: Tone) {
  if (tone === "bad") return "text-rose-600 dark:text-rose-400";
  if (tone === "warn") return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}
function toneDot(tone: Tone) {
  if (tone === "bad") return "bg-rose-500";
  if (tone === "warn") return "bg-amber-500";
  return "bg-emerald-500";
}

export function OperationalAlert({
  speed, handling, loading, onDrill,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  if (loading || !speed || !handling) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }

  const totalLeads = speed.total_leads || 0;
  const unassigned = Math.max(0, handling.new - handling.assigned);
  const neverResp = speed.never_responded;
  const critical = handling.critical_stale_count;
  const stale = handling.stale_count;
  const medianHuman = speed.median_human_raw_seconds;
  const medianAuto = speed.median_automation_seconds;

  const pctNever = pctOf(neverResp, totalLeads) ?? 0;

  // Overall health
  let overall: Tone = "good";
  if (critical > 0 || pctNever > 50 || (medianHuman && medianHuman > 60 * 60 * 4)) overall = "bad";
  else if (stale > 0 || pctNever > 20 || unassigned > 0) overall = "warn";

  // Plain-English verdict
  let verdict = "Lead handling looks healthy.";
  if (overall === "bad") {
    if (pctNever > 50) {
      verdict = `Critical follow-up issue: ${formatPct(pctNever)} of leads have no human response.`;
    } else if (critical > 0) {
      verdict = `Lead handling is unhealthy. ${formatNum(critical)} leads are critically stale.`;
    } else {
      verdict = "Lead handling is unhealthy. Human follow-up is lagging behind automation.";
    }
  } else if (overall === "warn") {
    verdict = "Needs attention. Human follow-up is slow or some leads are slipping.";
  }

  const stats: StatItem[] = [
    {
      tone: pctNever > 50 ? "bad" : pctNever > 20 ? "warn" : "good",
      value: formatNum(neverResp), label: "no human response", drill: "never_responded",
    },
    {
      tone: critical > 0 ? "bad" : stale > 0 ? "warn" : "good",
      value: formatNum(critical > 0 ? critical : stale),
      label: critical > 0
        ? `critical stale >${handling.critical_stale_after_hours}h`
        : `stale >${handling.stale_after_hours}h`,
      drill: critical > 0 ? "critical_stale" : stale > 0 ? "stale" : undefined,
    },
    {
      tone: unassigned > totalLeads * 0.5 ? "bad" : unassigned > 0 ? "warn" : "good",
      value: formatNum(unassigned), label: "unassigned", drill: "unassigned",
    },
    {
      tone: medianHuman == null ? "good" : medianHuman > 3600 ? "bad" : medianHuman > 900 ? "warn" : "good",
      value: formatDuration(medianHuman), label: "median human response",
    },
    {
      tone: "good",
      value: formatDuration(medianAuto), label: "automation median",
    },
  ];

  const actions: Action[] = [];
  if (neverResp > 0) actions.push({ label: "No-response leads", drill: "never_responded", tone: pctNever > 50 ? "bad" : "warn" });
  if (critical > 0) actions.push({ label: "Critical stale", drill: "critical_stale", tone: "bad" });
  else if (stale > 0) actions.push({ label: "Stale leads", drill: "stale", tone: "warn" });
  if (unassigned > 0) actions.push({ label: "Unassigned", drill: "unassigned", tone: unassigned > totalLeads * 0.5 ? "bad" : "warn" });

  const Icon = overall === "bad" ? Flame : overall === "warn" ? AlertTriangle : CheckCircle2;
  const heading = overall === "bad" ? "Operational Alert" : overall === "warn" ? "Needs Attention" : "All Clear";

  return (
    <div className={cn("rounded-xl border p-3 sm:p-4", toneRing(overall))}>
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-4">
        {/* Left: verdict */}
        <div className="flex items-start gap-3 lg:w-[44%] lg:min-w-[280px]">
          <div className={cn("rounded-md p-1.5 border shrink-0", toneRing(overall))}>
            <Icon className={cn("size-4", toneText(overall))} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className={cn("text-sm font-semibold tracking-tight", toneText(overall))}>{heading}</h2>
              <span className="text-[11px] text-muted-foreground">{formatNum(totalLeads)} leads in window</span>
            </div>
            <p className="mt-1 text-sm leading-snug text-foreground">{verdict}</p>
          </div>
        </div>

        {/* Middle: compact stat grid */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-1.5 self-center">
          {stats.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={s.drill ? () => onDrill(s.drill!) : undefined}
              disabled={!s.drill}
              className={cn(
                "text-left",
                s.drill ? "cursor-pointer hover:opacity-80" : "cursor-default",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full shrink-0", toneDot(s.tone))} />
                <span className="text-base font-semibold tabular-nums leading-none">{s.value}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground leading-tight">{s.label}</div>
            </button>
          ))}
        </div>

        {/* Right: action buttons */}
        {actions.length > 0 && (
          <div className="flex flex-row lg:flex-col gap-1.5 lg:min-w-[180px] lg:border-l lg:pl-3 lg:border-border/50">
            {actions.slice(0, 3).map((a, i) => (
              <Button
                key={i}
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs justify-start"
                onClick={() => onDrill(a.drill)}
              >
                View {a.label} →
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}