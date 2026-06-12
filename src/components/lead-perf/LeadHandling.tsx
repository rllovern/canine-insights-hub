import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { KpiTile } from "./KpiTile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNum, DrillIssue, WINDOW_TOOLTIP } from "@/lib/leadPerf";

type Handling = {
  new: number; assigned: number; contacted: number; engaged: number;
  avg_human_attempts: number; avg_automation_touches: number; avg_ai_touches: number; avg_total_touches: number;
  leads_zero_human_attempts: number; leads_one_human_attempt: number; leads_three_plus_attempts: number;
  stale_count: number; critical_stale_count: number;
  stale_after_hours: number; critical_stale_after_hours: number;
};

export function LeadHandling({
  propertyIds, from, to, onDrill,
}: {
  propertyIds: string[] | null; from: Date; to: Date;
  onDrill: (issue: DrillIssue) => void;
}) {
  const [data, setData] = useState<Handling | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data } = await supabase.rpc("lead_perf_handling", {
        _property_ids: propertyIds, _from: from.toISOString(), _to: to.toISOString(),
      });
      setData((data ?? null) as unknown as Handling | null);
      setLoading(false);
    })();
  }, [propertyIds, from, to]);

  if (loading) return <Skel />;
  if (!data) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiTile label="New leads" value={formatNum(data.new)} tooltip={WINDOW_TOOLTIP} />
      <KpiTile
        label="Unassigned"
        value={formatNum(data.new - data.assigned)}
        sub={`${formatNum(data.assigned)} assigned`}
        tone={data.new - data.assigned > 0 ? "warn" : "good"}
        onClick={() => onDrill("unassigned")}
      />
      <KpiTile
        label="Zero human attempts"
        value={formatNum(data.leads_zero_human_attempts)}
        sub={`${formatNum(data.leads_one_human_attempt)} with one attempt`}
        tone={data.leads_zero_human_attempts > 0 ? "warn" : "good"}
        onClick={() => onDrill("never_responded")}
      />
      <KpiTile
        label="3+ attempts"
        value={formatNum(data.leads_three_plus_attempts)}
        sub="leads worked persistently"
        tone="good"
      />
      <KpiTile label="Avg human attempts" value={data.avg_human_attempts.toFixed(2)} />
      <KpiTile label="Avg automation touches" value={data.avg_automation_touches.toFixed(2)} />
      <KpiTile
        label="Stale"
        value={formatNum(data.stale_count)}
        sub={`no human activity > ${data.stale_after_hours}h`}
        tone={data.stale_count > 0 ? "warn" : "good"}
        onClick={() => onDrill("stale")}
      />
      <KpiTile
        label="Critical stale"
        value={formatNum(data.critical_stale_count)}
        sub={`> ${data.critical_stale_after_hours}h`}
        tone={data.critical_stale_count > 0 ? "bad" : "good"}
        onClick={() => onDrill("critical_stale")}
      />
    </div>
  );
}

function Skel() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
    </div>
  );
}