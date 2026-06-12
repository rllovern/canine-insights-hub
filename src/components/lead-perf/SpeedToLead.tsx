import { KpiTile } from "./KpiTile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatPct, formatNum, DrillIssue, WINDOW_TOOLTIP, pctOf, ofDenom } from "@/lib/leadPerf";
import { SpeedData, HandlingData } from "./hooks";

/**
 * Primary human KPIs. Automation lives in <AutomationComparison /> below.
 */
export function SpeedToLead({
  speed, handling, loading, onDrill,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  if (loading) return <Skel n={5} />;
  if (!speed) return null;

  const total = speed.total_leads || 0;
  const responded = speed.responded;
  const respPct = pctOf(responded, total);
  const under1 = Math.round((speed.pct_under_1m / 100) * total);
  const under5 = Math.round((speed.pct_under_5m / 100) * total);
  const under15 = Math.round((speed.pct_under_15m / 100) * total);
  const missed5 = total - under5;
  const missed5Pct = pctOf(missed5, total);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
      <KpiTile
        label="Human Response Rate"
        value={formatPct(respPct)}
        sub={ofDenom(responded, total)}
        tone={respPct == null ? "default" : respPct >= 60 ? "good" : respPct >= 30 ? "warn" : "bad"}
        tooltip={WINDOW_TOOLTIP}
      />
      <KpiTile
        label="Median Human Response Time"
        value={formatDuration(speed.median_human_raw_seconds)}
        sub={speed.median_human_business_seconds != null
          ? `${formatDuration(speed.median_human_business_seconds)} business-hours`
          : "Raw wall-clock from lead created → first human reply"}
        tone={!speed.median_human_raw_seconds ? "default"
          : speed.median_human_raw_seconds > 3600 ? "bad"
          : speed.median_human_raw_seconds > 900 ? "warn" : "good"}
      />
      <KpiTile
        label="No Human Response"
        value={formatNum(speed.never_responded)}
        sub={`${formatPct(speed.pct_never_responded)} of ${formatNum(total)} leads in window`}
        tone={speed.pct_never_responded > 50 ? "bad" : speed.pct_never_responded > 20 ? "warn" : "good"}
        onClick={() => onDrill("never_responded")}
      />
      <KpiTile
        label="Responded Under 5 Min"
        value={formatPct(speed.pct_under_5m)}
        sub={ofDenom(under5, total)}
        tone={speed.pct_under_5m >= 50 ? "good" : speed.pct_under_5m >= 20 ? "warn" : "default"}
        tooltip={`Of leads that responded, this is ${formatPct(pctOf(under5, responded))}. Missed 5-min SLA: ${formatPct(missed5Pct)} (${formatNum(missed5)} of ${formatNum(total)}).`}
      />
      <KpiTile
        label="Responded Under 15 Min"
        value={formatPct(speed.pct_under_15m)}
        sub={ofDenom(under15, total)}
        tone={speed.pct_under_15m >= 70 ? "good" : speed.pct_under_15m >= 40 ? "warn" : "default"}
        tooltip={`Responded Under 1 Min: ${formatPct(speed.pct_under_1m)} (${formatNum(under1)} of ${formatNum(total)}).`}
      />
    </div>
  );
}

/**
 * Secondary automation comparison — single compact horizontal strip.
 */
export function AutomationComparison({
  speed, handling, loading,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-10 w-full rounded-lg" />;
  if (!speed || !handling) return null;
  const Item = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      <Item label="Automation median:" value={formatDuration(speed.median_automation_seconds)} />
      <Item label="Human median:" value={formatDuration(speed.median_human_raw_seconds)} />
      <Item label="Gap:" value={formatDuration(speed.human_vs_automation_gap_seconds ?? null)} />
      <Item label="Automation touches / lead:" value={Number(handling.avg_automation_touches ?? 0).toFixed(2)} />
      <span className="ml-auto text-[10.5px] text-muted-foreground/80">AI bucketed into automation for v1</span>
    </div>
  );
}

function Skel({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
      {Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
    </div>
  );
}