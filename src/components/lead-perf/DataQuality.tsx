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
  group: "critical" | "neutral" | "healthy-eligible";
  /** Tone when value > 0 */
  warnTone?: "warn" | "bad";
};

const TILES: Tile[] = [
  { key: "unassigned", label: "Unassigned Leads", issue: "unassigned", group: "critical", warnTone: "bad" },
  { key: "missing_opportunities", label: "Missing Opportunities", issue: "missing_opportunity", group: "critical", warnTone: "warn" },
  {
    key: "unknown_response_source", label: "Outbound Unknown Messages", issue: "unknown_response_source",
    tooltip: "Outbound messages with no userId and no workflow/campaign tag. Inbound from customers is excluded.",
    group: "critical", warnTone: "warn",
  },
  {
    key: "unmapped_stages", label: "Unconfirmed Stage Mappings", issue: "unmapped_stages",
    tooltip: "Stages with no admin-confirmed canonical mapping. Auto-suggestions exist but are not applied.",
    navigateTo: "/admin/pipeline-mapping",
    group: "critical", warnTone: "warn",
  },
  {
    key: "appointments_missing_status", label: "Derived Appointment Statuses", issue: "appointments_missing_status",
    tooltip: "Appointments where showed/no-show is provisionally derived (appointment confirmed + ended in the past).",
    group: "neutral", warnTone: "warn",
  },
  { key: "duplicate_contacts", label: "Duplicate Contacts", issue: "duplicate_contacts", tooltip: "Same phone or email across multiple contact records.", group: "healthy-eligible", warnTone: "warn" },
  { key: "duplicate_opportunities", label: "Duplicate Opportunities", issue: "duplicate_opportunities", group: "healthy-eligible", warnTone: "warn" },
  { key: "lost_without_reason", label: "Lost Without Reason", issue: "lost_without_reason", group: "healthy-eligible", warnTone: "warn" },
  { key: "no_disposition", label: "Closed Without Disposition", group: "healthy-eligible", warnTone: "warn" },
  { key: "lead_facts_missing_contact", label: "Lead Facts Missing Contact", group: "healthy-eligible", warnTone: "warn" },
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
      </div>
    );
  }
  if (!quality) return null;

  const renderTile = (t: Tile, opts?: { muted?: boolean; size?: "sm" | "md" }) => {
    const n = Number(quality[t.key] ?? 0);
    const onClick = n > 0
      ? (t.navigateTo ? () => navigate(t.navigateTo!) : (t.issue ? () => onDrill(t.issue!) : undefined))
      : undefined;
    const tone = n === 0 ? "good" : (t.warnTone ?? "warn");
    return (
      <KpiTile
        key={t.key}
        label={t.label}
        value={formatNum(n)}
        tone={tone}
        tooltip={t.tooltip}
        onClick={onClick}
        size={opts?.size}
        emphasis={opts?.muted ? "muted" : "default"}
      />
    );
  };

  const critical = TILES.filter(t => t.group === "critical");
  const neutral  = TILES.filter(t => t.group === "neutral");
  const healthyEligible = TILES.filter(t => t.group === "healthy-eligible");

  // Split healthy-eligible into "issue present" (show normally) vs "zero" (compact strip).
  const healthyWithIssues = healthyEligible.filter(t => Number(quality[t.key] ?? 0) > 0);
  const healthyClean      = healthyEligible.filter(t => Number(quality[t.key] ?? 0) === 0);

  return (
    <div className="space-y-3">
      {/* Critical issues — full size */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {critical.map(t => renderTile(t))}
        {neutral.map(t => renderTile(t))}
        {healthyWithIssues.map(t => renderTile(t))}
      </div>

      {/* Healthy checks — compact zero-value row */}
      {healthyClean.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Healthy checks</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {healthyClean.map(t => (
                <span key={t.key} className="inline-flex items-center gap-1.5 text-xs">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">{t.label}:</span>
                  <span className="font-medium tabular-nums">0</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}