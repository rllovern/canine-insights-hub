import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DrillIssue, ISSUE_LABEL, formatDuration } from "@/lib/leadPerf";

type Row = {
  property_id: string;
  property_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  assigned_user_id: string | null;
  agent_name: string | null;
  lead_created_at: string | null;
  stage_id: string | null;
  stage_name: string | null;
  canonical_stage: string | null;
  last_activity_at: string | null;
  first_human_response_at: string | null;
  speed_to_lead_seconds: number | null;
  human_attempt_count: number | null;
  issue_type: string;
  ghl_deep_link: string | null;
};

export function DrillSheet({
  issue,
  propertyIds,
  from,
  to,
  onClose,
}: {
  issue: DrillIssue | null;
  propertyIds: string[] | null;
  from: Date;
  to: Date;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!issue) return;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error } = await supabase.rpc("lead_perf_drill", {
        _issue_type: issue,
        _property_ids: propertyIds,
        _from: from.toISOString(),
        _to: to.toISOString(),
        _limit: 500,
      });
      if (error) setError(error.message);
      else setRows((data ?? []) as unknown as Row[]);
      setLoading(false);
    })();
  }, [issue, propertyIds, from, to]);

  const showAgent = propertyIds === null || (propertyIds?.length ?? 0) > 1;

  return (
    <Sheet open={!!issue} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{issue ? ISSUE_LABEL[issue] : ""}</SheetTitle>
          <SheetDescription>
            Showing up to 500 rows scoped to the current reporting window.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows match this issue in the current window.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  {showAgent && <TableHead>Property</TableHead>}
                  <TableHead>Agent</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">STL</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.property_id}-${r.contact_id ?? r.stage_id ?? i}`}>
                    <TableCell className="font-medium">
                      <div className="truncate max-w-[14rem]">{r.contact_name || r.contact_id || "—"}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[14rem]">
                        {r.phone || r.email || ""}
                      </div>
                    </TableCell>
                    {showAgent && <TableCell className="text-xs">{r.property_name ?? "—"}</TableCell>}
                    <TableCell className="text-xs">{r.agent_name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                    <TableCell className="text-xs">
                      {r.stage_name ?? "—"}
                      {r.canonical_stage && (
                        <Badge variant="outline" className="ml-1 text-[10px]">{r.canonical_stage}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.lead_created_at ? new Date(r.lead_created_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatDuration(r.speed_to_lead_seconds)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{r.human_attempt_count ?? "—"}</TableCell>
                    <TableCell>
                      {r.ghl_deep_link && (
                        <a href={r.ghl_deep_link} target="_blank" rel="noopener" className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                          GHL <ExternalLink className="size-3" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}