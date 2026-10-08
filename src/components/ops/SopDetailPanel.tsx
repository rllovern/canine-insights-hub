// Full task detail: instructions, attachments, and (client mode) status, notes, evidence and history.
import { useEffect, useRef, useState } from "react";
import { FileWarning, Flag, Paperclip, Download, Trash2, Sparkles, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SopArea, SopNode, ApplicabilityRule } from "@/lib/mops/sopTree";
import type { Effective, SopStatus } from "@/lib/mops/readiness";
import { SopMarkdown } from "./SopMarkdown";
import { StatusSelect, StatusPill } from "./OpsPrimitives";
import { AREA_META, STATUS_META } from "./statusMeta";

export interface Attachment { id: string; stable_key: string; file_name: string; size_bytes?: number; client?: boolean }
export interface HistoryItem { status: SopStatus; note: string | null; evidence: string | null; at: string; version_no: number | null; by_you: boolean }

interface Props {
  node: SopNode | null;
  path?: string[];
  onClose: () => void;
  attachments: Attachment[];
  onOpenAttachment: (id: string) => void;
  onUpload?: (file: File, forClient: boolean) => Promise<void>;
  onDeleteAttachment?: (id: string) => void;
  // client mode
  effective?: Effective;
  clientNote?: { note: string | null; evidence: string | null };
  onStatus?: (s: SopStatus) => void;
  onSaveNote?: (note: string, evidence: string) => Promise<void>;
  loadHistory?: () => Promise<HistoryItem[]>;
  // template mode
  editable?: boolean;
  onSaveNode?: (patch: Partial<SopNode>) => Promise<void>;
}

