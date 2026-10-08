// Client onboarding: six-area overview → nested SOP workspace → detail panel.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowUpCircle, Lock, ListTree, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { mopsCall } from "@/lib/mops";
import { useSopClient, useMopsOp, fileToBase64, openAttachment, type ClientPin } from "@/lib/mops/hooks";
import { summarize, AREAS, type SopStatus } from "@/lib/mops/readiness";
import { diffVersions, pathOf, isMissingDescription, type SopArea, type SopNode } from "@/lib/mops/sopTree";
import { AreaCard } from "./AreaCard";
import { OpsCard, ProgressRing, ReadinessBadge, StatusPill } from "./OpsPrimitives";
import { SopTreeView } from "./SopTreeView";
import { SopDetailPanel, type HistoryItem } from "./SopDetailPanel";
import { AREA_META } from "./statusMeta";

export function ClientSopWorkspace({ propertyId, locked }: { propertyId: string; locked: boolean }) {
  const q = useSopClient(propertyId);
  const op = useMopsOp();
  const [params, setParams] = useSearchParams();
  const area = (params.get("area") as SopArea | null) ?? null;
  const view = params.get("view") === "list" || area ? "list" : "overview";
  const setArea = (a: SopArea | null, list = true) => {
    const p = new URLSearchParams(params);
    if (a) p.set("area", a); else p.delete("area");
    if (list) p.set("view", "list"); else p.delete("view");
    setParams(p, { replace: true });
  };
  const [selKey, setSelKey] = useState<string | null>(null);
  const [updatePin, setUpdatePin] = useState<ClientPin | null>(null);
  const [latestNodes, setLatestNodes] = useState<SopNode[] | null>(null);

  const d = q.data;
  const allNodes = useMemo(() => (d?.pins ?? []).flatMap((p) => p.nodes), [d]);
  const sum = useMemo(() => d ? summarize(allNodes, { statuses: d.statuses, auto: d.auto, answers: d.answers, classification: d.classification }) : null, [d, allNodes]);
  const byId = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  const attachmentKeys = useMemo(() => new Set((d?.attachments ?? []).map((a) => a.stable_key)), [d]);
  const sel = selKey ? allNodes.find((n) => n.stable_key === selKey) ?? null : null;
  const selPin = sel ? d?.pins.find((p) => p.nodes.some((n) => n.id === sel.id)) : undefined;
  const missingCount = allNodes.filter(isMissingDescription).length;

  if (q.isLoading) return <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-muted/60" />)}</div>;
  if (q.error || !d || !sum) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Could not load procedures"}</p>;

  const setStatus = (n: SopNode, s: SopStatus) => {
    if (locked && n.stable_key !== "discovery_questionnaire") { toast.error("The questionnaire must be submitted before onboarding work can start"); return; }
    op.mutate({ op: "sop_status_set", args: { property_id: propertyId, stable_key: n.stable_key, status: s } });
  };
  const outdated = d.pins.filter((p) => p.latest_id && p.latest_id !== p.version_id);

  const openUpdate = async (pin: ClientPin) => {
    setUpdatePin(pin); setLatestNodes(null);
    const r = await mopsCall<{ nodes: SopNode[] }>("sop_tree", { version_id: pin.latest_id });
    setLatestNodes(r.nodes);
  };
  const diff = updatePin && latestNodes ? diffVersions(updatePin.nodes, latestNodes) : null;

  return (
    <div className="space-y-5">
      {/* Summary strip: completion, readiness and blockers are separate measures */}
      <OpsCard className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={sum.completion} size={68} stroke={6} label="Task completion" />
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Task completion</div>
            <div className="text-sm tabular-nums">{sum.verified} of {sum.applicable} applicable tasks verified</div>
          </div>
        </div>
        <div className="h-10 w-px bg-border max-sm:hidden" />
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Launch readiness</div>
          <ReadinessBadge readiness={sum.readiness} />
          {sum.readiness === "not_assessed" && <p className="mt-1 text-xs text-muted-foreground">Existing client — onboarding history unknown. Nothing here blocks it.</p>}
        </div>
        <div className="h-10 w-px bg-border max-sm:hidden" />
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Blockers</div>
          <div className={cn("flex items-center gap-1.5 text-sm font-semibold", sum.blockers.length ? "text-ops-blocked" : "text-muted-foreground")}>
            {sum.blockers.length ? <AlertTriangle className="h-4 w-4" /> : null}{sum.blockers.length} open · {sum.criticalOpen} critical
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {outdated.map((p) => (
            <Button key={p.template_id} size="sm" variant="outline" className="gap-1.5" onClick={() => openUpdate(p)}>
              <ArrowUpCircle className="h-3.5 w-3.5 text-ops-progress" />{p.template_name}: v{p.version_no} → v{p.latest_no}
            </Button>
          ))}
          <div className="flex rounded-lg border border-border/70 p-0.5">
            <Button size="sm" variant={view === "overview" ? "secondary" : "ghost"} className="h-7 gap-1" onClick={() => setArea(null, false)}><LayoutGrid className="h-3.5 w-3.5" />Overview</Button>
            <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} className="h-7 gap-1" onClick={() => setArea(area, true)}><ListTree className="h-3.5 w-3.5" />Procedures</Button>
          </div>
        </div>
      </OpsCard>

      {locked && (
        <div className="flex items-center gap-2 rounded-lg border border-ops-access/40 bg-ops-access/5 px-4 py-3 text-sm">
          <Lock className="h-4 w-4 text-ops-access" />The questionnaire must be submitted before onboarding work can start. You can still read every procedure.
        </div>
      )}

      {view === "overview" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {AREAS.map((a) => (
              <AreaCard key={a} s={sum.byArea[a]} topBlocker={sum.blockers.find((b) => b.area === a)?.node.title} onOpen={() => setArea(a)} />
            ))}
          </div>
          {sum.blockers.length > 0 && (
            <OpsCard className="p-0">
              <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">What's holding launch</div>
              <ul>
                {sum.blockers.slice(0, 8).map((b) => (
                  <li key={b.node.stable_key}>
                    <button onClick={() => setSelKey(b.node.stable_key)} className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-muted/40">
                      <StatusPill status={b.status} compact />
                      <span className="flex-1 truncate">{b.node.title}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{b.area ? AREA_META[b.area].label : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {sum.blockers.length > 8 && <div className="px-4 py-2 text-xs text-muted-foreground">+{sum.blockers.length - 8} more in Procedures</div>}
            </OpsCard>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant={!area ? "secondary" : "ghost"} className="h-7" onClick={() => setArea(null, true)}>All areas</Button>
            {AREAS.map((a) => {
              const s = sum.byArea[a];
              return (
                <Button key={a} size="sm" variant={area === a ? "secondary" : "ghost"} className="h-7 gap-1.5" onClick={() => setArea(a)}>
                  {AREA_META[a].label}
                  {s.blockers > 0 && <span className="rounded-full bg-ops-blocked/15 px-1.5 text-[10px] font-semibold text-ops-blocked">{s.blockers}</span>}
                </Button>
              );
            })}
            {missingCount > 0 && <span className="ml-auto text-xs text-ops-access">{missingCount} descriptions still need importing</span>}
          </div>
          {d.pins.map((pin) => {
            const has = pin.nodes.some((n) => n.kind !== "section" && (!area || (n.area ?? byId.get(n.parent_id ?? "")?.area) === area));
            if (!has) return null;
            return (
              <div key={pin.template_id} className="space-y-1.5">
                <div className="flex items-baseline gap-2 px-1"><h3 className="text-sm font-semibold">{pin.template_name}</h3><span className="text-xs text-muted-foreground">v{pin.version_no}</span></div>
                <SopTreeView nodes={pin.nodes} area={area} selectedKey={selKey} onSelect={(n) => setSelKey(n.stable_key)} effective={sum.effective} onStatus={setStatus} attachmentKeys={attachmentKeys} />
              </div>
            );
          })}
        </div>
      )}

      <SopDetailPanel
        node={sel}
        path={sel ? pathOf(sel, byId) : undefined}
        onClose={() => setSelKey(null)}
        attachments={d.attachments}
        onOpenAttachment={openAttachment}
        effective={sel ? sum.effective.get(sel.stable_key) : undefined}
        clientNote={sel ? { note: d.statuses[sel.stable_key]?.note ?? null, evidence: d.statuses[sel.stable_key]?.evidence ?? null } : undefined}
        onStatus={sel ? (s) => setStatus(sel, s) : undefined}
        onSaveNote={sel ? async (note, evidence) => { await op.mutateAsync({ op: "sop_status_set", args: { property_id: propertyId, stable_key: sel.stable_key, note, evidence } }); toast.success("Saved for this client"); } : undefined}
        loadHistory={sel ? async () => (await mopsCall<{ history: HistoryItem[] }>("sop_history", { property_id: propertyId, stable_key: sel.stable_key })).history : undefined}
        onUpload={sel && selPin ? async (f, forClient) => {
          await op.mutateAsync({ op: "sop_attach_upload", args: { template_id: selPin.template_id, stable_key: sel.stable_key, property_id: forClient ? propertyId : null, file_name: f.name, mime: f.type, data_base64: await fileToBase64(f) } });
          toast.success("Attached");
        } : undefined}
      />

      <Dialog open={!!updatePin} onOpenChange={(o) => !o && setUpdatePin(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Apply {updatePin?.template_name} v{updatePin?.latest_no}?</DialogTitle>
            <DialogDescription>This client is on v{updatePin?.version_no}. Statuses and notes carry over for every task that still exists. History stays with the version it was recorded under.</DialogDescription>
          </DialogHeader>
          {!diff ? <p className="text-sm text-muted-foreground">Comparing versions…</p> : (
            <div className="max-h-72 space-y-3 overflow-y-auto text-sm">
              {[["Added", diff.added], ["Changed", diff.changed], ["Removed (statuses kept in history)", diff.removed]].map(([label, list]) => (list as SopNode[]).length > 0 && (
                <div key={label as string}><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label as string} · {(list as SopNode[]).length}</div>
                  <ul className="space-y-0.5">{(list as SopNode[]).map((n) => <li key={n.stable_key} className="truncate">{n.title}</li>)}</ul></div>
              ))}
              {diff.added.length + diff.changed.length + diff.removed.length === 0 && <p className="text-muted-foreground">No task differences.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpdatePin(null)}>Keep v{updatePin?.version_no}</Button>
            <Button disabled={!diff || op.isPending} onClick={async () => { await op.mutateAsync({ op: "sop_apply_update", args: { property_id: propertyId, template_id: updatePin!.template_id } }); setUpdatePin(null); toast.success("Procedure updated for this client"); }}>Apply update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
