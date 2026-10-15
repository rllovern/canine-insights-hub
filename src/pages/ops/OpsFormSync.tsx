import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

async function fsCall<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mops-form-sync", { body: { op, args } });
  if (error) {
    let msg = "Request failed";
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as T;
}

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  received: { label: "Received", variant: "outline" },
  matched: { label: "Already in CTM", variant: "secondary" },
  delivered: { label: "Delivered", variant: "default" },
  pending_delivery: { label: "Missing from CTM", variant: "destructive" },
  pending_verification: { label: "Verifying", variant: "outline" },
  needs_review: { label: "Needs review", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString() : "Never");

export default function OpsFormSync() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const ov = useQuery({ queryKey: ["mops", "formsync", "overview"], queryFn: () => fsCall<{ locations: any[] }>("formsync_overview") });
  const pid = sel ?? ov.data?.locations?.[0]?.property_id ?? null;
  const list = useQuery({ queryKey: ["mops", "formsync", "list", pid], enabled: !!pid, queryFn: () => fsCall<{ submissions: any[] }>("formsync_list", { property_id: pid }) });
  const act = useMutation({
    mutationFn: ({ op, args }: { op: string; args: Record<string, unknown> }) => fsCall(op, args),
    onSuccess: (r: any) => { if (r?.dry_run) toast.info(r.reason); else toast.success("Done"); qc.invalidateQueries({ queryKey: ["mops", "formsync"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const loc = ov.data?.locations?.find((l) => l.property_id === pid);
  const c = loc?.counts ?? {};
  const open = list.data?.submissions?.find((s) => s.id === openId);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost"><Link to="/ops"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <h1 className="text-2xl font-semibold">Form Sync</h1>
        <Badge variant="outline">Dry run only — nothing is sent to CTM</Badge>
        {pid && <Button size="sm" className="ml-auto gap-1.5" disabled={act.isPending} onClick={() => act.mutate({ op: "run", args: { property_id: pid } })}><RefreshCw className="h-3.5 w-3.5" />Check now</Button>}
      </div>

      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left"><tr><th className="py-1">Location</th><th>Last successful check</th><th>Failures</th><th>Live delivery</th><th>Schedule</th></tr></thead>
          <tbody>{(ov.data?.locations ?? []).map((l) => (
            <tr key={l.property_id} className={`cursor-pointer ${l.property_id === pid ? "font-medium" : ""}`} onClick={() => setSel(l.property_id)}>
              <td className="py-1">{l.property_name}</td><td>{fmt(l.last_success_at)}</td>
              <td>{l.consecutive_failures}{l.last_error ? ` — ${l.last_error}` : ""}</td>
              <td>{l.delivery_enabled ? "On" : "Off"}</td><td>{l.schedule_enabled ? "Every 5 min" : "Off"}</td>
            </tr>))}</tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[["GHL submissions", c.received], ["Confirmed in CTM", c.confirmed], ["Recovered", c.recovered], ["Awaiting", c.awaiting], ["Needs review", c.needs_review], ["Failed", c.failed]].map(([k, v]) => (
          <Card key={k as string} className="p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-2xl font-semibold">{v ?? 0}</div></Card>
        ))}
      </div>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left border-b"><tr><th className="p-2">Submitted</th><th>Contact</th><th>Ad click</th><th>Status</th><th>CTM activity</th></tr></thead>
          <tbody>{(list.data?.submissions ?? []).map((s) => (
            <tr key={s.id} className="border-b cursor-pointer hover:bg-muted/40" onClick={() => { setOpenId(s.id); setLink(""); }}>
              <td className="p-2 whitespace-nowrap">{fmt(s.submitted_at)}</td>
              <td>{s.masked?.name} · {s.masked?.phone}</td>
              <td>{s.attribution?.gclid ? "Google Ads (GCLID)" : s.attribution?.ghl_source ?? "—"}</td>
              <td><Badge variant={STATUS[s.status]?.variant ?? "outline"}>{STATUS[s.status]?.label ?? s.status}</Badge></td>
              <td>{s.ctm_activity_id ?? "—"}</td>
            </tr>))}</tbody>
        </table>
      </Card>

      {open && (
        <Card className="p-4 space-y-3 text-sm">
          <div className="flex items-center gap-2"><strong>Submission {open.ghl_submission_id}</strong><Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpenId(null)}>Close</Button></div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ op: "recheck", args: { property_id: open.property_id, id: open.id } })}>Re-check against CTM</Button>
            <Input className="w-48 h-8" placeholder="CTM activity ID" value={link} onChange={(e) => setLink(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!link || act.isPending} onClick={() => act.mutate({ op: "review", args: { id: open.id, action: "link", ctm_activity_id: link } })}>Link to this activity</Button>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ op: "review", args: { id: open.id, action: "needs_delivery" } })}>Mark as missing</Button>
            <Button size="sm" disabled={act.isPending || open.status !== "pending_delivery"} onClick={() => act.mutate({ op: "deliver", args: { id: open.id } })}>Preview delivery</Button>
          </div>
          {open.match_detail?.candidates?.length > 0 && (
            <div><div className="text-muted-foreground">Possible CTM matches</div>
              {open.match_detail.candidates.map((k: any) => <div key={k.id}>{k.id} — {k.reasons.join(", ")}</div>)}</div>)}
          <div><div className="text-muted-foreground">Ad attribution</div><pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded">{JSON.stringify(open.attribution, null, 2)}</pre></div>
          {open.dry_run_payload && <div><div className="text-muted-foreground">What would be sent to CTM (contact details hidden)</div><pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded">{JSON.stringify(open.dry_run_payload, null, 2)}</pre></div>}
        </Card>
      )}
    </div>
  );
}
