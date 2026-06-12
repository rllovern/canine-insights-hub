import { Flame, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DrillIssue, formatDuration, formatNum, formatPct, pctOf } from "@/lib/leadPerf";
import { SpeedData, HandlingData } from "./hooks";

type Tone = "good" | "warn" | "bad";

function bgFor(t: Tone) {
  if (t === "bad")  return "bg-rose-500/[0.07] border-rose-500/40";
  if (t === "warn") return "bg-amber-500/[0.06] border-amber-500/40";
  return "bg-emerald-500/[0.05] border-emerald-500/30";
}
function textFor(t: Tone) {
  if (t === "bad")  return "text-rose-700 dark:text-rose-300";
  if (t === "warn") return "text-amber-700 dark:text-amber-300";
  return "text-emerald-700 dark:text-emerald-300";
}
function dotFor(t: Tone) {
  if (t === "bad")  return "bg-rose-500";
  if (t === "warn") return "bg-amber-500";
  return "bg-emerald-500";
}

export function ExecutiveScoreboard({
  speed, handling, loading, onDrill,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  if (loading || !speed || !handling) {
    return <Skeleton className="h-[120px] w-full rounded-xl" />;
  }

  const total = speed.total_leads || 0;
  const respPct = pctOf(speed.responded, total) ?? 0;
  const neverResp = speed.never_responded;
  const pctNever = pctOf(neverResp, total) ?? 0;
  const critical = handling.critical_stale_count;
  const stale = handling.stale_count;
  const unassigned = Math.max(0, handling.new - handling.assigned);
  const medianHuman = speed.median_human_raw_seconds;

  // Verdict
  let overall: Tone = "good";
  if (critical > 0 || pctNever > 50 || (medianHuman && medianHuman > 4 * 3600)) overall = "bad";
  else if (stale > 0 || pctNever > 20 || unassigned > 0) overall = "warn";

  let verdict = "Lead handling looks healthy.";
  if (overall === "bad") {
    if (pctNever > 50) verdict = `Critical follow-up issue: ${formatPct(pctNever)} of leads have no human response.`;
    else if (critical > 0) verdict = `Lead handling is unhealthy. ${formatNum(critical)} leads are critically stale.`;
    else verdict = "Lead handling is unhealthy. Human follow-up is lagging behind automation.";
  } else if (overall === "warn") {
    verdict = "Needs attention. Human follow-up is slow or some leads are slipping.";
  }

  const Icon = overall === "bad" ? Flame : overall === "warn" ? AlertTriangle : CheckCircle2;
  const heading = overall === "bad" ? "Critical" : overall === "warn" ? "Needs Attention" : "Healthy";

  const metrics: { label: string; value: string; tone: Tone; drill?: DrillIssue; sub?: string }[] = [
    {
      label: "Human Response Rate", value: formatPct(respPct),
      tone: respPct >= 60 ? "good" : respPct >= 30 ? "warn" : "bad",
      sub: `${formatNum(speed.responded)} of ${formatNum(total)} leads`,
    },
    {
      label: "Median Human Response", value: formatDuration(medianHuman),
      tone: medianHuman == null ? "good" : medianHuman > 3600 ? "bad" : medianHuman > 900 ? "warn" : "good",
      sub: "raw wall-clock",
    },
    {
      label: "No Human Response", value: formatNum(neverResp),
      tone: pctNever > 50 ? "bad" : pctNever > 20 ? "warn" : "good",
      drill: neverResp > 0 ? "never_responded" : undefined,
      sub: `${formatPct(pctNever)} of leads`,
    },
    {
      label: critical > 0 ? `Critical Stale >${handling.critical_stale_after_hours}h` : `Stale >${handling.stale_after_hours}h`,
      value: formatNum(critical > 0 ? critical : stale),
      tone: critical > 0 ? "bad" : stale > 0 ? "warn" : "good",
      drill: critical > 0 ? "critical_stale" : stale > 0 ? "stale" : undefined,
      sub: "no human activity",
    },
  ];

  const actions: { label: string; drill: DrillIssue; primary?: boolean }[] = [];
  if (neverResp > 0) actions.push({ label: `No-response leads (${formatNum(neverResp)})`, drill: "never_responded", primary: pctNever > 50 });
  if (critical > 0) actions.push({ label: `Critical stale (${formatNum(critical)})`, drill: "critical_stale", primary: true });
  else if (stale > 0) actions.push({ label: `Stale leads (${formatNum(stale)})`, drill: "stale" });
  if (unassigned > 0) actions.push({ label: `Unassigned (${formatNum(unassigned)})`, drill: "unassigned" });

  return (
    <section className={cn("rounded-xl border p-3 sm:p-4", bgFor(overall))}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)_auto] gap-4 items-center">
        {/* Verdict */}
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn("rounded-md p-1.5 border bg-background/60 shrink-0", bgFor(overall))}>
            <Icon className={cn("size-4", textFor(overall))} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={cn("text-[11px] font-semibold uppercase tracking-wider", textFor(overall))}>{heading}</span>
              <span className="text-[11px] text-muted-foreground">{formatNum(total)} leads in window</span>
            </div>
            <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">{verdict}</p>
          </div>
        </div>

        {/* 4 primary metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:border-l lg:border-border/50 lg:pl-4">
          {metrics.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={m.drill ? () => onDrill(m.drill!) : undefined}
              disabled={!m.drill}
              className={cn(
                "text-left rounded-md px-2 py-1.5",
                m.drill ? "hover:bg-background/60 cursor-pointer" : "cursor-default",
              )}
            >
              <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground font-medium truncate">{m.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className={cn("size-1.5 rounded-full", dotFor(m.tone))} />
                <span className="text-xl font-semibold tabular-nums leading-none">{m.value}</span>
              </div>
              {m.sub && <div className="mt-0.5 text-[10.5px] text-muted-foreground truncate">{m.sub}</div>}
            </button>
          ))}
        </div>

        {/* Actions */}
        {actions.length > 0 && (
          <div className="flex flex-row lg:flex-col gap-1.5 lg:min-w-[200px] lg:border-l lg:border-border/50 lg:pl-4">
            {actions.slice(0, 3).map((a, i) => (
              <Button
                key={i}
                size="sm"
                variant={a.primary ? "default" : "outline"}
                className="h-7 px-2.5 text-xs justify-start whitespace-nowrap"
                onClick={() => onDrill(a.drill)}
              >
                View {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}