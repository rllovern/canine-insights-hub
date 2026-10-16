// Private Development Log: the local record of dashboard changes that syncs
// to the "Dashboard Management" Asana project. Entries are recorded at request
// time (original reasoning included) and pushed to Asana hourly and on demand.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Lock, RefreshCw, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { devlogCall } from "@/lib/mops";

interface Entry {
  id: string; change_id: string; title: string; status: string; retrospective: boolean;
  request_text: string | null; why_text: string | null; what_changed: string | null;
  outcome_actual: string | null; followups: string | null;
  asana_subtask_gid: string | null; synced_at: string | null; updated_at: string;
}
interface Day { day: string; asana_task_gid: string | null; entries: Entry[] }
interface DevLogData {
  days: Day[];
  sync: { last_run_at: string | null; last_success_at: string | null; consecutive_failures: number; last_error: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress", deployed: "Deployed", verified: "Verified", blocked: "Blocked",
};

export default function OpsDevLog() {
  const qc = useQueryClient();
  const log = useQuery({ queryKey: ["mops", "devlog"], queryFn: () => devlogCall<DevLogData>("devlog_list") });
  const run = useMutation({
    mutationFn: () => devlogCall("run"),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["mops", "devlog"] });
      toast.success(r?.skipped ? "A sync is already running" : `Synced ${r?.synced ?? 0} change(s) to Asana`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = log.data?.sync;
  const pending = (log.data?.days ?? []).reduce((n, d) => n + d.entries.filter((e) => !e.synced_at).length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Button asChild size="sm" variant="ghost" className="gap-1.5 -ml-2"><Link to="/ops"><ArrowLeft className="h-3.5 w-3.5" />Marketing Ops</Link></Button>
        <Lock className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Development Log</h1>
        <span className="text-xs text-muted-foreground">Syncs to Asana · Dashboard Management</span>
        <Button size="sm" variant="outline" className="ml-auto gap-1.5" disabled={run.isPending} onClick={() => run.mutate()}>
          <RefreshCw className={`h-3.5 w-3.5 ${run.isPending ? "animate-spin" : ""}`} />Sync now
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Sync status</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {log.isLoading ? <p className="text-muted-foreground">Loading…</p> : (
            <>
              <span className="flex items-center gap-1.5">
                {s?.consecutive_failures ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-[var(--ops-ok,#16a34a)]" />}
                {s?.consecutive_failures ? `Failing (${s.consecutive_failures} in a row)` : "Healthy"}
              </span>
              <span className="text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />
                Last successful sync: {s?.last_success_at ? new Date(s.last_success_at).toLocaleString() : "never"}
              </span>
              <span className="text-muted-foreground">{pending} change(s) waiting to sync · runs automatically every hour</span>
              {s?.last_error && <span className="text-destructive w-full">Last error: {s.last_error}</span>}
            </>
          )}
        </CardContent>
      </Card>

      {(log.data?.days ?? []).map((d) => (
        <Card key={d.day}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {d.day} <span className="text-xs font-normal text-muted-foreground">Dashboard Development Log</span>
              {d.asana_task_gid ? <Badge variant="secondary">In Asana</Badge> : <Badge variant="outline">Not yet synced</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.entries.map((e) => (
              <div key={e.id} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{e.title}</span>
                  <Badge variant="outline">{STATUS_LABEL[e.status] ?? e.status}</Badge>
                  {e.retrospective && <Badge variant="secondary">Retrospective summary</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{e.synced_at ? "Synced" : "Pending"}</span>
                </div>
                {e.why_text && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Why: </span>{e.why_text}</p>}
                {e.what_changed && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Changed: </span>{e.what_changed}</p>}
                {e.outcome_actual && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Result: </span>{e.outcome_actual}</p>}
                {e.followups && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Follow-up: </span>{e.followups}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      {!log.isLoading && !(log.data?.days ?? []).length && (
        <p className="text-sm text-muted-foreground">No development entries recorded yet. Entries are added as changes are made.</p>
      )}
    </div>
  );
}
