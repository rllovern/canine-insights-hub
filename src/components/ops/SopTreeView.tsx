// Asana-style list view of a nested SOP. Presentational: callers pass data and handlers.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, Indent, Outdent, Plus, Trash2, FileWarning, Paperclip, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { areaOf, buildTree, type SopArea, type SopNode, type TreeNode } from "@/lib/mops/sopTree";
import type { Effective, SopStatus } from "@/lib/mops/readiness";
import { StatusSelect, StatusPill } from "./OpsPrimitives";

export interface TreeEditHandlers {
  addChild: (parent: SopNode | null) => void;
  move: (node: SopNode, dir: "up" | "down" | "indent" | "outdent") => void;
  remove: (node: SopNode) => void;
}

interface Props {
  nodes: SopNode[];
  area?: SopArea | null;
  selectedKey?: string | null;
  onSelect: (n: SopNode) => void;
  effective?: Map<string, Effective>;
  onStatus?: (n: SopNode, s: SopStatus) => void;
  edit?: TreeEditHandlers;
  attachmentKeys?: Set<string>;
}

export function SopTreeView({ nodes, area, selectedKey, onSelect, effective, onStatus, edit, attachmentKeys }: Props) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const tree = useMemo(() => {
    const t = buildTree(nodes);
    if (!area) return t;
    const keep = (x: TreeNode): TreeNode | null => {
      const kids = x.children.map(keep).filter(Boolean) as TreeNode[];
      const mine = x.node.kind !== "section" && areaOf(x.node, byId) === area;
      return mine || kids.length ? { ...x, children: kids } : null;
    };
    return t.map(keep).filter(Boolean) as TreeNode[];
  }, [nodes, area, byId]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const leafStats = (t: TreeNode) => {
    let a = 0, v = 0;
    const rec = (x: TreeNode) => { if (x.node.kind !== "section") { const e = effective?.get(x.node.stable_key)?.status; if (e !== "not_applicable") { a++; if (e === "verified") v++; } } x.children.forEach(rec); };
    t.children.forEach(rec);
    return { a, v };
  };

  const Row = ({ t }: { t: TreeNode }) => {
    const n = t.node;
    const isSection = n.kind === "section";
    const open = !collapsed.has(n.id);
    const e = effective?.get(n.stable_key);
    const missing = !isSection && !(n.body_md ?? "").trim();
    const sel = selectedKey === n.stable_key;
    if (isSection) {
      const st = effective ? leafStats(t) : null;
      return (
        <div>
          <div className={cn("group flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2", sel && "bg-primary/5")}>
            <button onClick={() => toggle(n.id)} className="text-muted-foreground hover:text-foreground" aria-label={open ? "Collapse" : "Expand"}>
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <button onClick={() => onSelect(n)} className="flex-1 truncate text-left text-sm font-semibold tracking-tight">{n.title}</button>
            {st && <span className="text-xs tabular-nums text-muted-foreground">{st.v}/{st.a}</span>}
            {edit && <EditControls n={n} edit={edit} />}
          </div>
          {open && t.children.map((c) => <Row key={c.node.id} t={c} />)}
          {open && edit && <AddRow depth={1} onAdd={() => edit.addChild(n)} />}
        </div>
      );
    }
    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(n)}
          onKeyDown={(ev) => ev.key === "Enter" && onSelect(n)}
          className={cn("group flex min-h-[40px] cursor-pointer items-center gap-2 border-b border-border/40 py-1.5 pr-3 transition-colors hover:bg-muted/40", sel && "bg-primary/5 hover:bg-primary/5", e?.status === "blocked" && "bg-ops-blocked/[0.04]")}
          style={{ paddingLeft: 12 + t.depth * 20 }}
        >
          {t.children.length ? (
            <button onClick={(ev) => { ev.stopPropagation(); toggle(n.id); }} className="text-muted-foreground hover:text-foreground" aria-label={open ? "Collapse" : "Expand"}>
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-3.5" />}
          <span className={cn("flex-1 truncate text-sm", e?.status === "not_applicable" && "text-muted-foreground line-through decoration-border")}>{n.title}</span>
          {n.is_critical && <Flag className="h-3.5 w-3.5 shrink-0 text-ops-blocked/80" aria-label="Critical for launch" />}
          {attachmentKeys?.has(n.stable_key) && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Has attachments" />}
          {missing && <FileWarning className="h-3.5 w-3.5 shrink-0 text-ops-access" aria-label="Description missing" />}
          {e && e.source === "auto" && <span className="hidden text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">auto</span>}
          {e && (onStatus ? <StatusSelect value={e.status} onChange={(s) => onStatus(n, s)} /> : <StatusPill status={e.status} />)}
          {edit && <EditControls n={n} edit={edit} />}
        </div>
        {open && t.children.map((c) => <Row key={c.node.id} t={c} />)}
      </div>
    );
  };

  if (!tree.length) return <p className="p-6 text-sm text-muted-foreground">No tasks here.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      {tree.map((t) => <Row key={t.node.id} t={t} />)}
      {edit && <AddRow depth={0} label="Add section" onAdd={() => edit.addChild(null)} />}
    </div>
  );
}

function EditControls({ n, edit }: { n: SopNode; edit: TreeEditHandlers }) {
  const b = "h-7 w-7 text-muted-foreground hover:text-foreground";
  return (
    <span className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
      <Button size="icon" variant="ghost" className={b} title="Move up" onClick={() => edit.move(n, "up")}><ArrowUp className="h-3.5 w-3.5" /></Button>
      <Button size="icon" variant="ghost" className={b} title="Move down" onClick={() => edit.move(n, "down")}><ArrowDown className="h-3.5 w-3.5" /></Button>
      {n.kind !== "section" && <Button size="icon" variant="ghost" className={b} title="Outdent" onClick={() => edit.move(n, "outdent")}><Outdent className="h-3.5 w-3.5" /></Button>}
      {n.kind !== "section" && <Button size="icon" variant="ghost" className={b} title="Indent under the task above" onClick={() => edit.move(n, "indent")}><Indent className="h-3.5 w-3.5" /></Button>}
      {n.kind !== "section" && <Button size="icon" variant="ghost" className={b} title="Add subtask" onClick={() => edit.addChild(n)}><Plus className="h-3.5 w-3.5" /></Button>}
      <Button size="icon" variant="ghost" className={cn(b, "hover:text-destructive")} title="Delete" onClick={() => edit.remove(n)}><Trash2 className="h-3.5 w-3.5" /></Button>
    </span>
  );
}

function AddRow({ depth, onAdd, label = "Add task" }: { depth: number; onAdd: () => void; label?: string }) {
  return (
    <button onClick={onAdd} className="flex w-full items-center gap-2 border-b border-border/40 py-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground" style={{ paddingLeft: 12 + depth * 20 + 22 }}>
      <Plus className="h-3.5 w-3.5" />{label}
    </button>
  );
}
