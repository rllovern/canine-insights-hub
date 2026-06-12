import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useProperties } from "@/contexts/PropertyContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExecutiveScoreboard } from "@/components/lead-perf/ExecutiveScoreboard";
import { ActionQueue } from "@/components/lead-perf/ActionQueue";
import { SpeedToLeadTable, AutomationInsightLine } from "@/components/lead-perf/SpeedToLeadTable";
import { OperationsBreakdown } from "@/components/lead-perf/OperationsBreakdown";
import { PipelineConversion } from "@/components/lead-perf/PipelineConversion";
import { AgentLeaderboard } from "@/components/lead-perf/AgentLeaderboard";
import { DataQualityRail } from "@/components/lead-perf/DataQualityRail";
import { DrillSheet } from "@/components/lead-perf/DrillSheet";
import { useSpeed, useHandling, usePipeline, useQuality } from "@/components/lead-perf/hooks";
import { DrillIssue, WINDOW_TOOLTIP } from "@/lib/leadPerf";

const ALL_VALUE = "__all__";

function SectionLabel({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="size-3 text-muted-foreground/70" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
        </Tooltip>
      )}
      {right && <div className="ml-auto">{right}</div>}
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
    <div className="space-y-3">
      {/* Compact header — TopBar already carries property/date/compare/view-toggle. */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2.5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Lead Performance</h1>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">
            {isAgencyMode ? "Agency-wide across all properties." : "Single-property view."}{" "}
            Scoped to the selected reporting window.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px] gap-1 cursor-help"><Info className="size-3" />30-day sync</Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{WINDOW_TOOLTIP} Contact sync is on a 30-day rolling window for v1.</TooltipContent>
          </Tooltip>
          <Badge variant="outline" className="text-[10px]">AI = automation (v1)</Badge>
          <Badge variant="outline" className="text-[10px]">Showed/no-show provisional</Badge>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-52 h-8 text-xs">
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

      {/* 1. Executive Scoreboard */}
      <ExecutiveScoreboard
        speed={speed} handling={handling}
        loading={speedLoading || handlingLoading}
        onDrill={setDrill}
      />

      {/* 2. Action Queue */}
      <ActionQueue propertyIds={propertyIds} from={range.from} to={range.to} onDrill={setDrill} />

      {/* 3. Diagnostics — 2-column on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        {/* Left column */}
        <div className="space-y-3 min-w-0">
          <div>
            <SectionLabel title="Speed to Lead — Human" hint="Primary KPI: how fast a real human reaches the lead." />
            <SpeedToLeadTable speed={speed} handling={handling} loading={speedLoading} onDrill={setDrill} />
            <div className="mt-1.5">
              <AutomationInsightLine speed={speed} handling={handling} loading={speedLoading || handlingLoading} />
            </div>
          </div>

          <div>
            <SectionLabel title="Pipeline Conversion (Stage Reached)" hint="Counts = leads that reached this stage during the window." />
            <PipelineConversion pipeline={pipeline} loading={pipelineLoading} />
          </div>

          <div>
            <SectionLabel title="Agent Leaderboard" hint="Per-assigned-agent performance across the selected scope." />
            <AgentLeaderboard
              propertyIds={propertyIds} from={range.from} to={range.to}
              showAppointmentDerivedNote
              assignedHint={handling?.assigned}
            />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-3 min-w-0">
          <div>
            <SectionLabel title="Operations Breakdown" hint="Ownership, persistence, and which leads are slipping." />
            <OperationsBreakdown
              speed={speed} handling={handling}
              loading={handlingLoading || speedLoading}
              onDrill={setDrill}
            />
          </div>

          <div>
            <SectionLabel title="Data Quality" hint="Drift signals to keep the rest of the dashboard honest." />
            <DataQualityRail quality={quality} loading={qualityLoading} onDrill={setDrill} />
          </div>
        </div>
      </div>

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