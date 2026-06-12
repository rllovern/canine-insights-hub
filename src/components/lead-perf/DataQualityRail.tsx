import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DrillIssue, formatNum } from "@/lib/leadPerf";
import { QualityData } from "./hooks";

type Item = {
  key: keyof QualityData;
  label: string;
  group: "critical" | "info";
  issue?: DrillIssue;
  navigateTo?: string;
  tooltip?: string;
};

const ITEMS: Item[] = [
  { key: "unassigned",              label: "Unassigned Leads",          group: "critical", issue: "unassigned" },
  { key: "missing_opportunities",   label: "Missing Opportunities",     group: "critical", issue: "missing_opportunity" },
  { key: "unknown_response_source", label: "Outbound Unknown Messages", group: "critical", issue: "unknown_response_source" },
  { key: "unmapped_stages",         label: "Unconfirmed Stage Mappings", group: "critical", navigateTo: "/admin/pipeline-mapping" },

  { key: "appointments_missing_status", label: "Derived Appointment Statuses", group: "info", issue: "appointments_missing_status" },
  { key: "duplicate_contacts",      label: "Duplicate Contacts",       group: "info", issue: "duplicate_contacts" },
  { key: "duplicate_opportunities", label: "Duplicate Opportunities",  group: "info", issue: "duplicate_opportunities" },
  { key: "lost_without_reason",     label: "Lost Without Reason",      group: "info", issue: "lost_without_reason" },
  { key: "no_disposition",          label: "Closed Without Disposition", group: "info" },
  { key: "lead_facts_missing_contact", label: "Lead Facts Missing Contact", group: "info" },
];

function dot(n: number, group: "critical" | "info") {
  if (n === 0) return "bg-emerald-500";
  if (group === "critical") return n > 50 ? "bg-rose-500" : "bg-orange-500";
  return "bg-amber-500";
}

export function DataQualityRail({
  quality, loading, onDrill,
}: {
  quality: QualityData | null;
  loading: boolean;
  onDrill: (issue: DrillIssue) => void;
}) {
  const navigate = useNavigate();
  if (loading) return <Skeleton className="h-72 w-full rounded-lg" />;
  if (!quality) return null;

  const renderRow = (it: Item) => {
    const n = Number(quality[it.key] ?? 0);
    const clickable = n > 0 && (it.issue || it.navigateTo);
    const onClick = clickable
      ? (it.navigateTo ? () => navigate(it.navigateTo!) : () => onDrill(it.issue!))
      : undefined;
    return (
      <button
        key={it.key}
        type="button"
        onClick={onClick}
        disabled={!clickable}
        className={cn(
          "w-full flex items-center gap-2 text-left text-xs py-1",
          clickable ? "hover:bg-muted/40 cursor-pointer rounded -mx-2 px-2" : "cursor-default",
        )}
      >
        <span className={cn("size-1.5 rounded-full shrink-0", dot(n, it.group))} />
        <span className="flex-1 truncate text-muted-foreground">{it.label}</span>
        <span className={cn("tabular-nums font-medium", n === 0 && "text-muted-foreground")}>{formatNum(n)}</span>
      </button>
    );
  };

  const critical = ITEMS.filter(i => i.group === "critical");
  const info = ITEMS.filter(i => i.group === "info");

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-3 py-2">
        <h3 className="text-xs uppercase tracking-wider font-semibold">Data Quality</h3>
      </div>
      <div className="px-3 py-2 space-y-2">
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80 mb-1">Critical</div>
          <div>{critical.map(renderRow)}</div>
        </div>
        <div className="border-t pt-2">
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80 mb-1">Other checks</div>
          <div>{info.map(renderRow)}</div>
        </div>
      </div>
    </div>
  );
}