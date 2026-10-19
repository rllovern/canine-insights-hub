import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";
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
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  received: { label: "Received", variant: "outline" }, matched: { label: "Already in CTM", variant: "secondary" },
  delivered: { label: "Recovered", variant: "default" }, pending_delivery: { label: "Missing in CTM", variant: "destructive" },
  held: { label: "On hold", variant: "outline" }, pending_verification: { label: "Verifying", variant: "outline" },
  needs_review: { label: "Needs review", variant: "outline" }, failed: { label: "Failed", variant: "destructive" },
};
const HOLD: Record<string, string> = { before_activation: "Before activation — needs individual approval", form_not_mapped: "Form not set up (unclassified, operational, or missing source/message field)", monitor_unconfirmed: "Not confirmed in CTM after 7 days (monitoring only)" };
const QUAL: Record<string, string> = { classified: "Classified", pending: "Waiting for AskAI", needs_qualification: "Needs qualification" };
const MODE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  live: { label: "Live recovery", variant: "default" }, monitor: { label: "Monitoring only", variant: "secondary" }, off: { label: "Held", variant: "outline" },
};
const DISC = ["all", "missing", "recovered", "duplicates_prevented", "review", "qualification", "failed"] as const;
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString() : "Never");
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function rowMatches(r: any, disc: string) {
  if (disc === "all") return true;
  if (disc === "missing") return ["pending_delivery", "received"].includes(r.st);
  if (disc === "recovered") return r.rec && r.st === "delivered";
  if (disc === "duplicates_prevented") return r.st === "matched";
  if (disc === "review") return r.st === "needs_review";
  if (disc === "qualification") return r.q === "needs_qualification";
  if (disc === "failed") return r.st === "failed";
  return true;
}