const fmt = (d: string) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function SopDetailPanel(p: Props) {
  const n = p.node;
  const [note, setNote] = useState(""); const [evidence, setEvidence] = useState("");
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNote(p.clientNote?.note ?? ""); setEvidence(p.clientNote?.evidence ?? "");
    setTitle(n?.title ?? ""); setBody(n?.body_md ?? ""); setHistory(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n?.id, n?.stable_key]);

  if (!n) return null;
  const missing = !(n.body_md ?? "").trim();
  const isSection = n.kind === "section";
  const mine = p.attachments.filter((a) => a.stable_key === n.stable_key);
  const rule = n.applicability_rule;

  const save = async (fn: () => Promise<void>) => { setSaving(true); try { await fn(); } finally { setSaving(false); } };
  const upload = async (forClient: boolean) => {
    const f = fileRef.current?.files?.[0];
    if (!f || !p.onUpload) return;
    await save(() => p.onUpload!(f, forClient));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Sheet open={!!n} onOpenChange={(o) => !o && p.onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="space-y-2 border-b border-border/70 bg-muted/20 px-6 py-5 text-left">
          {p.path && p.path.length > 1 && <SheetDescription className="truncate text-xs">{p.path.slice(0, -1).join(" › ")}</SheetDescription>}
          {p.editable ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== n.title && p.onSaveNode?.({ title })} className="h-auto border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0" />
          ) : <SheetTitle className="text-lg leading-snug">{n.title}</SheetTitle>}
          <div className="flex flex-wrap items-center gap-2">
            {p.effective && !isSection && (p.onStatus ? <StatusSelect value={p.effective.status} onChange={p.onStatus} /> : <StatusPill status={p.effective.status} />)}
            {n.is_critical && <span className="inline-flex items-center gap-1 rounded-full bg-ops-blocked/10 px-2 py-0.5 text-xs font-medium text-ops-blocked"><Flag className="h-3 w-3" />Critical for launch</span>}
            {n.area && <span className="text-xs text-muted-foreground">{AREA_META[n.area].label}</span>}
            {p.effective?.source === "auto" && <span className="text-xs text-muted-foreground">Set automatically from connected data</span>}
            {p.effective?.source === "rule" && <span className="text-xs text-muted-foreground">Not applicable based on questionnaire answers</span>}
          </div>
          {p.effective?.suggestion && <p className="flex items-center gap-1.5 text-xs text-ops-progress"><Sparkles className="h-3.5 w-3.5" />Connected data suggests: {STATUS_META[p.effective.suggestion].label}. Your status is kept until you change it.</p>}
        </SheetHeader>

        <div className="flex-1 space-y-6 px-6 py-5">
          {p.editable ? (
            <section className="space-y-4">
              <Tabs defaultValue="write">
                <TabsList className="h-8"><TabsTrigger value="write" className="text-xs">Write</TabsTrigger><TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger></TabsList>
                <TabsContent value="write">
                  <Textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Full procedure in Markdown:\n1. First step\n2. Second step\n\n[Link](https://…)\n\n```\ncode snippet\n```"} className="font-mono text-[13px]" />
                </TabsContent>
                <TabsContent value="preview">{body.trim() ? <SopMarkdown source={body} /> : <p className="text-sm text-muted-foreground">Nothing written yet.</p>}</TabsContent>
              </Tabs>
              <Button size="sm" disabled={saving || body === (n.body_md ?? "")} onClick={() => save(() => p.onSaveNode!({ body_md: body }))}>Save description</Button>
              <div className="grid gap-3 rounded-lg border border-border/70 p-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-2 text-sm sm:col-span-2"><span>Critical for launch</span><Switch checked={n.is_critical} onCheckedChange={(v) => p.onSaveNode?.({ is_critical: v })} /></label>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Area</Label>
                  <Select value={n.area ?? "inherit"} onValueChange={(v) => p.onSaveNode?.({ area: v === "inherit" ? null : (v as SopArea) })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="inherit">Same as parent</SelectItem>{(Object.keys(AREA_META) as SopArea[]).map((a) => <SelectItem key={a} value={a}>{AREA_META[a].label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {!isSection && <RuleEditor rule={rule ?? null} onSave={(r) => p.onSaveNode?.({ applicability_rule: r })} />}
              </div>
            </section>
          ) : (
            <section>
              {missing ? (
                <div className="flex gap-3 rounded-lg border border-dashed border-ops-access/50 bg-ops-access/5 p-4 text-sm">
                  <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-ops-access" />
                  <div><div className="font-medium">Description missing — needs import</div><p className="text-muted-foreground">The original procedure hasn't been added yet. Import it from Asana or write it under Templates.</p></div>
                </div>
              ) : <SopMarkdown source={n.body_md!} />}
              {rule && <p className="mt-3 text-xs text-muted-foreground">Applies when questionnaire “{rule.key.replace(/_/g, " ")}” {rule.op.replace("_", " ")} “{rule.value}”.</p>}
            </section>
          )}

          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Paperclip className="h-3.5 w-3.5" />Attachments</h4>
            {mine.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            {mine.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
                <span className="flex-1 truncate">{a.file_name}{a.client && <span className="ml-2 text-xs text-muted-foreground">this client only</span>}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => p.onOpenAttachment(a.id)} aria-label="Download"><Download className="h-3.5 w-3.5" /></Button>
                {p.onDeleteAttachment && <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" onClick={() => p.onDeleteAttachment!(a.id)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            ))}
            {p.onUpload && (
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" className="max-w-[220px] text-xs" />
                <Button size="sm" variant="outline" disabled={saving} onClick={() => upload(!p.editable)} className="gap-1"><Upload className="h-3.5 w-3.5" />{p.editable ? "Attach to procedure" : "Attach evidence"}</Button>
              </div>
            )}
          </section>

          {p.onSaveNote && !isSection && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This client</h4>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes for this client (optional)" />
              <Textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Verification evidence — link, screenshot reference, test result (optional)" />
              <Button size="sm" disabled={saving || (note === (p.clientNote?.note ?? "") && evidence === (p.clientNote?.evidence ?? ""))} onClick={() => save(() => p.onSaveNote!(note, evidence))}>Save</Button>
              <p className="text-xs text-muted-foreground">Saved only for this client. The master procedure is never changed from here.</p>
            </section>
          )}

          {p.loadHistory && !isSection && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h4>
              {history == null ? <Button size="sm" variant="ghost" className="px-0" onClick={async () => setHistory(await p.loadHistory!())}>Show history</Button> : history.length === 0 ? <p className="text-sm text-muted-foreground">No changes yet.</p> : (
                <ol className="space-y-2 border-l border-border pl-4">
                  {history.map((h, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-2"><StatusPill status={h.status} /><span className="text-xs text-muted-foreground">{fmt(h.at)}{h.version_no ? ` · v${h.version_no}` : ""}{h.by_you ? "" : " · automatic"}</span></div>
                      {h.note && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{h.note}</p>}
                      {h.evidence && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">Evidence: {h.evidence}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RuleEditor({ rule, onSave }: { rule: ApplicabilityRule | null; onSave: (r: ApplicabilityRule | null) => void }) {
  const [k, setK] = useState(rule?.key ?? ""); const [op, setOp] = useState<ApplicabilityRule["op"]>(rule?.op ?? "equals"); const [v, setV] = useState(rule?.value ?? "");
  return (
    <div className="space-y-1 sm:col-span-2">
      <Label className="text-xs text-muted-foreground">Only applies when a questionnaire answer… (optional)</Label>
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-36" placeholder="answer key" value={k} onChange={(e) => setK(e.target.value)} />
        <Select value={op} onValueChange={(x) => setOp(x as ApplicabilityRule["op"])}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{(["equals", "not_equals", "includes", "not_includes"] as const).map((o) => <SelectItem key={o} value={o}>{o.replace("_", " ")}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="h-8 w-36" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => onSave(k.trim() && v.trim() ? { key: k.trim(), op, value: v.trim() } : null)}>Save rule</Button>
      </div>
    </div>
  );
}
