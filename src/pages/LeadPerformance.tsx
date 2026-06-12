import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/data/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/layout/DateRangePicker";
import { useProperties } from "@/contexts/PropertyContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SpeedToLead } from "@/components/lead-perf/SpeedToLead";
import { LeadHandling } from "@/components/lead-perf/LeadHandling";
import { PipelineConversion } from "@/components/lead-perf/PipelineConversion";
import { AgentLeaderboard } from "@/components/lead-perf/AgentLeaderboard";
import { DataQuality } from "@/components/lead-perf/DataQuality";
import { DrillSheet } from "@/components/lead-perf/DrillSheet";
import { DrillIssue, WINDOW_TOOLTIP } from "@/lib/leadPerf";

const ALL_VALUE = "__all__";

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mt-6 mb-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
      {hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="size-3.5 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default function LeadPerformance() {
  const { properties } = useProperties();
  const { range } = useDateRange();
  const { effectiveRole } = usePreviewMode();
  const [selected, setSelected] = useState<string>(ALL_VALUE);
  const [drill, setDrill] = useState<DrillIssue | null>(null);

  const isAgencyMode = selected === ALL_VALUE && effectiveRole === "internal";

  const propertyIds = useMemo<string[] | null>(() => {
    if (selected === ALL_VALUE) {
      return effectiveRole === "internal" ? null : properties.map((p) => p.id);
    }
    return [selected];
  }, [selected, properties, effectiveRole]);

  return (
    <div className="space-y-2">
      <PageHeader
        title="Lead Performance"
        description={isAgencyMode
          ? "Agency-wide view across all properties. Use the property switcher to drill into a single GHL sub-account."
          : "Single-property view. Switch to a different property below."}
        actions={
          <div className="flex items-center gap-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>
                  {effectiveRole === "internal" ? "All properties (agency)" : "All my properties"}
                </SelectItem>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangePicker />
          </div>
        }
      />

      <div className="rounded-md bg-muted/40 border border-border/60 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <Info className="size-3.5 shrink-0" />
        <span>
          {WINDOW_TOOLTIP} Contact sync is on a 30-day rolling window for v1 — not a lifetime CRM audit.
        </span>
      </div>

      <SectionHeader title="Speed to lead" hint="How fast leads get a real human response." />
      <SpeedToLead propertyIds={propertyIds} from={range.from} to={range.to} onDrill={setDrill} />

      <SectionHeader title="Lead handling" hint="Coverage, persistence, and which leads are slipping." />
      <LeadHandling propertyIds={propertyIds} from={range.from} to={range.to} onDrill={setDrill} />

      <SectionHeader title="Pipeline conversion" hint="Funnel based on confirmed pipeline mappings only." />
      <PipelineConversion propertyIds={propertyIds} from={range.from} to={range.to} />

      <SectionHeader title="Agent leaderboard" hint="Per-assigned-agent performance across the selected scope." />
      <AgentLeaderboard
        propertyIds={propertyIds}
        from={range.from}
        to={range.to}
        showAppointmentDerivedNote
      />

      <SectionHeader title="Data quality" hint="Drift signals to keep the rest of the dashboard honest." />
      <DataQuality propertyIds={propertyIds} from={range.from} to={range.to} onDrill={setDrill} />

      <DrillSheet
        issue={drill}
        propertyIds={propertyIds}
        from={range.from}
        to={range.to}
        onClose={() => setDrill(null)}
      />
    </div>
  );
}