import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { mopsCall, STAGE_LABEL, Q_LABEL } from "@/lib/mops";
import { AlertTriangle, Eye, CheckCircle2, Lock } from "lucide-react";

type Loc = {
  id: string; name: string; is_active: boolean; classification: string | null; stage: string | null;
  questionnaire_status: string | null; ads_control: string; billing_responsibility: string; billing_status: string;
  connections: Record<string, { connected: boolean; status: string; last_success_at: string | null }>;
  last_activity_at: string | null; blocking: number; blocked: number;
  signals: { key: string; state: string; reason: string }[];
};

function StateBadge({ signals }: { signals: Loc["signals"] }) {
  if (signals.some((s) => s.state === "action_required")) return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Action required</Badge>;
  if (signals.length) return <Badge variant="secondary" className="gap-1"><Eye className="h-3 w-3" />Observing</Badge>;
  return <Badge variant="outline" className="gap-1 text-muted-foreground"><CheckCircle2 className="h-3 w-3" />Healthy</Badge>;
}

function Conn({ c, label }: { c?: { connected: boolean }; label: string }) {
  return <span className={c?.connected ? "text-foreground" : "text-muted-foreground/50"} title={c?.connected ? `${label} connected` : `${label} not connected`}>{label}</span>;
}

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

export default function OpsHome() {
  const qc = useQueryClient();
  const dir = useQuery({ queryKey: ["mops", "directory"], queryFn: () => mopsCall<{ locations: Loc[]; prospects: any[] }>("directory") });
  const brief = useQuery({ queryKey: ["mops", "brief"], queryFn: () => mopsCall<any>("brief") });
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "active" | "onboarding" | "attention">("all");
  const [sort, setSort] = useState<"name" | "activity">("name");

  const rows = useMemo(() => {
    let r = dir.data?.locations ?? [];
    if (q) r = r.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));
    if (view === "active") r = r.filter((l) => l.stage === "active");
    if (view === "onboarding") r = r.filter((l) => l.classification === "onboarding" && !["active", "archived", "paused"].includes(l.stage ?? ""));
    if (view === "attention") r = r.filter((l) => l.signals.length || l.blocked);
    if (sort === "activity") r = [...r].sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
    return r;
  }, [dir.data, q, view, sort]);

  const [pName, setPName] = useState(""); const [pNotes, setPNotes] = useState("");
  const addProspect = useMutation({
    mutationFn: () => mopsCall("prospect_create", { name: pName, notes: pNotes }),
    onSuccess: () => { setPName(""); setPNotes(""); qc.invalidateQueries({ queryKey: ["mops", "directory"] }); toast.success("Prospect added"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const dropProspect = useMutation({
    mutationFn: (id: string) => mopsCall("prospect_update", { id, status: "dropped" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mops", "directory"] }),
  });

  const b = brief.data;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Marketing Ops</h1>
        <span className="text-xs text-muted-foreground">Private to you</span>
      </div>
      <Tabs defaultValue="brief">
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="directory">Client Directory</TabsTrigger>
          <TabsTrigger value="prospects">Prospects{dir.data?.prospects.length ? ` (${dir.data.prospects.length})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="brief" className="space-y-4">
          {brief.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : brief.error ? <p className="text-sm text-destructive">{(brief.error as Error).message}</p> : b && (
            <>
              <p className="text-sm text-muted-foreground">
                {b.healthy_count} locations operating normally.{b.last_reviewed_at ? ` Last reviewed ${new Date(b.last_reviewed_at).toLocaleString()}.` : ""}
              </p>
              <Card>
                <CardHeader><CardTitle className="text-base">Needs a look</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {b.attention.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs attention. Doing nothing is fine.</p>}
                  {b.attention.map((a: any, i: number) => (
                    <Link key={i} to={`/ops/${a.property_id}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/50">
                      <div>
                        <div className="font-medium">{a.name} {a.new && <Badge variant="outline" className="ml-1">New</Badge>}</div>
                        <div className="text-sm text-muted-foreground">{a.reason}</div>
                      </div>
                      {a.state === "action_required" ? <Badge variant="destructive">Action required</Badge> : <Badge variant="secondary">Observing</Badge>}
                    </Link>
                  ))}
                </CardContent>
              </Card>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">Onboarding</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {b.onboarding.length === 0 && <p className="text-muted-foreground">No locations onboarding.</p>}
                    {b.onboarding.map((o: any) => (
                      <Link key={o.property_id} to={`/ops/${o.property_id}`} className="block rounded-md border p-2 hover:bg-muted/50">
                        <div className="font-medium">{o.name}</div>
                        <div className="text-muted-foreground">{STAGE_LABEL[o.stage]} · {o.blocking} required items open{o.blocked.length ? ` · Blocked: ${o.blocked.join(", ")}` : ""}</div>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Google Ads changes (7 days)</CardTitle></CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {b.changes_7d.length === 0 && <p className="text-muted-foreground">No archived changes yet. The archive runs daily.</p>}
                    {b.changes_7d.map((c: any, i: number) => <div key={i} className="flex justify-between"><span>{c.name}</span><span className="text-muted-foreground">{c.count}</span></div>)}
                    {b.change_sync.map((s: any) => (
                      <p key={s.customer_id} className="text-xs text-muted-foreground">
                        Account {s.customer_id}: {s.consecutive_failures ? `${s.consecutive_failures} failed archive runs (${s.last_error ?? ""})` : ""} {s.gap_note ?? ""}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              </div>
              {b.resolved_recently.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Resolved since last review</CardTitle></CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    {b.resolved_recently.map((r: any, i: number) => <div key={i}>{r.name}: {r.reason}</div>)}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="directory" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search locations" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            {(["all", "active", "onboarding", "attention"] as const).map((v) => (
              <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)} className="capitalize">{v === "attention" ? "Needs attention" : v}</Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSort(sort === "name" ? "activity" : "name")}>Sort: {sort === "name" ? "Name" : "Recent activity"}</Button>
          </div>
          {dir.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : dir.error ? <p className="text-sm text-destructive">{(dir.error as Error).message}</p> : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr><th className="p-2">Location</th><th className="p-2">Stage</th><th className="p-2">Questionnaire</th><th className="p-2">Readiness</th><th className="p-2">Connections</th><th className="p-2">Ads control / billing</th><th className="p-2">Last activity</th><th className="p-2">State</th></tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-t hover:bg-muted/30">
                      <td className="p-2"><Link to={`/ops/${l.id}`} className="font-medium hover:underline">{l.name}</Link>{l.classification === "legacy" && <Badge variant="outline" className="ml-2 text-[10px]">Legacy</Badge>}</td>
                      <td className="p-2">{l.stage ? STAGE_LABEL[l.stage] : "Not yet tracked"}</td>
                      <td className="p-2 text-muted-foreground">{Q_LABEL[l.questionnaire_status ?? "unknown"]}</td>
                      <td className="p-2">{l.classification === "legacy" ? <span className="text-muted-foreground">History unknown</span> : l.blocking ? `${l.blocking} required open` : "Ready"}</td>
                      <td className="p-2 space-x-2 text-xs"><Conn c={l.connections.google_ads} label="Ads" /><Conn c={l.connections.ctm} label="CTM" /><Conn c={l.connections.ghl} label="GHL" /></td>
                      <td className="p-2 text-xs text-muted-foreground capitalize">{l.ads_control.replace("_", " ")} · {l.billing_responsibility} pays</td>
                      <td className="p-2 text-muted-foreground">{fmt(l.last_activity_at)}</td>
                      <td className="p-2"><StateBadge signals={l.signals} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="prospects" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">New prospect</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Prospects stay private and never appear in reports or syncs. When you're ready, create the location under Clients; it then shows up in the directory automatically.</p>
              <Input placeholder="Name" value={pName} onChange={(e) => setPName(e.target.value)} />
              <Textarea placeholder="Anything worth remembering" value={pNotes} onChange={(e) => setPNotes(e.target.value)} />
              <Button disabled={!pName.trim() || addProspect.isPending} onClick={() => addProspect.mutate()}>Save</Button>
            </CardContent>
          </Card>
          {(dir.data?.prospects ?? []).map((p) => (
            <Card key={p.id}><CardContent className="flex items-start justify-between gap-3 p-4">
              <div><div className="font-medium">{p.name}</div><div className="whitespace-pre-wrap text-sm text-muted-foreground">{p.notes}</div><div className="text-xs text-muted-foreground">Added {fmt(p.created_at)}</div></div>
              <Button size="sm" variant="ghost" onClick={() => dropProspect.mutate(p.id)}>Remove</Button>
            </CardContent></Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
