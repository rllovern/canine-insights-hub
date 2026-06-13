import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration } from "@/lib/leadPerf";

type AgentRow = {
  ghl_user_id: string;
  agent_name: string;
  property_count: number;
  assigned: number;
  contacted: number; contact_rate: number;
  booked: number; booking_rate: number;
  showed: number; show_rate: number;
  won: number; win_rate: number;
  median_human_raw_seconds: number | null;
  median_human_business_seconds: number | null;
  avg_human_attempts: number;
  stale_count: number;
  critical_stale_count: number;
  low_sample: boolean;
};

export function AgentLeaderboard({
  propertyIds, from, to, showAppointmentDerivedNote, assignedHint,
}: {
  propertyIds: string[] | null; from: Date; to: Date;
  showAppointmentDerivedNote?: boolean;
  /** Count of assigned leads in window from handling data, used to explain empty leaderboard. */
  assignedHint?: number;
}) {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const { data } = await supabase.rpc("lead_perf_agents", {
        _property_ids: propertyIds, _from: from.toISOString(), _to: to.toISOString(),
      });
      setRows(((data ?? []) as unknown) as AgentRow[]);
      setLoading(false);
    })();
  }, [propertyIds, from, to]);

  if (loading) return <Skeleton className="h-48 w-full rounded-lg" />;
  if (rows.length === 0) {
    const hint = (assignedHint ?? 0) > 0
      ? `Lead Handling shows ${assignedHint} assigned lead${assignedHint === 1 ? "" : "s"} in this window, but no agent rows were returned. This usually means the assigned user id on those leads doesn't match a known GHL user (sync may not have ingested that user yet) — or the agent has no human messaging activity to summarise.`
      : "No assigned leads in window. Either no leads were assigned, or assigned_user_id is missing on the underlying lead facts.";
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground space-y-1">
        <div className="font-medium text-foreground">No agents to display.</div>
        <div>{hint}</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Assigned</TableHead>
            <TableHead className="text-right">Contact %</TableHead>
            <TableHead className="text-right">Booked</TableHead>
            <TableHead className="text-right">Booking %</TableHead>
            <TableHead className="text-right">Showed{showAppointmentDerivedNote && "*"}</TableHead>
            <TableHead className="text-right">Show %</TableHead>
            <TableHead className="text-right">Won</TableHead>
            <TableHead className="text-right">Win %</TableHead>
            <TableHead className="text-right">Median outbound STL</TableHead>
            <TableHead className="text-right">Avg attempts</TableHead>
            <TableHead className="text-right">Stale</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.ghl_user_id}>
              <TableCell>
                <div className="font-medium">{r.agent_name}</div>
                {r.property_count > 1 && (
                  <div className="text-[11px] text-muted-foreground">{r.property_count} properties</div>
                )}
                {r.low_sample && (
                  <Badge variant="outline" className="mt-1 text-[10px]">low sample</Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.assigned}</TableCell>
              <TableCell className="text-right tabular-nums">{r.contact_rate}%</TableCell>
              <TableCell className="text-right tabular-nums">{r.booked}</TableCell>
              <TableCell className="text-right tabular-nums">{r.booking_rate}%</TableCell>
              <TableCell className="text-right tabular-nums">{r.showed}</TableCell>
              <TableCell className="text-right tabular-nums">{r.show_rate}%</TableCell>
              <TableCell className="text-right tabular-nums">{r.won}</TableCell>
              <TableCell className="text-right tabular-nums">{r.win_rate}%</TableCell>
              <TableCell className="text-right tabular-nums">{formatDuration(r.median_human_raw_seconds)}</TableCell>
              <TableCell className="text-right tabular-nums">{Number(r.avg_human_attempts).toFixed(1)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.critical_stale_count > 0 ? (
                  <span className="text-rose-500">{r.critical_stale_count}</span>
                ) : r.stale_count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {showAppointmentDerivedNote && (
        <div className="px-3 py-2 text-[11px] text-muted-foreground border-t">
          * Showed counts include provisional derivations (appointment confirmed + ended in the past). Verified GHL "showed" status overrides where available.
        </div>
      )}
    </div>
  );
}