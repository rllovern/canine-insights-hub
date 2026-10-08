import { useState } from "react";
import { ClientSopWorkspace } from "@/components/ops/ClientSopWorkspace";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Lock, Sparkles } from "lucide-react";
import { mopsCall, mopsSummary, STAGE_LABEL, Q_LABEL, PLATFORM_LABEL } from "@/lib/mops";

const dt = (d?: string | null) => (d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

function Pick({ value, options, onChange, labels }: { value: string; options: string[]; onChange: (v: string) => void; labels?: Record<string, string> }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{labels?.[o] ?? o.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export default function OpsClient() {
  const { propertyId = "" } = useParams();
  const [tab, setTab] = useState("onboarding");
  const qc = useQueryClient();
  const key = ["mops", "client", propertyId];
  const c = useQuery({ queryKey: key, queryFn: () => mopsCall<any>("client", { property_id: propertyId }) });
  const [q, setQ] = useState("");
  const tl = useQuery({ queryKey: ["mops", "timeline", propertyId, q], queryFn: () => mopsCall<{ items: any[] }>("timeline", { property_id: propertyId, q: q || undefined }) });

  const run = useMutation({
    mutationFn: ({ op, args }: { op: string; args: Record<string, unknown> }) => mopsCall(op, { property_id: propertyId, ...args }),
    onSuccess: (r: any) => {
      if (r?.error) toast.error(String(r.error));
      qc.invalidateQueries({ queryKey: ["mops"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (op: string, args: Record<string, unknown>) => run.mutate({ op, args });

  // Journal: one field, one Save.
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [revs, setRevs] = useState<{ id: string; list: any[] } | null>(null);
  const saveNote = async () => {
    try { await mopsCall("journal_create", { property_id: propertyId, body: note }); setNote(""); qc.invalidateQueries({ queryKey: ["mops"] }); }
    catch (e) { toast.error((e as Error).message); }
  };

  const [summary, setSummary] = useState<string | null>(null);
  const summarize = useMutation({ mutationFn: () => mopsSummary(propertyId), onSuccess: setSummary, onError: (e: Error) => toast.error(e.message) });

  const d = c.data;

  if (c.isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (c.error || !d?.property) return <p className="p-6 text-sm text-destructive">{(c.error as Error)?.message ?? "Not found"}</p>;
  const l = d.lifecycle ?? { classification: "legacy", stage: "active", questionnaire_status: "unknown", ads_control: "unknown", manager_linked: "unknown", billing_responsibility: "unknown", billing_status: "unknown", management_responsibility: "unknown" };
  const assets: Record<string, any> = Object.fromEntries((d.assets ?? []).map((a: any) => [a.platform, a]));
  const fc = d.form_config ?? {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/ops" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-2xl font-semibold tracking-tight">{d.property.name}</h1>
        {l.classification === "legacy" && <Badge variant="outline">Legacy / Active · history unknown</Badge>}
        <Badge variant="secondary">{STAGE_LABEL[l.stage]}</Badge>
        <Lock className="ml-auto h-4 w-4 text-muted-foreground" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="journal">Journal & History</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assets">Access & Assets</TabsTrigger>
          <TabsTrigger value="forms">Call & Form Tracking</TabsTrigger>
        </TabsList>

        <TabsContent value="journal" className="space-y-4">
          <Card><CardContent className="space-y-2 p-4">
            <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write anything…" />
            <Button disabled={!note.trim()} onClick={saveNote}>Save</Button>
          </CardContent></Card>
          <Input placeholder="Search notes and changes" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          <div className="space-y-2">
            {(tl.data?.items ?? []).map((it) => (
              <div key={`${it.kind}-${it.id}`} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{dt(it.at)}</span>
                  {it.kind === "note" && <Badge variant="outline">Note</Badge>}
                  {it.kind === "ads_change" && <Badge variant="secondary">Google Ads{it.attributed ? "" : " · account-wide"}</Badge>}
                  {it.kind === "incident" && <Badge variant="destructive">Data incident</Badge>}
                  {it.kind === "budget" && <Badge variant="outline">Budget</Badge>}
                  {it.kind === "note" && it.updated_at && it.updated_at !== it.at && <span>edited</span>}
                </div>
                {it.kind === "note" && (editing?.id === it.id ? (
                  <div className="space-y-2">
                    <Textarea rows={4} value={editing.body} onChange={(e) => setEditing({ id: it.id, body: e.target.value })} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!editing.body.trim()} onClick={async () => { try { await mopsCall("journal_update", { id: it.id, body: editing.body }); setEditing(null); qc.invalidateQueries({ queryKey: ["mops"] }); } catch (e) { toast.error((e as Error).message); } }}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap">{it.body}</p>
                    <div className="mt-1 flex gap-3 text-xs">
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => setEditing({ id: it.id, body: it.body })}>Edit</button>
                      {it.revisions > 0 && <button className="text-muted-foreground hover:text-foreground" onClick={async () => { const r = await mopsCall<any>("journal_revisions", { id: it.id }); setRevs({ id: it.id, list: r.revisions }); }}>History ({it.revisions})</button>}
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => { if (confirm("Hide this note? Its history is kept.")) set("journal_archive", { id: it.id }); }}>Hide</button>
                    </div>
                    {revs?.id === it.id && <div className="mt-2 space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">{revs.list.map((r, i) => <div key={i}><div>{dt(r.revised_at)}</div><p className="whitespace-pre-wrap">{r.body}</p></div>)}</div>}
                  </>
                ))}
                {it.kind === "ads_change" && <p>{it.operation?.toLowerCase()} {it.resource_type?.toLowerCase().replace(/_/g, " ")}{it.campaign ? ` · ${it.campaign}` : ""}{it.ad_group ? ` › ${it.ad_group}` : ""}{it.fields ? ` — ${it.fields}` : ""}<span className="text-muted-foreground"> {it.user ? `by ${it.user}` : ""}</span></p>}
                {it.kind === "incident" && <p>{it.source} sync problem{it.resolved_at ? ` (resolved ${dt(it.resolved_at)})` : " (ongoing)"}</p>}
                {it.kind === "budget" && <p>Monthly budget {it.previous_budget != null ? `$${it.previous_budget} → ` : ""}${it.monthly_budget} from {it.effective_date}</p>}
              </div>
            ))}
            {tl.data && tl.data.items.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
          </div>
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2">
              <label className="flex items-center justify-between gap-2">Stage <Pick value={l.stage} options={Object.keys(STAGE_LABEL)} labels={STAGE_LABEL} onChange={(v) => set("lifecycle_update", { stage: v })} /></label>
              <label className="flex items-center justify-between gap-2">Google Ads controlled by <Pick value={l.ads_control} options={["unknown", "corporate", "franchisee", "prior_agency", "other"]} onChange={(v) => set("lifecycle_update", { ads_control: v })} /></label>
              <label className="flex items-center justify-between gap-2">Linked to our manager account <Pick value={l.manager_linked} options={["unknown", "yes", "no"]} onChange={(v) => set("lifecycle_update", { manager_linked: v })} /></label>
              <label className="flex items-center justify-between gap-2">Who pays Google <Pick value={l.billing_responsibility} options={["franchisee", "corporate", "unknown"]} onChange={(v) => set("lifecycle_update", { billing_responsibility: v })} /></label>
              <label className="flex items-center justify-between gap-2">Billing status <Pick value={l.billing_status} options={["unknown", "not_set_up", "pending", "active", "problem"]} onChange={(v) => set("lifecycle_update", { billing_status: v })} /></label>
              <label className="flex items-center justify-between gap-2">Day-to-day management <Pick value={l.management_responsibility} options={["corporate", "franchisee", "shared", "unknown"]} onChange={(v) => set("lifecycle_update", { management_responsibility: v })} /></label>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Connections</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {d.connections.map((s: any) => <div key={s.source} className="flex justify-between"><span>{PLATFORM_LABEL[s.source] ?? s.source}</span><span className="text-muted-foreground">{s.connected ? `Connected · last synced ${dt(s.last_success_at)}` : "Not connected"}</span></div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Signals</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {d.signals.length === 0 && <p className="text-muted-foreground">Nothing flagged.</p>}
              {d.signals.map((s: any) => <div key={s.id} className="flex justify-between gap-3"><span>{s.reason}</span><span className="text-muted-foreground">{s.resolved_at ? `Resolved ${dt(s.resolved_at)}` : s.state === "action_required" ? "Action required" : "Observing"}</span></div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Private summary</CardTitle>
              <Button size="sm" variant="outline" className="gap-1" disabled={summarize.isPending} onClick={() => summarize.mutate()}><Sparkles className="h-3 w-3" />{summarize.isPending ? "Summarizing…" : "Summarize this location"}</Button>
            </CardHeader>
            <CardContent className="text-sm">{summary ? <p className="whitespace-pre-wrap">{summary}</p> : <p className="text-muted-foreground">Only runs when you ask. Not saved and not shared with Bob.</p>}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="onboarding" className="space-y-4">
          <ClientSopWorkspace propertyId={propertyId} locked={!!d.locked} />
          <Card><CardContent className="space-y-1 p-4 text-sm">
            <div>Questionnaire: <span className="font-medium">{Q_LABEL[l.questionnaire_status]}</span>{l.questionnaire_submitted_at ? ` on ${dt(l.questionnaire_submitted_at)}` : ""}</div>
            {d.invites.length > 0 && <div className="text-muted-foreground">Latest invite: {d.invites[0].contact_name ?? d.invites[0].contact_email} · {d.invites[0].status} · sent {dt(d.invites[0].last_sent_at ?? d.invites[0].created_at)}</div>}
            {l.classification === "legacy" && <p className="text-muted-foreground">Existing location: onboarding history unknown. Nothing here blocks it; track items only if useful.</p>}
          </CardContent></Card>
          {d.submission?.answers && (
            <Card>
              <CardHeader><CardTitle className="text-base">Questionnaire answers</CardTitle></CardHeader>
              <CardContent className="grid gap-1 text-sm md:grid-cols-2">
                {Object.entries(d.submission.answers as Record<string, unknown>).filter(([, v]) => v !== "" && v != null).map(([k, v]) => (
                  <div key={k}><span className="text-muted-foreground">{k.replace(/_/g, " ")}: </span>{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="assets">
          <Card><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-2">Platform</th><th className="p-2">Exists</th><th className="p-2">Controlled by</th><th className="p-2">Our access</th><th className="p-2">Account ID</th></tr></thead>
              <tbody>
                {Object.keys(PLATFORM_LABEL).map((p) => {
                  const a = assets[p] ?? { exists_state: "unknown", controlled_by: "unknown", access_status: "unknown", external_id: "" };
                  const up = (patch: Record<string, unknown>) => set("asset_upsert", { platform: p, exists_state: a.exists_state, controlled_by: a.controlled_by, access_status: a.access_status, external_id: a.external_id ?? "", note: a.note ?? "", ...patch });
                  return (
                    <tr key={p} className="border-t">
                      <td className="p-2 font-medium">{PLATFORM_LABEL[p]}</td>
                      <td className="p-2"><Pick value={a.exists_state} options={["unknown", "yes", "no", "not_applicable"]} onChange={(v) => up({ exists_state: v })} /></td>
                      <td className="p-2"><Pick value={a.controlled_by} options={["unknown", "corporate", "franchisee", "prior_agency", "other"]} onChange={(v) => up({ controlled_by: v })} /></td>
                      <td className="p-2"><Pick value={a.access_status} options={["unknown", "needed", "requested", "granted", "verified", "create_new", "not_applicable"]} onChange={(v) => up({ access_status: v })} /></td>
                      <td className="p-2"><Input className="h-8 w-40" defaultValue={a.external_id ?? ""} onBlur={(e) => e.target.value !== (a.external_id ?? "") && up({ external_id: e.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="forms">
          <Card><CardContent className="grid gap-3 p-4 text-sm md:grid-cols-2">
            {([["thank_you_slug", "Thank-you page path"], ["form_reactor_id", "CTM FormReactor ID"], ["tracking_number", "Tracking number"], ["capture_host", "Capture host"], ["default_form", "Default form"]] as const).map(([k, label]) => (
              <label key={k} className="space-y-1"><span className="text-muted-foreground">{label}</span>
                <Input defaultValue={fc[k] ?? ""} onBlur={(e) => e.target.value !== (fc[k] ?? "") && set("form_config_upsert", { [k]: e.target.value })} />
              </label>
            ))}
            {([["snippet_installed", "Snippet installed"], ["redirect_configured", "Redirect configured"], ["thank_you_exists", "Thank-you page exists"], ["form_reactor_configured", "FormReactor configured"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!fc[k]} onChange={(e) => set("form_config_upsert", { [k]: e.target.checked })} />{label}</label>
            ))}
            <label className="flex items-center justify-between gap-2">End-to-end test <Pick value={fc.e2e_status ?? "untested"} options={["untested", "passed", "failed"]} onChange={(v) => set("form_config_upsert", { e2e_status: v })} /></label>
            {fc.last_verified_at && <span className="text-muted-foreground">Last tested {dt(fc.last_verified_at)}</span>}
            <p className="text-xs text-muted-foreground md:col-span-2">Record-keeping only. The existing GHL-to-CTM connection is not touched.</p>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
