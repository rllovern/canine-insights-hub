import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useProperties } from "@/contexts/PropertyContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SpeedToLead, AutomationComparison } from "@/components/lead-perf/SpeedToLead";
import { LeadHandling } from "@/components/lead-perf/LeadHandling";
import { PipelineConversion } from "@/components/lead-perf/PipelineConversion";
import { AgentLeaderboard } from "@/components/lead-perf/AgentLeaderboard";
import { DataQuality } from "@/components/lead-perf/DataQuality";
import { DrillSheet } from "@/components/lead-perf/DrillSheet";
import { OperationalAlert } from "@/components/lead-perf/OperationalAlert";
import { useSpeed, useHandling, usePipeline, useQuality } from "@/components/lead-perf/hooks";
import { DrillIssue, WINDOW_TOOLTIP } from "@/lib/leadPerf";

const ALL_VALUE = "__all__";

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-1.5">
      <h2 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">{title}</h2>
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

  const args = { propertyIds, from: range.from, to: range.to };
  const { data: speed, loading: speedLoading } = useSpeed(args);
  const { data: handling, loading: handlingLoading } = useHandling(args);
  const { data: pipeline, loading: pipelineLoading } = usePipeline(args);
  const { data: quality, loading: qualityLoading } = useQuality(args);

  return (
    <div className="space-y-1.5">
      {/* Compact page header — TopBar already shows property/date/compare/view-toggle */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Lead Performance</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAgencyMode
              ? "Agency-wide across all properties."
              : "Single-property view."}
            {" "}Scoped to the selected reporting window.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-56 h-8 text-xs">
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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[10px] gap-1 cursor-help">
              <Info className="size-3" /> 30-day rolling window
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{WINDOW_TOOLTIP} Contact sync is on a 30-day rolling window for v1.</TooltipContent>
        </Tooltip>
        <Badge variant="outline" className="text-[10px]">AI bucketed in automation (v1)</Badge>
        <Badge variant="outline" className="text-[10px]">Showed/no-show provisional</Badge>
      </div>

      <div className="pt-2">
        <OperationalAlert
          speed={speed} handling={handling}
          loading={speedLoading || handlingLoading}
          onDrill={setDrill}
        />
      </div>

      <SectionHeader title="Speed to lead — human" hint="Primary KPI: how fast a real human reaches the lead." />
      <SpeedToLead speed={speed} handling={handling} loading={speedLoading} onDrill={setDrill} />

      <SectionHeader
        title="Automation comparison"
        hint="Secondary context. Automation is fast by design — human follow-up is what matters."
      />
      <AutomationComparison speed={speed} handling={handling} loading={speedLoading || handlingLoading} />

      <SectionHeader title="Lead handling" hint="Ownership, persistence, and which leads are slipping." />
      <LeadHandling speed={speed} handling={handling} loading={handlingLoading || speedLoading} onDrill={setDrill} />

      <SectionHeader
        title="Pipeline conversion (stage reached)"
        hint="Counts represent leads that reached this stage during the reporting window — not current-stage snapshots."
      />
      <PipelineConversion pipeline={pipeline} loading={pipelineLoading} />

      <SectionHeader title="Agent leaderboard" hint="Per-assigned-agent performance across the selected scope." />
      <AgentLeaderboard
        propertyIds={propertyIds}
        from={range.from}
        to={range.to}
        showAppointmentDerivedNote
        assignedHint={handling?.assigned}
      />

      <SectionHeader title="Data quality" hint="Drift signals to keep the rest of the dashboard honest." />
      <DataQuality quality={quality} loading={qualityLoading} onDrill={setDrill} />

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