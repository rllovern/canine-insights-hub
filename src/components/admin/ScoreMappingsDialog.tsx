import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Info } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * CRUD UI for `client_call_score_mappings`.
 *
 * Each row maps a CTM "score label" (case-insensitive on the backend) to a
 * dashboard bucket. Bucket dropdown labels reflect this client's custom
 * metric labels — e.g. "Admission" → "Sales" for non-medical clients.
 *
 * Internal-only buckets (`no_entry`, `ignore`) are intentionally not offered
 * as choices — `no_entry` is the automatic fallback for unscored calls.
 *
 * Priority is hidden by default and only matters when two labels resolve to
 * the same bucket; lower number wins.
 *
 * On save, this dialog automatically re-runs `sync-ctm` for the last 30 days
 * so the dashboard reflects the new mappings immediately.
 */

interface Property {
  id: string;
  name: string;
  metric_labels: Record<string, string> | null;
  hidden_metrics: string[] | null;
}

interface MappingRow {
  id?: string;
  score_label: string;
  bucket: string;
  priority: number;
  _isNew?: boolean;
  _dirty?: boolean;
}

// User-selectable buckets only. `no_entry` and `ignore` are internal fallbacks
// applied automatically by sync-ctm and must not appear in the dropdown.
const BUCKETS: { value: string; defaultLabel: string; metricKey?: string }[] = [
  { value: "admission", defaultLabel: "Admission", metricKey: "admissions" },
  { value: "good", defaultLabel: "Good Lead", metricKey: "good_leads" },
  { value: "medicaid", defaultLabel: "Medicaid", metricKey: "medicaid" },
  { value: "bad", defaultLabel: "Bad Lead", metricKey: "bad_leads" },
  { value: "spam", defaultLabel: "Spam", metricKey: "spam" },
  { value: "repeat", defaultLabel: "Repeat (excluded)" },
];

