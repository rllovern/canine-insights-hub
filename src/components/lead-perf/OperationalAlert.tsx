import { AlertTriangle, CheckCircle2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DrillIssue, formatDuration, formatNum, formatPct, pctOf } from "@/lib/leadPerf";
import { SpeedData, HandlingData } from "./hooks";

type Tone = "good" | "warn" | "bad";

type Item = {
  tone: Tone;
  text: string;
  drill?: DrillIssue;
};

function toneRing(tone: Tone) {
  if (tone === "bad") return "border-rose-500/50 bg-rose-500/5";
  if (tone === "warn") return "border-amber-500/50 bg-amber-500/5";
  return "border-emerald-500/40 bg-emerald-500/5";
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
    return <Skeleton className="h-32 w-full rounded-xl" />;
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

  const items: Item[] = [];
  if (neverResp > 0) {
    items.push({
      tone: pctNever > 50 ? "bad" : "warn",
      text: `${formatNum(neverResp)} leads have no human response (${formatPct(pctNever)} of ${formatNum(totalLeads)}).`,
      drill: "never_responded",
    });
  }
  if (critical > 0) {
    items.push({
      tone: "bad",
      text: `${formatNum(critical)} leads are critical stale (> ${handling.critical_stale_after_hours}h with no human activity).`,
      drill: "critical_stale",
    });
  } else if (stale > 0) {
    items.push({
      tone: "warn",
      text: `${formatNum(stale)} leads are stale (> ${handling.stale_after_hours}h with no human activity).`,
      drill: "stale",
    });
  }
  if (unassigned > 0) {
    items.push({
      tone: unassigned > totalLeads * 0.5 ? "bad" : "warn",
      text: `${formatNum(unassigned)} leads are unassigned.`,
      drill: "unassigned",
    });
  }
  if (medianHuman != null) {
    const slow = medianHuman > 60 * 60; // > 1h
    items.push({
      tone: slow ? "bad" : medianHuman > 15 * 60 ? "warn" : "good",
      text: `Median human response time is ${formatDuration(medianHuman)}.`,
    });
  }
  if (medianAuto != null && medianHuman != null) {
    const gap = medianHuman - medianAuto;
    if (gap > 60 * 30) {
      items.push({
        tone: "warn",
        text: `Automation responds in ${formatDuration(medianAuto)}, but human follow-up is lagging by ${formatDuration(gap)}.`,
      });
    }
  }
  if (items.length === 0) {
    items.push({ tone: "good", text: "No active operational alarms in this window." });
  }

  const Icon = overall === "bad" ? Flame : overall === "warn" ? AlertTriangle : CheckCircle2;

  return (
    <div className={cn("rounded-xl border-2 p-5", toneRing(overall))}>
      <div className="flex items-start gap-3">
        <div className={cn("rounded-lg p-2 bg-background/60 border", toneRing(overall))}>
          <Icon className={cn("size-6", toneText(overall))} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className={cn("text-lg font-semibold tracking-tight", toneText(overall))}>
              {overall === "bad" ? "Operational Alert" : overall === "warn" ? "Needs Attention" : "All Clear"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {formatNum(totalLeads)} leads in window
            </span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={cn("mt-1.5 size-1.5 rounded-full shrink-0", toneDot(it.tone))} />
                <span className="flex-1">{it.text}</span>
                {it.drill && (
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => onDrill(it.drill!)}
                  >
                    View leads →
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}