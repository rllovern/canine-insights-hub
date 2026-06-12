import { KpiTile } from "./KpiTile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNum, formatPct, DrillIssue, WINDOW_TOOLTIP, pctOf, ofDenom } from "@/lib/leadPerf";
import { SpeedData, HandlingData } from "./hooks";

function SubGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 pl-1">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>
    </div>
  );
}

export function LeadHandling({
  speed, handling, loading, onDrill,
}: {
  speed: SpeedData | null;
  handling: HandlingData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  if (loading || !handling || !speed) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
      </div>
    );
  }

  const total = handling.new || 0;
  const unassigned = Math.max(0, total - handling.assigned);
  const zero = handling.leads_zero_human_attempts;
  const one = handling.leads_one_human_attempt;
  const threePlus = handling.leads_three_plus_attempts;

  return (
    <div className="space-y-4">
      <SubGroup title="Lead Ownership">
        <KpiTile label="New Leads" value={formatNum(total)} sub="In selected window" tooltip={WINDOW_TOOLTIP} />
        <KpiTile
          label="Assigned Leads"
          value={formatNum(handling.assigned)}
          sub={`${formatPct(pctOf(handling.assigned, total))} of new leads`}
          tone={handling.assigned === total ? "good" : "default"}
        />
        <KpiTile
          label="Unassigned Leads"
          value={formatNum(unassigned)}
          sub={`${formatPct(pctOf(unassigned, total))} of new leads`}
          tone={unassigned === 0 ? "good" : unassigned > total * 0.5 ? "bad" : "warn"}
          onClick={() => onDrill("unassigned")}
        />
      </SubGroup>

      <SubGroup title="Human Follow-Up">
        <KpiTile
          label="Zero Human Attempts"
          value={formatNum(zero)}
          sub={`${formatPct(pctOf(zero, total))} of leads — ${formatNum(one)} got one attempt`}
          tone={zero === 0 ? "good" : zero > total * 0.5 ? "bad" : "warn"}
          onClick={() => onDrill("never_responded")}
        />
        <KpiTile
          label="Avg Human Attempts"
          value={Number(handling.avg_human_attempts).toFixed(2)}
          sub="Outbound human messages per lead"
        />
        <KpiTile
          label="Worked 3+ Times"
          value={formatNum(threePlus)}
          sub={`${formatPct(pctOf(threePlus, total))} of leads worked persistently`}
          tone={threePlus > 0 ? "good" : "default"}
        />
      </SubGroup>

      <SubGroup title="Stale Leads">
        <KpiTile
          label={`Stale >${handling.stale_after_hours}h`}
          value={formatNum(handling.stale_count)}
          sub={`${formatPct(pctOf(handling.stale_count, total))} of leads — no human activity`}
          tone={handling.stale_count === 0 ? "good" : "warn"}
          onClick={() => onDrill("stale")}
        />
        <KpiTile
          label={`Critical Stale >${handling.critical_stale_after_hours}h`}
          value={formatNum(handling.critical_stale_count)}
          sub={`${formatPct(pctOf(handling.critical_stale_count, total))} of leads — escalate`}
          tone={handling.critical_stale_count === 0 ? "good" : "bad"}
          onClick={() => onDrill("critical_stale")}
        />
        <KpiTile
          label="Currently Waiting"
          value={formatNum(speed.currently_waiting)}
          sub={`Open leads, last ${speed.active_window_days}d, no human reply yet`}
          tone={speed.currently_waiting === 0 ? "good" : "warn"}
          onClick={() => onDrill("currently_waiting")}
          tooltip="Operational queue: leads currently sitting unanswered by a human."
        />
      </SubGroup>
    </div>
  );
}