import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiTile } from "./KpiTile";
import { DrillIssue, formatNum } from "@/lib/leadPerf";

type Quality = {
  unassigned: number;
  missing_opportunities: number;
  no_disposition: number;
  duplicate_contacts: number;
  duplicate_opportunities: number;
  lost_without_reason: number;
  unmapped_stages: number;
  unknown_response_source: number;
  lead_facts_missing_contact: number;
  appointments_missing_status: number;
};

const TILES: Array<{ key: keyof Quality; label: string; issue?: DrillIssue; tooltip?: string }> = [
  { key: "unassigned", label: "Unassigned leads", issue: "unassigned" },
  { key: "missing_opportunities", label: "Missing opportunities", issue: "missing_opportunity" },
  { key: "no_disposition", label: "Closed w/o disposition" },
  { key: "lost_without_reason", label: "Lost without reason", issue: "lost_without_reason" },
  { key: "duplicate_contacts", label: "Duplicate contacts", issue: "duplicate_contacts", tooltip: "Same phone or email across multiple contact records." },
  { key: "duplicate_opportunities", label: "Duplicate opportunities", issue: "duplicate_opportunities" },
  { key: "unmapped_stages", label: "Unmapped pipeline stages", issue: "unmapped_stages", tooltip: "Stages with no admin-confirmed canonical mapping. Suggestions exist but are not yet applied." },
  {
    key: "unknown_response_source", label: "Outbound unknown source", issue: "unknown_response_source",
    tooltip: "Outbound messages with no userId and no workflow/campaign tag. Inbound from customers is excluded.",
  },
  { key: "appointments_missing_status", label: "Appointments missing status", issue: "appointments_missing_status", tooltip: "Provisional showed/no-show derivation can't be applied to these." },
  { key: "lead_facts_missing_contact", label: "Lead facts missing contact" },
];

export function DataQuality({
  propertyIds, from, to, onDrill,
}: {
  propertyIds: string[] | null; from: Date; to: Date;
  onDrill: (issue: DrillIssue) => void;
}) {
  const [data, setData] = useState<Quality | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data } = await supabase.rpc("lead_perf_quality", {
        _property_ids: propertyIds, _from: from.toISOString(), _to: to.toISOString(),
      });
      setData((data ?? null) as unknown as Quality | null);
      setLoading(false);
    })();
  }, [propertyIds, from, to]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {TILES.map((t) => {
        const n = data[t.key] ?? 0;
        return (
          <KpiTile
            key={t.key}
            label={t.label}
            value={formatNum(n)}
            tone={n > 0 ? "warn" : "good"}
            tooltip={t.tooltip}
            onClick={n > 0 && t.issue ? () => onDrill(t.issue!) : undefined}
          />
        );
      })}
    </div>
  );
}