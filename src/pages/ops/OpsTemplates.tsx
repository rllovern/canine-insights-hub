// Master SOP templates: versioned, editable in drafts, importable from Asana.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileUp, FileWarning, PencilLine, Send, Trash, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mopsCall } from "@/lib/mops";
import { useMopsOp, fileToBase64, openAttachment } from "@/lib/mops/hooks";
import { buildTree, flattenTree, isMissingDescription, pathOf, type SopNode } from "@/lib/mops/sopTree";
import { SopTreeView, type TreeEditHandlers } from "@/components/ops/SopTreeView";
import { SopDetailPanel } from "@/components/ops/SopDetailPanel";
import { OpsCard } from "@/components/ops/OpsPrimitives";
import { AsanaImportDialog } from "@/components/ops/AsanaImportDialog";

interface Version { id: string; version_no: number | null; status: "draft" | "approved"; note: string | null; published_at: string | null; created_at: string }
interface Template { id: string; key: string; name: string; description: string | null; versions: Version[]; latest_id: string | null; missing: number; tasks: number }

export default function OpsTemplates() {
  const op = useMopsOp();
  const list = useQuery({ queryKey: ["mops", "sop_templates"], queryFn: () => mopsCall<{ templates: Template[] }>("sop_templates") });
  const [tid, setTid] = useState<string | null>(null);
  const t = list.data?.templates.find((x) => x.id === tid) ?? list.data?.templates[0];
  const draft = t?.versions.find((v) => v.status === "draft");
  const [pickedVid, setPickedVid] = useState<string | null>(null);
  const vid = (pickedVid && t?.versions.some((v) => v.id === pickedVid) ? pickedVid : null) ?? draft?.id ?? t?.latest_id ?? null;
  const ver = t?.versions.find((v) => v.id === vid);
  const editable = ver?.status === "draft";
  const tree = useQuery({ queryKey: ["mops", "sop_tree", vid], enabled: !!vid, queryFn: () => mopsCall<{ nodes: SopNode[]; attachments: any[] }>("sop_tree", { version_id: vid }) });
  const nodes = tree.data?.nodes ?? [];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = selId ? byId.get(selId) ?? null : null;
  const [publishOpen, setPublishOpen] = useState(false); const [pubNote, setPubNote] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const attachmentKeys = useMemo(() => new Set((tree.data?.attachments ?? []).map((a: any) => a.stable_key as string)), [tree.data]);

  const startDraft = async () => { if (!t) return; const r = await op.mutateAsync({ op: "sop_draft_ensure", args: { template_id: t.id } }); setPickedVid(r.version_id); };

  const siblings = (n: SopNode) => flattenTree(buildTree(nodes)).map((x) => x.node).filter((x) => x.parent_id === n.parent_id);
  const edit: TreeEditHandlers = {
    addChild: async (parent) => {
      const r = await op.mutateAsync({ op: "sop_node_create", args: { version_id: vid, parent_id: parent?.id ?? null, kind: !parent ? "section" : parent.kind === "section" ? "task" : "subtask", title: !parent ? "New section" : "New task" } });
      setSelId(r.id);
    },
    remove: async (n) => {
      const kids = nodes.filter((x) => x.parent_id === n.id).length;
      if (!confirm(`Delete “${n.title}”${kids ? " and everything under it" : ""} from this draft? Published versions are not affected.`)) return;
      await op.mutateAsync({ op: "sop_node_delete", args: { id: n.id } });
      if (selId === n.id) setSelId(null);
    },
    move: async (n, dir) => {
      const sib = siblings(n); const i = sib.findIndex((x) => x.id === n.id);
      if (dir === "up" || dir === "down") {
        const j = dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= sib.length) return;
        await op.mutateAsync({ op: "sop_node_move", args: { id: n.id, parent_id: n.parent_id, sort: j * 10 + (dir === "up" ? -1 : 1) } });
        // Normalize sibling order so future moves are stable.
        const order = [...sib]; order.splice(i, 1); order.splice(j, 0, n);
        await Promise.all(order.map((x, k) => mopsCall("sop_node_move", { id: x.id, parent_id: n.parent_id, sort: k * 10 })));
        op.reset();
        await tree.refetch();
      } else if (dir === "indent") {
        if (i <= 0) { toast.message("Indent needs a task directly above it"); return; }
        const parent = sib[i - 1];
        const maxSort = Math.max(0, ...nodes.filter((x) => x.parent_id === parent.id).map((x) => x.sort));
        await op.mutateAsync({ op: "sop_node_move", args: { id: n.id, parent_id: parent.id, sort: maxSort + 10 } });
      } else {
        const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
        if (!parent || !parent.parent_id) { toast.message("Already at the top level of its section"); return; }
        await op.mutateAsync({ op: "sop_node_move", args: { id: n.id, parent_id: parent.parent_id, sort: parent.sort + 5 } });
      }
    },
  };

  const missing = nodes.filter(isMissingDescription);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/ops" className="text-muted-foreground hover:text-foreground" aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-2xl font-semibold tracking-tight">SOP templates</h1>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Private to you</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          {(list.data?.templates ?? []).map((x) => {
            const latest = x.versions.find((v) => v.id === x.latest_id);
            return (
              <button key={x.id} onClick={() => { setTid(x.id); setPickedVid(null); setSelId(null); }}
                className={cn("w-full rounded-xl border p-3 text-left transition-colors", x.id === t?.id ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card hover:bg-muted/40")}>
                <div className="font-medium">{x.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">v{latest?.version_no ?? "—"} · {x.tasks} tasks{x.versions.some((v) => v.status === "draft") ? " · draft open" : ""}</div>
                {x.missing > 0 && <div className="mt-1 flex items-center gap-1 text-xs text-ops-access"><FileWarning className="h-3 w-3" />{x.missing} descriptions missing</div>}
              </button>
            );
          })}
        </div>

        {t && (
          <div className="space-y-3">
            <OpsCard className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
              </div>
              <Select value={vid ?? ""} onValueChange={(v) => { setPickedVid(v); setSelId(null); }}>
                <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Version" /></SelectTrigger>
                <SelectContent>
                  {t.versions.map((v) => <SelectItem key={v.id} value={v.id}>{v.status === "draft" ? "Draft (unpublished)" : `v${v.version_no}${v.id === t.latest_id ? " · current" : ""}`}</SelectItem>)}
                </SelectContent>
              </Select>
              {!draft && <Button size="sm" className="gap-1" onClick={startDraft}><PencilLine className="h-3.5 w-3.5" />Edit (new draft)</Button>}
              {draft && !editable && <Button size="sm" variant="outline" onClick={() => setPickedVid(draft.id)}>Open draft</Button>}
              {editable && (
                <>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setImportOpen(true)}><FileUp className="h-3.5 w-3.5" />Import from Asana</Button>
                  <Button size="sm" className="gap-1" onClick={() => setPublishOpen(true)}><Send className="h-3.5 w-3.5" />Publish</Button>
                  <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" onClick={async () => { if (confirm("Discard this draft? Published versions stay as they are.")) { await op.mutateAsync({ op: "sop_draft_discard", args: { template_id: t.id } }); setPickedVid(null); } }}><Trash className="h-3.5 w-3.5" />Discard</Button>
                </>
              )}
            </OpsCard>
            {!editable && ver && <p className="px-1 text-xs text-muted-foreground">Viewing v{ver.version_no}{ver.published_at ? `, published ${new Date(ver.published_at).toLocaleDateString()}` : ""}{ver.note ? ` — ${ver.note}` : ""}. Published versions are read-only; edits go into a draft.</p>}
            {editable && <p className="px-1 text-xs text-muted-foreground">Editing a draft. Clients keep their current version until you publish and then choose to apply it to them.</p>}
            {missing.length > 0 && <p className="px-1 text-xs text-ops-access">{missing.length} of {nodes.filter((n) => n.kind !== "section").length} tasks have no description yet.</p>}
            {tree.isLoading ? <div className="h-64 animate-pulse rounded-xl bg-muted/60" /> : (
              <SopTreeView nodes={nodes} selectedKey={sel?.stable_key} onSelect={(n) => setSelId(n.id)} edit={editable ? edit : undefined} attachmentKeys={attachmentKeys} />
            )}
          </div>
        )}
      </div>

      <SopDetailPanel
        node={sel}
        path={sel ? pathOf(sel, byId) : undefined}
        onClose={() => setSelId(null)}
        attachments={tree.data?.attachments ?? []}
        onOpenAttachment={openAttachment}
        editable={editable}
        onSaveNode={async (patch) => { await op.mutateAsync({ op: "sop_node_update", args: { id: sel!.id, ...patch } }); toast.success("Saved to draft"); }}
        onUpload={editable && t && sel ? async (f) => { await op.mutateAsync({ op: "sop_attach_upload", args: { template_id: t.id, stable_key: sel.stable_key, file_name: f.name, mime: f.type, data_base64: await fileToBase64(f) } }); toast.success("Attached"); } : undefined}
        onDeleteAttachment={editable ? (id) => op.mutate({ op: "sop_attach_delete", args: { id } }) : undefined}
      />

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish {t?.name}</DialogTitle>
            <DialogDescription>New clients will start on this version. Existing clients stay on their current version until you apply the update on their page.</DialogDescription>
          </DialogHeader>
          <Textarea value={pubNote} onChange={(e) => setPubNote(e.target.value)} placeholder="What changed (optional)" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button disabled={op.isPending} onClick={async () => { await op.mutateAsync({ op: "sop_publish", args: { template_id: t!.id, note: pubNote } }); setPublishOpen(false); setPubNote(""); setPickedVid(null); toast.success("Published"); }}>Publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {t && vid && editable && <AsanaImportDialog open={importOpen} onOpenChange={setImportOpen} templateId={t.id} nodes={nodes} onDone={() => tree.refetch()} />}
    </div>
  );
}