export function ScoreMappingsDialog({
  client,
  onClose,
}: {
  client: Property | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPriority, setShowPriority] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  // Resolve bucket labels using the client's per-client overrides + hidden metrics
  const bucketOptions = useMemo(() => {
    const labels = (client?.metric_labels ?? {}) as Record<string, string>;
    const hidden = new Set((client?.hidden_metrics ?? []) as string[]);
    return BUCKETS.map((b) => {
      const customLabel = b.metricKey ? labels[b.metricKey] : undefined;
      const isHidden = b.metricKey ? hidden.has(b.metricKey) : false;
      const display = customLabel || b.defaultLabel;
      return { ...b, display: isHidden ? `${display} (hidden)` : display };
    });
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const load = async () => {
      setLoading(true);
      setDeletedIds([]);
      const { data, error } = await supabase
        .from("property_call_score_mappings")
        .select("id, score_label, bucket, priority")
        .eq("property_id", client.id)
        .order("priority", { ascending: true });
      setLoading(false);
      if (error) {
        toast({ title: "Failed to load mappings", description: error.message, variant: "destructive" });
        return;
      }
      const loaded = ((data ?? []) as MappingRow[]).map((r) => ({ ...r }));
      setRows(loaded);
      // Auto-reveal priority column if any non-default values exist (so they're not hidden silently)
      if (loaded.some((r) => r.priority !== 100)) setShowPriority(true);
    };
    load();
  }, [client]);

  if (!client) return null;

  const update = (idx: number, patch: Partial<MappingRow>) => {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)));
  };

  const addRow = () => {
    setRows((rs) => [...rs, { score_label: "", bucket: "good", priority: 100, _isNew: true, _dirty: true }]);
  };

  const removeRow = (idx: number) => {
    setRows((rs) => {
      const r = rs[idx];
      if (r.id && !r._isNew) setDeletedIds((d) => [...d, r.id!]);
      return rs.filter((_, i) => i !== idx);
    });
  };

  const save = async () => {
    // Validate: non-empty labels + valid buckets
    const cleaned = rows
      .map((r) => ({ ...r, score_label: r.score_label.trim() }))
      .filter((r) => r.score_label.length > 0);
    const labels = new Set<string>();
    for (const r of cleaned) {
      const k = r.score_label.toLowerCase();
      if (labels.has(k)) {
        toast({ title: "Duplicate score label", description: `"${r.score_label}" appears more than once.`, variant: "destructive" });
        return;
      }
      labels.add(k);
    }

    setSaving(true);
    try {
      // Deletes first
      if (deletedIds.length) {
        const { error } = await supabase
          .from("property_call_score_mappings")
          .delete()
          .in("id", deletedIds);
        if (error) throw error;
      }
      // Upserts: split into inserts + updates
      const inserts = cleaned.filter((r) => r._isNew).map((r) => ({
        property_id: client.id,
        score_label: r.score_label,
        bucket: r.bucket,
        priority: Number(r.priority) || 100,
      }));
      const updates = cleaned.filter((r) => !r._isNew && r._dirty);

      if (inserts.length) {
        const { error } = await supabase.from("property_call_score_mappings").insert(inserts);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("property_call_score_mappings")
          .update({ score_label: u.score_label, bucket: u.bucket, priority: Number(u.priority) || 100 })
          .eq("id", u.id!);
        if (error) throw error;
      }

      toast({
        title: "Mappings saved",
        description: `Re-syncing call data for ${client.name}…`,
      });

      // Auto-trigger CTM resync so dashboard reflects new mappings immediately.
      // Use a 90-day window — covers month-to-date + previous-month comparisons.
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 90);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const { data: syncData, error: syncError } = await supabase.functions.invoke("sync-ctm", {
        body: {
          property_id: client.id,
          start_date: fmt(from),
          end_date: fmt(to),
        },
      });

      if (syncError || (syncData as any)?.error) {
        const msg = syncError?.message ?? (syncData as any)?.error ?? "Unknown error";
        toast({
          title: "Mappings saved, but sync failed",
          description: msg,
          variant: "destructive",
        });
      } else {
        const count = (syncData as any)?.calls_processed ?? (syncData as any)?.processed ?? (syncData as any)?.total ?? null;
        toast({
          title: "Sync complete",
          description: count != null ? `Processed ${count} call${count === 1 ? "" : "s"} from CTM.` : "CTM data refreshed.",
        });
      }

      onClose();
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!client} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Call score mappings — {client.name}</DialogTitle>
          <DialogDescription>
            Map each CTM <em>Score</em> label to a dashboard bucket. Saving will automatically re-sync the last 30 days of call data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="size-3.5 mt-0.5 shrink-0" />
          <p>
            Calls with no score in CTM are automatically counted as <strong>unscored</strong> — you don't need to map them.
          </p>
        </div>

        {loading ? (
          <div className="py-12 grid place-items-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>CTM Score Label</TableHead>
                  <TableHead className="w-[220px]">Bucket</TableHead>
                  {showPriority && <TableHead className="w-[100px]">Priority</TableHead>}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={showPriority ? 4 : 3} className="text-center text-muted-foreground py-6 text-sm">
                      No mappings yet — add one below.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r, idx) => (
                  <TableRow key={r.id ?? `new-${idx}`}>
                    <TableCell>
                      <Input
                        value={r.score_label}
                        onChange={(e) => update(idx, { score_label: e.target.value })}
                        placeholder="e.g. Sale, Good Lead, Spam"
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={r.bucket} onValueChange={(v) => update(idx, { bucket: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {bucketOptions.map((b) => (
                            <SelectItem key={b.value} value={b.value}>{b.display}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {showPriority && (
                      <TableCell>
                        <Input
                          type="number"
                          value={r.priority}
                          onChange={(e) => update(idx, { priority: Number(e.target.value) })}
                          className="h-8"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeRow(idx)}>
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={addRow} disabled={loading}>
            <Plus className="size-4 mr-1.5" /> Add mapping
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] h-7 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPriority((s) => !s)}
          >
            {showPriority ? "Hide priority" : "Show priority (advanced)"}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Save & re-sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
