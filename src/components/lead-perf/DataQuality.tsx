import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiTile } from "./KpiTile";
import { DrillIssue, formatNum } from "@/lib/leadPerf";
import { QualityData } from "./hooks";

type Tile = {
  key: keyof QualityData;
  label: string;
  issue?: DrillIssue;
  tooltip?: string;
  navigateTo?: string;
};

const TILES: Tile[] = [
  { key: "unassigned", label: "Unassigned Leads", issue: "unassigned" },
  {
    key: "unknown_response_source", label: "Outbound Unknown Messages", issue: "unknown_response_source",
    tooltip: "Outbound messages with no userId and no workflow/campaign tag. Inbound from customers is excluded.",
  },
  {
    key: "unmapped_stages", label: "Unconfirmed Stage Mappings", issue: "unmapped_stages",
    tooltip: "Stages with no admin-confirmed canonical mapping. Auto-suggestions exist but are not applied.",
    navigateTo: "/admin/pipeline-mapping",
  },
  {
    key: "appointments_missing_status", label: "Derived Appointment Statuses", issue: "appointments_missing_status",
    tooltip: "Appointments where showed/no-show is provisionally derived (appointment confirmed + ended in the past).",
  },
  { key: "missing_opportunities", label: "Missing Opportunities", issue: "missing_opportunity" },
  { key: "duplicate_contacts", label: "Duplicate Contacts", issue: "duplicate_contacts", tooltip: "Same phone or email across multiple contact records." },
  { key: "duplicate_opportunities", label: "Duplicate Opportunities", issue: "duplicate_opportunities" },
  { key: "lost_without_reason", label: "Lost Without Reason", issue: "lost_without_reason" },
  { key: "no_disposition", label: "Closed Without Disposition" },
  { key: "lead_facts_missing_contact", label: "Lead Facts Missing Contact" },
];

export function DataQuality({
  quality, loading, onDrill,
}: {
  quality: QualityData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
      </div>
    );
  }
  if (!quality) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {TILES.map((t) => {
        const n = Number(quality[t.key] ?? 0);
        const onClick = n > 0
          ? (t.navigateTo ? () => navigate(t.navigateTo!) : (t.issue ? () => onDrill(t.issue!) : undefined))
          : undefined;
        return (
          <KpiTile
            key={t.key}
            label={t.label}
            value={formatNum(n)}
            tone={n > 0 ? "warn" : "good"}
            tooltip={t.tooltip}
            onClick={onClick}
          />
        );
      })}
    </div>
  );
}