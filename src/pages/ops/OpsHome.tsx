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
import { mopsCall, STAGE_LABEL } from "@/lib/mops";
import { AlertTriangle, Eye, CheckCircle2, Lock, BookOpen } from "lucide-react";
import { useSopPortfolio } from "@/lib/mops/hooks";
import { summarize, AREAS, type AreaSummary, type Readiness, type Summary } from "@/lib/mops/readiness";
import { OpsCard, ProgressRing, ReadinessBadge } from "@/components/ops/OpsPrimitives";
import { AREA_META, READINESS_META } from "@/components/ops/statusMeta";
import { cn } from "@/lib/utils";

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
  const [sort, setSort] = useState<"name" | "activity" | "attention">("attention");
  const [readyFilter, setReadyFilter] = useState<Readiness | null>(null);
  const portfolio = useSopPortfolio();
  const summaries = useMemo(() => {
    const m = new Map<string, Summary>();
    const p = portfolio.data;
    if (!p) return m;
    for (const c of p.clients) {
      const nodes = c.pins.flatMap((v) => p.versions[v] ?? []);
      m.set(c.property_id, summarize(nodes, { statuses: c.statuses, auto: c.auto, answers: c.answers, classification: c.classification }));
    }
    return m;
  }, [portfolio.data]);

  const rows = useMemo(() => {
    let r = dir.data?.locations ?? [];
    if (q) r = r.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));
    if (view === "active") r = r.filter((l) => l.stage === "active");
    if (view === "onboarding") r = r.filter((l) => l.classification === "onboarding" && !["active", "archived", "paused"].includes(l.stage ?? ""));
    if (view === "attention") r = r.filter((l) => l.signals.length || l.blocked || (summaries.get(l.id)?.blockers.length ?? 0) > 0);
    if (readyFilter) r = r.filter((l) => summaries.get(l.id)?.readiness === readyFilter);
    if (sort === "activity") r = [...r].sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
    if (sort === "attention") {
      const score = (l: Loc) => (l.signals.some((s) => s.state === "action_required") ? 1000 : 0) + (summaries.get(l.id)?.blockers.length ?? 0) * 10 + l.signals.length;
      r = [...r].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
    }
    return r;
  }, [dir.data, q, view, sort, readyFilter, summaries]);

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
        <h1 className="text-2xl font-semibold tracking-tight">Marketing Ops</h1>
        <span className="text-xs text-muted-foreground">Private to you</span>
        <Button asChild size="sm" variant="outline" className="ml-auto gap-1.5"><Link to="/ops/templates"><BookOpen className="h-3.5 w-3.5" />SOP templates</Link></Button>
      </div>
      <Tabs defaultValue="directory">
        <TabsList>
          <TabsTrigger value="directory">Clients</TabsTrigger>
          <TabsTrigger value="brief">Brief</TabsTrigger>
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

        <TabsContent value="directory" className="space-y-4">
          <PortfolioStrip rows={dir.data?.locations ?? []} summaries={summaries} onPick={(r) => setReadyFilter(readyFilter === r ? null : r)} active={readyFilter} />
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search locations" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
            {(["all", "active", "onboarding", "attention"] as const).map((v) => (
              <Button key={v} size="sm" variant={view === v ? "secondary" : "ghost"} onClick={() => setView(v)} className="h-8 capitalize">{v === "attention" ? "Needs attention" : v}</Button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => setSort(sort === "name" ? "attention" : sort === "attention" ? "activity" : "name")}>Sort: {sort === "name" ? "Name" : sort === "attention" ? "Needs attention" : "Recent activity"}</Button>
          </div>
          {dir.isLoading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />)}</div> : dir.error ? <p className="text-sm text-destructive">{(dir.error as Error).message}</p> : (
            <OpsCard className="divide-y divide-border/60 overflow-hidden">
              <div className="hidden grid-cols-[minmax(180px,1.4fr)_120px_70px_150px_90px_120px] items-center gap-4 bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
                <span>Client</span><span>Readiness</span><span>Done</span><span>Areas</span><span>Blockers</span><span>Signals</span>
              </div>
              {rows.map((l) => {
                const sm = summaries.get(l.id);
                return (
                  <Link key={l.id} to={`/ops/${l.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 lg:grid-cols-[minmax(180px,1.4fr)_120px_70px_150px_90px_120px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate font-medium">{l.name}{l.classification === "legacy" && <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">Legacy</span>}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">{l.stage ? STAGE_LABEL[l.stage] : "Not yet tracked"}<span className="space-x-1.5"><Conn c={l.connections.google_ads} label="Ads" /><Conn c={l.connections.ctm} label="CTM" /><Conn c={l.connections.ghl} label="GHL" /></span></div>
                    </div>
                    <div>{sm ? <ReadinessBadge readiness={sm.readiness} /> : <span className="text-xs text-muted-foreground">—</span>}</div>
                    <div className="max-lg:hidden">{sm && <ProgressRing value={sm.completion} size={36} stroke={3.5} />}</div>
                    <div className="flex items-center gap-1.5 max-lg:col-span-2">{sm && AREAS.map((a) => <AreaDot key={a} s={sm.byArea[a]} />)}</div>
                    <div className={sm?.blockers.length ? "text-sm font-semibold text-ops-blocked" : "text-sm text-muted-foreground"}>{sm ? (sm.blockers.length ? `${sm.blockers.length} open` : "None") : "—"}</div>
                    <div><StateBadge signals={l.signals} /></div>
                  </Link>
                );
              })}
              {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No clients match.</p>}
            </OpsCard>
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

function AreaDot({ s }: { s: AreaSummary }) {
  const state = s.blockers > 0 ? "blocked" : !s.applicable ? "na" : s.verified === s.applicable ? "verified" : s.verified > 0 || (s.counts.in_progress ?? 0) + (s.counts.awaiting_verification ?? 0) + (s.counts.awaiting_access ?? 0) > 0 ? "progress" : s.unknown > 0 ? "unknown" : "idle";
  const cls = {
    blocked: "bg-ops-blocked", verified: "bg-ops-verified", progress: "bg-ops-progress/70", na: "bg-ops-na/40",
    unknown: "border border-dashed border-ops-unknown bg-transparent", idle: "border border-border bg-transparent",
  }[state];
  return <span className={cn("h-3 w-3 rounded-full", cls)} title={`${AREA_META[s.area].label}: ${s.applicable ? `${s.verified}/${s.applicable} verified` : "nothing applicable"}${s.blockers ? `, ${s.blockers} blocker(s)` : ""}`} />;
}

function PortfolioStrip({ rows, summaries, onPick, active }: { rows: Loc[]; summaries: Map<string, Summary>; onPick: (r: Readiness) => void; active: Readiness | null }) {
  const counts: Record<Readiness, number> = { not_ready: 0, at_risk: 0, launch_ready: 0, not_assessed: 0 };
  rows.forEach((l) => { const s = summaries.get(l.id); if (s) counts[s.readiness]++; });
  const action = rows.filter((l) => l.signals.some((s) => s.state === "action_required")).length;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {(["not_ready", "at_risk", "launch_ready", "not_assessed"] as Readiness[]).map((r) => (
        <button key={r} onClick={() => onPick(r)} className={cn("rounded-xl border bg-card p-3 text-left shadow-[var(--ops-shadow)] transition-colors hover:bg-muted/30", active === r ? "border-primary/50 ring-1 ring-primary/30" : "border-border/70")}>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("h-1.5 w-1.5 rounded-full", READINESS_META[r].dot)} />{READINESS_META[r].label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{counts[r]}</div>
        </button>
      ))}
      <div className="col-span-2 rounded-xl border border-border/70 bg-card p-3 shadow-[var(--ops-shadow)] md:col-span-1">
        <div className="text-xs text-muted-foreground">Live signals needing action</div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", action ? "text-ops-blocked" : "")}>{action}</div>
      </div>
    </div>
  );
}
