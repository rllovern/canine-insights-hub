import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNum, formatPct1 } from "@/lib/leadPerf";
import { PipelineData } from "./hooks";

type Row = { key: string; label: string; relative?: string; prevKey?: string };

const ROWS: Row[] = [
  { key: "new",         label: "New Leads" },
  { key: "contacted",   label: "Contacted",   relative: "new_to_contacted",        prevKey: "new" },
  { key: "engaged",     label: "Engaged",     relative: "contacted_to_engaged",    prevKey: "contacted" },
  { key: "appointment", label: "Appointment", relative: "engaged_to_appointment",  prevKey: "engaged" },
  { key: "showed",      label: "Showed",      relative: "appointment_to_showed",   prevKey: "appointment" },
  { key: "won",         label: "Won",         relative: "showed_to_won",           prevKey: "showed" },
];

const RELATIVE_LABEL: Record<string, string> = {
  new_to_contacted: "of new leads",
  contacted_to_engaged: "of contacted",
  engaged_to_appointment: "of engaged",
  appointment_to_showed: "of appointments",
  showed_to_won: "of showed",
};

export function PipelineConversion({
  pipeline, loading,
}: {
  pipeline: PipelineData | null;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!pipeline) return null;

  const total = Number(pipeline.stages.new ?? 0);

  return (
    <div className="space-y-3">
      {pipeline.needs_mapping && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>One or more pipeline stages need admin confirmation. Auto-suggestions are not applied until confirmed.</span>
            <Link to="/admin/pipeline-mapping" className="text-primary hover:underline text-xs whitespace-nowrap">
              Review mapping →
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Funnel — stage reached</div>
          <Badge variant="outline" className="text-[10px]">
            Counts = leads that reached this stage during the window
          </Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">From previous stage</TableHead>
              <TableHead className="text-right">% of new leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((r) => {
              const count = Number(pipeline.stages[r.key] ?? 0);
              const prev = r.prevKey ? Number(pipeline.stages[r.prevKey] ?? 0) : null;
              const relRaw = r.relative ? pipeline.transitions[r.relative] : null;
              // Only show "from previous" when current ≤ previous (i.e., monotonic). Some
              // GHL pipelines skip canonical stages, so showing 466% would mislead.
              const showRel = relRaw != null && prev != null && prev > 0 && count <= prev;
              const pctOfNew = total > 0 && r.key !== "new" ? (count / total) * 100 : null;
              return (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNum(count)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {showRel ? (
                      <span>
                        <span className="text-foreground font-medium">{formatPct1(relRaw!)}</span>{" "}
                        <span className="text-xs">{RELATIVE_LABEL[r.relative!]}</span>
                      </span>
                    ) : r.relative ? (
                      <span className="text-xs italic text-muted-foreground/70">n/a — leads may skip {r.prevKey}</span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pctOfNew != null ? formatPct1(pctOfNew) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="border-t px-4 py-2 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>Lead → Appointment: <span className="text-foreground font-medium">{formatPct1(pipeline.transitions.lead_to_appointment)}</span></span>
          <span>Lead → Won: <span className="text-foreground font-medium">{formatPct1(pipeline.transitions.lead_to_won)}</span></span>
          <span className="ml-auto">Appointment showed/no-show is provisional — see Data Quality.</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground/80 px-1">
        Some GHL pipelines may skip canonical stages. <span className="font-medium">Stage Reached</span> counts how many leads reached each stage during the window — not a strict linear path. "From previous stage" is shown only when the funnel is monotonic.
      </p>
    </div>
  );
}