// Asana import with a full preview. Nothing is written until you confirm; existing text is never replaced without a checkbox.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mopsCall } from "@/lib/mops";
import { buildActions, matchImport, parseAsanaCsv, parseAsanaJson, type MatchKind, type MatchResult } from "@/lib/mops/importMatch";
import { pathOf, type SopNode } from "@/lib/mops/sopTree";

const KIND_META: Record<MatchKind, { label: string; cls: string }> = {
  new: { label: "New", cls: "text-ops-progress bg-ops-progress/10" },
  updated: { label: "Updated", cls: "text-ops-access bg-ops-access/10" },
  unchanged: { label: "Unchanged", cls: "text-muted-foreground bg-muted" },
  ambiguous: { label: "Needs your choice", cls: "text-ops-blocked bg-ops-blocked/10" },
};

type Res = Record<string, { mode: "skip" | "new" | "match"; nodeId?: string; parentId?: string | null }>;

export function AsanaImportDialog({ open, onOpenChange, templateId, nodes, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; templateId: string; nodes: SopNode[]; onDone: () => void }) {
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [res, setRes] = useState<Res>({});
  const [filter, setFilter] = useState<MatchKind | "all">("all");
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const load = async (f: File) => {
    try {
      const text = await f.text();
      const rows = f.name.toLowerCase().endsWith(".json") ? parseAsanaJson(text) : parseAsanaCsv(text);
      if (!rows.length) throw new Error("No tasks found in this file");
      setFileName(f.name); setResults(matchImport(rows, nodes)); setRes({});
    } catch (e) { toast.error((e as Error).message); }
  };
  const counts = useMemo(() => {
    const c: Record<MatchKind, number> = { new: 0, updated: 0, unchanged: 0, ambiguous: 0 };
    results?.forEach((r) => c[r.kind]++);
    return c;
  }, [results]);
  const toggle = (r: MatchResult) => setResults((rs) => rs!.map((x) => (x === r ? { ...x, accept: !x.accept } : x)));
  const actions = results ? buildActions(results, res) : [];
  const unresolved = results?.filter((r) => r.kind === "ambiguous" && !res[r.row.ref]).length ?? 0;

  const commit = async () => {
    setBusy(true);
    try {
      const r = await mopsCall<any>("sop_import_commit", { template_id: templateId, source: fileName.endsWith(".json") ? "asana_json" : "asana_csv", file_name: fileName, actions, summary: counts });
      if (r?.error) throw new Error(r.error);
      toast.success(`Imported into draft: ${r.created} created, ${r.updated} updated`);
      onOpenChange(false); setResults(null); onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const shown = (results ?? []).filter((r) => filter === "all" || r.kind === filter);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Import from Asana</DialogTitle>
          <DialogDescription>Upload an Asana project export (CSV or JSON). Tasks are matched by Asana ID first, then by full section › task › subtask path. Nothing is saved until you confirm, and it goes into the draft only.</DialogDescription>
        </DialogHeader>
        {!results ? (
          <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border p-10 text-sm text-muted-foreground hover:bg-muted/30">
            <input type="file" accept=".csv,.json" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
            Choose an Asana .csv or .json export
          </label>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} className="h-7" onClick={() => setFilter("all")}>All {results.length}</Button>
              {(Object.keys(KIND_META) as MatchKind[]).map((k) => (
                <Button key={k} size="sm" variant={filter === k ? "secondary" : "ghost"} className="h-7 gap-1.5" onClick={() => setFilter(k)}>
                  <span className={cn("rounded px-1.5 text-[11px] font-semibold", KIND_META[k].cls)}>{counts[k]}</span>{KIND_META[k].label}
                </Button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/70">
              {shown.map((r) => (
                <div key={r.row.ref} className="space-y-1.5 border-b border-border/50 p-3 text-sm last:border-0">
                  <div className="flex items-start gap-2">
                    {(r.kind === "new" || r.kind === "updated" || (r.kind === "unchanged" && r.needsLink)) && <Checkbox checked={r.accept} onCheckedChange={() => toggle(r)} className="mt-0.5" />}
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", KIND_META[r.kind].cls)}>{KIND_META[r.kind].label}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.row.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.row.path.join(" › ") || "Section"}{r.row.asana_gid ? ` · Asana ${r.row.asana_gid}` : ""}</div>
                      {r.reason && <div className="text-xs text-ops-blocked">{r.reason}</div>}
                      {r.kind === "unchanged" && r.needsLink && <div className="text-xs text-muted-foreground">Will remember the Asana ID for future imports</div>}
                    </div>
                  </div>
                  {r.kind === "updated" && (
                    <div className="grid gap-2 pl-6 sm:grid-cols-2">
                      <div className="rounded-md bg-muted/50 p-2 text-xs"><div className="mb-1 font-semibold text-muted-foreground">Current</div><pre className="max-h-32 overflow-y-auto whitespace-pre-wrap font-sans">{r.node?.body_md || "— empty —"}</pre></div>
                      <div className="rounded-md bg-ops-access/5 p-2 text-xs"><div className="mb-1 font-semibold text-muted-foreground">From Asana</div><pre className="max-h-32 overflow-y-auto whitespace-pre-wrap font-sans">{r.row.body}</pre></div>
                      {r.overwrites && <p className="text-xs text-ops-blocked sm:col-span-2">Replaces existing text — left unchecked unless you tick it.</p>}
                    </div>
                  )}
                  {r.kind === "ambiguous" && (
                    <div className="pl-6">
                      <Select value={res[r.row.ref] ? (res[r.row.ref].mode === "match" ? `m:${res[r.row.ref].nodeId}` : res[r.row.ref].mode) : ""} onValueChange={(v) => setRes((s) => ({ ...s, [r.row.ref]: v === "skip" ? { mode: "skip" } : v === "new" ? { mode: "new", parentId: parentFor(r, nodes, byId) } : { mode: "match", nodeId: v.slice(2) } }))}>
                        <SelectTrigger className="h-8 w-full sm:w-[360px]"><SelectValue placeholder="Choose what to do…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">Skip this row</SelectItem>
                          {(r.candidates ?? []).map((c) => <SelectItem key={c.id} value={`m:${c.id}`}>Update “{pathOf(c, byId).join(" › ")}”</SelectItem>)}
                          {parentFor(r, nodes, byId) !== undefined && <SelectItem value="new">Create as a new task</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">{results ? `${actions.length} changes will be written to the draft${unresolved ? ` · ${unresolved} rows skipped until you choose` : ""}` : ""}</span>
          <div className="flex gap-2">
            {results && <Button variant="ghost" onClick={() => setResults(null)}>Choose another file</Button>}
            <Button disabled={!results || !actions.length || busy} onClick={commit}>{busy ? "Importing…" : "Import into draft"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Parent for creating an ambiguous row as new: the existing node at its parent path (or top level). undefined = cannot place safely. */
function parentFor(r: MatchResult, nodes: SopNode[], byId: Map<string, SopNode>): string | null | undefined {
  if (!r.row.path.length) return null;
  const key = r.row.path.map((s) => s.toLowerCase().trim()).join("›");
  const hits = nodes.filter((n) => pathOf(n, byId).map((s) => s.toLowerCase().trim()).join("›") === key);
  return hits.length === 1 ? hits[0].id : undefined;
}
