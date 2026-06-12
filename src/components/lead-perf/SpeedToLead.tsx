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
  if (loading) return <Skel n={6} />;
  if (!speed) return null;

  const total = speed.total_leads || 0;
  const responded = speed.responded;
  const respPct = pctOf(responded, total);
  const under1 = Math.round((speed.pct_under_1m / 100) * total);
  const under5 = Math.round((speed.pct_under_5m / 100) * total);
  const under15 = Math.round((speed.pct_under_15m / 100) * total);
  const missed5 = total - under5;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
        label="Missed 5-Min SLA"
        value={formatPct(pctOf(missed5, total))}
        sub={ofDenom(missed5, total)}
        tone={missed5 / Math.max(1, total) > 0.5 ? "bad" : missed5 > 0 ? "warn" : "good"}
        onClick={() => onDrill("slow_response")}
        tooltip="Share of all leads in window that did not get a human response within 5 minutes."
      />
      <KpiTile
        label="Responded Under 5 Min"
        value={formatPct(speed.pct_under_5m)}
        sub={ofDenom(under5, total)}
        tone={speed.pct_under_5m >= 50 ? "good" : speed.pct_under_5m >= 20 ? "warn" : "bad"}
        tooltip={`Of leads that responded, this is ${formatPct(pctOf(under5, responded))}.`}
      />
      <KpiTile
        label="Responded Under 15 Min"
        value={formatPct(speed.pct_under_15m)}
        sub={ofDenom(under15, total)}
        tone={speed.pct_under_15m >= 70 ? "good" : speed.pct_under_15m >= 40 ? "warn" : "bad"}
        tooltip={`Responded Under 1 Min: ${formatPct(speed.pct_under_1m)} (${formatNum(under1)} of ${formatNum(total)}).`}
      />
    </div>
  );
}

/**
 * Secondary automation comparison. Visually lower weight.
 */
export function AutomationComparison({
  speed, handling, loading,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
}) {
  if (loading) return <Skel n={3} />;
  if (!speed || !handling) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <KpiTile
        label="Median Automation Response"
        value={formatDuration(speed.median_automation_seconds)}
        sub="First outbound automation touch (AI bucketed in automation for v1)"
      />
      <KpiTile
        label="Human vs Automation Response Gap"
        value={formatDuration(speed.human_vs_automation_gap_seconds ?? null)}
        sub="Median human time minus median automation time"
        tone={(speed.human_vs_automation_gap_seconds ?? 0) > 3600 ? "warn" : "default"}
      />
      <KpiTile
        label="Automation Touches Per Lead"
        value={Number(handling.avg_automation_touches ?? 0).toFixed(2)}
        sub={`Avg human attempts: ${Number(handling.avg_human_attempts ?? 0).toFixed(2)}`}
        tooltip="Automation + AI sends per lead. AI is bucketed into automation for v1."
      />
    </div>
  );
}

function Skel({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
    </div>
  );
}