export default function OpsFormSync() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(-1));
  const [locFilter, setLocFilter] = useState("all");
  const [src, setSrc] = useState("all");
  const [disc, setDisc] = useState<string>("all");
  const [sel, setSel] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const ov = useQuery({ queryKey: ["mops", "recon", "overview", from], queryFn: () => fsCall<{ locations: any[]; runtime: any }>("formsync_recon_overview", { from }), refetchInterval: 60000 });
  const locs = ov.data?.locations ?? [];
  const sources = useMemo(() => [...new Set(locs.flatMap((l) => (l.rows ?? []).map((r: any) => r.src ?? "unknown")))], [locs]);

  const agg = useMemo(() => {
    const t = { subs: 0, confirmed: 0, missing: 0, recovered: 0, dup: 0, review: 0, qual: 0, failed: 0, calls: 0 };
    for (const l of locs) {
      if (locFilter !== "all" && l.property_id !== locFilter) continue;
      t.calls += Number(l.calls_open ?? 0);
      for (const r of l.rows ?? []) {
        if (r.d > to || (src !== "all" && (r.src ?? "unknown") !== src) || !rowMatches(r, disc) || r.st === "held") continue;
        t.subs++; if (["matched", "delivered"].includes(r.st)) t.confirmed++;
        if (["pending_delivery", "received"].includes(r.st)) t.missing++;
        if (r.rec && r.st === "delivered") t.recovered++;
        if (r.st === "matched") t.dup++;
        if (r.st === "needs_review") t.review++;
        if (r.q === "needs_qualification") t.qual++;
        if (r.st === "failed") t.failed++;
      }
    }
    return t;
  }, [locs, locFilter, src, disc, to]);

  const pid = sel;
  const loc = locs.find((l) => l.property_id === pid);
  const detail = useQuery({ queryKey: ["mops", "recon", "loc", pid], enabled: !!pid, queryFn: () => fsCall<any>("formsync_recon_location", { property_id: pid }) });
  const list = useQuery({ queryKey: ["mops", "recon", "list", pid], enabled: !!pid, queryFn: () => fsCall<{ submissions: any[] }>("formsync_list", { property_id: pid }) });
  const watch = useQuery({ queryKey: ["mops", "recon", "watch", pid], enabled: pid === "a5f7eeea-dfe6-4ec2-a9eb-895d99c0c465" && loc?.mode === "live",
    queryFn: () => fsCall<{ submissions: any[] }>("norcal_watch"), refetchInterval: 60000 });
  const act = useMutation({
    mutationFn: ({ op, args }: { op: string; args: Record<string, unknown> }) => fsCall(op, args),
    onSuccess: () => { toast.success("Done"); qc.invalidateQueries({ queryKey: ["mops", "recon"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const subs = (list.data?.submissions ?? []).filter((s) => (src === "all" || (s.form_source ?? "unknown") === src)
    && rowMatches({ st: s.status, rec: s.recovered, q: s.qualification }, disc) && s.submitted_at.slice(0, 10) >= from && s.submitted_at.slice(0, 10) <= to);
  const open = list.data?.submissions?.find((s) => s.id === openId);
  const lastRun = ov.data?.runtime?.last_scheduled_run_at;
  const stale = lastRun && Date.now() - Date.parse(lastRun) > 20 * 60000;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="sm" variant="ghost"><Link to="/ops"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <h1 className="text-2xl font-semibold">Lead Reconciliation</h1>
        <Badge variant={stale ? "destructive" : "outline"}>Automatic check: {lastRun ? `last ran ${fmt(lastRun)}` : "not run yet"}{stale ? " — interrupted" : " · every 5 min"}</Badge>
      </div>

      <Card className="p-3 flex flex-wrap gap-3 items-end text-sm">
        <label className="space-y-1"><div className="text-xs text-muted-foreground">Location</div>
          <select className="h-8 rounded-md border bg-background px-2" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
            <option value="all">All locations</option>{locs.map((l) => <option key={l.property_id} value={l.property_id}>{l.property_name}</option>)}</select></label>
        <label className="space-y-1"><div className="text-xs text-muted-foreground">From</div><Input type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="space-y-1"><div className="text-xs text-muted-foreground">To</div><Input type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="space-y-1"><div className="text-xs text-muted-foreground">Source</div>
          <select className="h-8 rounded-md border bg-background px-2" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="all">All sources</option>{sources.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="space-y-1"><div className="text-xs text-muted-foreground">Discrepancy</div>
          <select className="h-8 rounded-md border bg-background px-2" value={disc} onChange={(e) => setDisc(e.target.value)}>
            {DISC.map((d) => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}</select></label>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[["GHL form submissions", agg.subs], ["Confirmed in CTM", agg.confirmed], ["Missing in CTM", agg.missing], ["Recovered automatically", agg.recovered],
          ["Duplicates prevented", agg.dup], ["Awaiting review", agg.review], ["Call discrepancies (open)", agg.calls], ["Awaiting qualification", agg.qual], ["Failures", agg.failed],
          ["Locations live / monitoring", `${locs.filter((l) => l.mode === "live").length} / ${locs.filter((l) => l.mode === "monitor").length}`]].map(([k, v]) => (
          <Card key={k as string} className="p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-2xl font-semibold">{v ?? 0}</div></Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Held submissions (older than a location's start, or from forms not set up) are excluded from these totals. Google Ads click IDs are kept as CTM custom fields; CTM's native Google Ads attribution for recovered leads is not verified.</p>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left border-b"><tr><th className="p-2">Location</th><th>Status</th><th>Forms monitored</th><th>Last successful check</th><th>Checks</th><th>Calls</th></tr></thead>
          <tbody>{locs.filter((l) => locFilter === "all" || l.property_id === locFilter).map((l) => (
            <tr key={l.property_id} className={`border-b cursor-pointer hover:bg-muted/40 ${l.property_id === pid ? "bg-muted/40" : ""}`} onClick={() => { setSel(l.property_id); setOpenId(null); }}>
              <td className="p-2 font-medium">{l.property_name}</td>
              <td><Badge variant={l.manual_hold ? "outline" : MODE[l.mode]?.variant}>{l.manual_hold ? "Paused by admin" : MODE[l.mode]?.label}</Badge></td>
              <td>{l.forms?.monitored ?? 0}{l.forms?.unclassified ? <span className="text-destructive"> · {l.forms.unclassified} to review</span> : null}</td>
              <td>{fmt(l.last_success_at)}{l.consecutive_failures ? <span className="text-destructive"> · {l.consecutive_failures} failed</span> : null}</td>
              <td className="max-w-xs truncate" title={(l.preflight_reasons ?? []).join("\n")}>{l.preflight_status ?? "Not run"}{l.preflight_reasons?.length ? ` · ${l.preflight_reasons.length} issue(s)` : ""}</td>
              <td>{l.calls_open ?? 0} open · {l.call_expectation}</td>
            </tr>))}</tbody>
        </table>
      </Card>

      {loc && (
        <Card className="p-4 space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-base">{loc.property_name}</strong>
            <Badge variant={loc.manual_hold ? "outline" : MODE[loc.mode]?.variant}>{loc.manual_hold ? `Paused: ${loc.manual_hold_reason}` : MODE[loc.mode]?.label}</Badge>
            {loc.readiness && <Badge variant="outline">{loc.readiness.replace(/_/g, " ")}</Badge>}
            <span className="text-muted-foreground">Started {fmt(loc.activation_at)} · FormReactor {loc.form_reactor ?? "—"}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" disabled={act.isPending} onClick={() => act.mutate({ op: "preflight", args: { property_id: loc.property_id } })}><ShieldCheck className="h-3.5 w-3.5" />Run checks now</Button>
              {!loc.manual_hold && loc.mode !== "off" && <Button size="sm" variant="outline" className="gap-1.5" disabled={act.isPending} onClick={() => act.mutate({ op: "run", args: { property_id: loc.property_id } })}><RefreshCw className="h-3.5 w-3.5" />Reconcile now</Button>}
              {loc.manual_hold
                ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => confirm(`Resume ${loc.property_name}? It will start in monitoring only after its checks pass.`) && act.mutate({ op: "formsync_recon_set_hold", args: { property_id: loc.property_id, hold: false } })}>Resume</Button>
                : <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => { const r = prompt("Reason for pausing"); if (r !== null) act.mutate({ op: "formsync_recon_set_hold", args: { property_id: loc.property_id, hold: true, reason: r } }); }}>Pause</Button>}
              {loc.mode === "monitor" && !loc.manual_hold && loc.preflight_status === "passed" && <Button size="sm" disabled={act.isPending} onClick={() => confirm(`Approve live CTM recovery for ${loc.property_name}? Missing leads will be sent to CTM automatically after the 15-minute grace period.`) && act.mutate({ op: "formsync_recon_set_live", args: { property_id: loc.property_id, live: true } })}>Approve live recovery</Button>}
              {loc.mode === "live" && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => confirm("Stop live sending and switch to monitoring only?") && act.mutate({ op: "formsync_recon_set_live", args: { property_id: loc.property_id, live: false } })}>Stop live sending</Button>}
            </div>
          </div>

          <section className="space-y-1">
            <div className="font-medium">Latest checks</div>
            {(detail.data?.preflight?.[0]?.checks ?? []).map((c: any) => (
              <div key={c.key} className="flex gap-2"><span className={c.ok ? "text-primary" : c.hard ? "text-destructive" : "text-muted-foreground"}>{c.ok ? "✓" : c.hard ? "✗" : "!"}</span><span>{c.label}</span><span className="text-muted-foreground">— {c.detail}</span></div>))}
            {!detail.data?.preflight?.length && <div className="text-muted-foreground">Not run yet.</div>}
          </section>

          {watch.data && <section className="space-y-2">
            <div className="font-medium">First five production submissions · {watch.data.submissions.length}/5 received</div>
            {!watch.data.submissions.length && <div className="text-muted-foreground">Awaiting new production submissions.</div>}
            {watch.data.submissions.map((s) => <div key={s.id} className="border-t py-2 flex flex-wrap gap-2">
              <span>{fmt(s.submitted_at)}</span><span>{s.production_evidence?.delivery_origin ?? STATUS[s.status]?.label}</span>
              <span>CTM activities: {s.production_evidence?.activity_count ?? "Not checked"}</span>
              <Badge variant={s.production_evidence?.inquiry_complete ? "secondary" : "destructive"}>{s.production_evidence?.inquiry_complete ? "Full inquiry confirmed" : "Inquiry needs review"}</Badge>
              <Badge variant="outline">{s.production_evidence?.askai_verified ? "AskAI verified" : "AskAI origin unverified"}</Badge>
            </div>)}
          </section>}

          <section className="space-y-1">
            <div className="font-medium">Forms</div>
            <table className="w-full text-sm"><thead className="text-muted-foreground text-left"><tr><th>Form</th><th>30 days</th><th>Type</th><th>Source</th><th>Message field</th></tr></thead>
              <tbody>{(detail.data?.forms ?? []).map((f: any) => (
                <tr key={f.ghl_form_id} className="border-t">
                  <td className="py-1">{f.name}{f.classification_source === "manual" ? <span className="text-muted-foreground"> · reviewed</span> : null}</td>
                  <td>{f.submissions_30d}</td>
                  <td><select className="h-7 rounded border bg-background px-1" value={f.classification} onChange={(e) => act.mutate({ op: "formsync_recon_form_classify", args: { property_id: loc.property_id, ghl_form_id: f.ghl_form_id, classification: e.target.value } })}>
                    <option value="inquiry">Customer inquiry</option><option value="operational">Operational / admin</option><option value="unclassified">Unclassified</option></select></td>
                  <td><select className="h-7 rounded border bg-background px-1" value={f.form_source ?? ""} onChange={(e) => act.mutate({ op: "formsync_recon_form_classify", args: { property_id: loc.property_id, ghl_form_id: f.ghl_form_id, form_source: e.target.value } })}>
                    <option value="">Unknown</option>{["ppc", "website", "yelp", "facebook", "boarding", "referral"].map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                  <td><select className="h-7 rounded border bg-background px-1" value={f.message_key ?? ""} onChange={(e) => act.mutate({ op: "formsync_recon_form_classify", args: { property_id: loc.property_id, ghl_form_id: f.ghl_form_id, message_key: e.target.value } })}>
                    <option value="">Not detected</option>{[...new Set([f.message_key, ...(f.message_key_candidates ?? []).map((c: any) => c.key)].filter(Boolean))].map((k: any) => <option key={k} value={k}>{k}</option>)}</select></td>
                </tr>))}</tbody></table>
          </section>

          <section className="space-y-1">
            <div className="flex items-center gap-2"><span className="font-medium">Calls in CTM without a GHL contact</span>
              <select className="h-7 rounded border bg-background px-1 ml-auto" value={loc.call_expectation} onChange={(e) => act.mutate({ op: "formsync_recon_set_call_expectation", args: { property_id: loc.property_id, expectation: e.target.value } })}>
                <option value="unverified">Expectation unverified</option><option value="expected">Verified: calls should reach GHL</option><option value="not_expected">Verified: calls do not sync to GHL</option></select></div>
            <div className="text-xs text-muted-foreground">Monitoring only. Nothing is created or changed in CTM or GHL.</div>
            {(detail.data?.calls ?? []).filter((c: any) => c.status === "open").slice(0, 20).map((c: any) => <div key={c.id}>{fmt(c.called_at)} · caller {c.caller_masked} · CTM {c.ctm_call_id}</div>)}
          </section>

          <section>
            <div className="font-medium mb-1">Leads</div>
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left border-b"><tr><th className="p-1">Submitted</th><th>Contact</th><th>Source</th><th>Ad click</th><th>Status</th><th>CTM activity</th><th>Qualification</th></tr></thead>
              <tbody>{subs.map((s) => (
                <tr key={s.id} className="border-b cursor-pointer hover:bg-muted/40" onClick={() => { setOpenId(s.id); setLink(""); }}>
                  <td className="p-1 whitespace-nowrap">{fmt(s.submitted_at)}</td><td>{s.masked?.name} · {s.masked?.phone}</td><td>{s.form_source ?? "unknown"}</td>
                  <td>{s.attribution?.gclid ? "GCLID (custom field)" : s.attribution?.gbraid ? "GBRAID" : s.attribution?.wbraid ? "WBRAID" : "—"}</td>
                  <td><Badge variant={STATUS[s.status]?.variant ?? "outline"}>{STATUS[s.status]?.label ?? s.status}</Badge></td>
                  <td>{s.ctm_activity_id ?? "—"}</td>
                  <td>{s.qualification ? <Badge variant={s.qualification === "needs_qualification" ? "destructive" : "outline"}>{s.qualification === "needs_qualification" ? `${QUAL[s.qualification]}${s.ctm_tag ? ` · ${s.ctm_tag} tag only` : ""}` : s.ctm_tag ?? QUAL[s.qualification]}</Badge> : "—"}</td>
                </tr>))}</tbody>
            </table>
          </section>

          {open && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center gap-2"><strong>Submission {open.ghl_submission_id}</strong><Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpenId(null)}>Close</Button></div>
              <div className="flex flex-wrap gap-2">
                <Input className="w-48 h-8" placeholder="CTM activity ID" value={link} onChange={(e) => setLink(e.target.value)} />
                <Button size="sm" variant="outline" disabled={!link || act.isPending} onClick={() => act.mutate({ op: "review", args: { id: open.id, action: "link", ctm_activity_id: link } })}>Link to this activity</Button>
                {["held", "needs_review"].includes(open.status) && <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ op: "review", args: { id: open.id, action: "approve" } })}>Approve for delivery</Button>}
              </div>
              <div className="text-muted-foreground">GHL submitted {fmt(open.submitted_at)}{open.ctm_created_at ? ` · CTM created ${fmt(open.ctm_created_at)}` : ""}{open.hold_reason ? ` · ${HOLD[open.hold_reason] ?? open.hold_reason}` : ""}{open.last_error ? ` · Last error: ${open.last_error}` : ""}{open.attempts ? ` · ${open.attempts} attempt(s)` : ""}</div>
              {open.match_detail?.candidates?.length > 0 && <div><div className="text-muted-foreground">Possible CTM matches</div>{open.match_detail.candidates.map((k: any) => <div key={k.id}>{k.id} — {k.reasons.join(", ")}</div>)}</div>}
              <div><div className="text-muted-foreground">Ad attribution (stored as CTM custom fields; native CTM Google Ads attribution not verified)</div><pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded">{JSON.stringify(open.attribution, null, 2)}</pre></div>
            </div>
          )}

          <section>
            <div className="font-medium mb-1">Sync history</div>
            <div className="max-h-64 overflow-y-auto text-xs space-y-0.5">{(detail.data?.history ?? []).map((h: any) => <div key={h.id}>{fmt(h.at)} · {h.kind} · {h.outcome}</div>)}</div>
          </section>
        </Card>
      )}
    </div>
  );
}
