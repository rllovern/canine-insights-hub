import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { KpiTile } from "./KpiTile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatPct, formatNum, DrillIssue, WINDOW_TOOLTIP } from "@/lib/leadPerf";

type Speed = {
  total_leads: number;
  responded: number;
  never_responded: number;
  pct_never_responded: number;
  pct_under_1m: number;
  pct_under_5m: number;
  pct_under_15m: number;
  median_human_raw_seconds: number | null;
  median_human_business_seconds: number | null;
  median_automation_seconds: number | null;
  median_ai_seconds: number | null;
  human_vs_automation_gap_seconds: number | null;
  currently_waiting: number;
  active_window_days: number;
};

export function SpeedToLead({
  propertyIds, from, to, onDrill,
}: {
  propertyIds: string[] | null;
  from: Date; to: Date;
  onDrill: (issue: DrillIssue) => void;
}) {
  const [data, setData] = useState<Speed | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data } = await supabase.rpc("lead_perf_speed", {
        _property_ids: propertyIds, _from: from.toISOString(), _to: to.toISOString(),
      });
      setData((data ?? null) as unknown as Speed | null);
      setLoading(false);
    })();
  }, [propertyIds, from, to]);

  if (loading) return <SectionSkeleton />;
  if (!data) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiTile
        label="Responded"
        value={formatPct(100 - data.pct_never_responded)}
        sub={`${formatNum(data.responded)} of ${formatNum(data.total_leads)} leads`}
        tooltip={WINDOW_TOOLTIP}
      />
      <KpiTile
        label="Never responded"
        value={formatNum(data.never_responded)}
        sub={`${formatPct(data.pct_never_responded)} of leads in window`}
        tone={data.pct_never_responded > 20 ? "bad" : "warn"}
        onClick={() => onDrill("never_responded")}
      />
      <KpiTile
        label="Currently waiting"
        value={formatNum(data.currently_waiting)}
        sub={`open leads, last ${data.active_window_days}d, no human reply`}
        tone={data.currently_waiting > 0 ? "warn" : "good"}
        onClick={() => onDrill("currently_waiting")}
      />
      <KpiTile
        label="Slow response"
        value={formatPct(100 - data.pct_under_5m)}
        sub={`${formatPct(data.pct_under_5m)} responded ≤ 5 min`}
        onClick={() => onDrill("slow_response")}
      />
      <KpiTile
        label="Median human STL"
        value={formatDuration(data.median_human_raw_seconds)}
        sub={data.median_human_business_seconds != null
          ? `${formatDuration(data.median_human_business_seconds)} business-hours`
          : undefined}
        tooltip="Raw wall-clock from lead created → first outbound human message."
      />
      <KpiTile
        label="Automation median"
        value={formatDuration(data.median_automation_seconds)}
        sub="first outbound automation touch"
      />
      <KpiTile
        label="Human vs automation gap"
        value={formatDuration(data.human_vs_automation_gap_seconds ?? null)}
        sub="how much faster automation is than humans"
        tooltip="Median human STL minus median automation STL."
      />
      <KpiTile
        label="Under 1 min"
        value={formatPct(data.pct_under_1m)}
        sub={`${formatPct(data.pct_under_15m)} under 15m`}
      />
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
    </div>
  );
}