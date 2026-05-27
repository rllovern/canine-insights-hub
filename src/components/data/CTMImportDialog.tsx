import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Property } from "@/lib/types";
import { generateReportToken, slugify } from "@/lib/tokens";
import { toast } from "sonner";

type CtmAccount = {
  account_id: string;
  name: string;
  status: string;
};

type RowState = {
  selected: boolean;
  target: string; // "new" or property id
  slug: string;
  name: string;
};

export function CTMImportDialog({
  properties,
  onImported,
  trigger,
}: {
  properties: Property[];
  onImported: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [accounts, setAccounts] = useState<CtmAccount[]>([]);
  const [linkedMap, setLinkedMap] = useState<Map<string, string[]>>(new Map());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [{ data, error }, srcs] = await Promise.all([
        supabase.functions.invoke("list-ctm-accounts", { body: {} }),
        supabase
          .from("property_data_sources")
          .select("property_id, source, external_account_id, is_connected, properties(name)"),
      ]);
      if (error) throw error;
      const list: CtmAccount[] = (data as any)?.accounts ?? [];
      const linked = new Map<string, string[]>();
      (srcs.data ?? []).forEach((s: any) => {
        if (s.source !== "ctm" || !s.external_account_id) return;
        const key = String(s.external_account_id);
        const name = s.properties?.name ?? "(unknown)";
        const arr = linked.get(key) ?? [];
        arr.push(name);
        linked.set(key, arr);
      });
      setLinkedMap(linked);
      setAccounts(list);
      const init: Record<string, RowState> = {};
      list.forEach((c) => {
        const existing = properties.find(
          (p) => slugify(p.name) === slugify(c.name) || p.slug === slugify(c.name),
        );
        init[c.account_id] = {
          selected: !linked.has(c.account_id),
          target: existing ? existing.id : "new",
          slug: slugify(c.name).slice(0, 60) || `ctm-${c.account_id}`,
          name: c.name,
        };
      });
      setRows(init);
    } catch (e: any) {
      toast.error(`Failed to load CTM accounts: ${e?.message ?? "unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const visible = accounts.filter((c) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.account_id.includes(q);
  });

  const selectedCount = Object.values(rows).filter((r) => r.selected).length;

  const runImport = async () => {
    setImporting(true);
    let created = 0;
    let attached = 0;
    let failed = 0;
    for (const c of accounts) {
      const r = rows[c.account_id];
      if (!r?.selected) continue;
      try {
        let propertyId: string;
        if (r.target === "new") {
          const { data, error } = await supabase
            .from("properties")
            .insert({
              name: r.name.trim() || c.name,
              slug: slugify(r.slug || c.name).slice(0, 60),
              timezone: "America/New_York",
              public_report_token: generateReportToken(),
            })
            .select("id")
            .single();
          if (error || !data) throw error ?? new Error("insert failed");
          propertyId = data.id;
          created++;
        } else {
          propertyId = r.target;
          attached++;
        }
        const { error: srcErr } = await supabase
          .from("property_data_sources")
          .upsert(
            {
              property_id: propertyId,
              source: "ctm",
              is_connected: true,
              external_account_id: c.account_id,
              status: "connected",
              config: {
                account_id: c.account_id,
                account_name: c.name,
                use_agency_credentials: true,
              } as never,
            },
            { onConflict: "property_id,source" } as any,
          );
        if (srcErr) throw srcErr;
      } catch (e: any) {
        console.error("CTM import row failed", c, e);
        failed++;
      }
    }
    setImporting(false);
    if (failed) toast.error(`Imported with ${failed} error(s). Created ${created}, attached ${attached}.`);
    else toast.success(`Imported — ${created} created, ${attached} attached.`);
    setOpen(false);
    onImported();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import from CTM</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Input
            placeholder="Filter by name or account ID…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
          <div className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${accounts.length} accounts · ${selectedCount} selected`}
          </div>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Account ID</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Slug</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c) => {
                const r = rows[c.account_id];
                if (!r) return null;
                const linkedTo = linkedMap.get(c.account_id) ?? [];
                return (
                  <TableRow key={c.account_id}>
                    <TableCell>
                      <Checkbox
                        checked={r.selected}
                        onCheckedChange={(v) => updateRow(c.account_id, { selected: !!v })}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.status}
                        {linkedTo.length > 0 && (
                          <span className="ml-1 text-warning">
                            · linked to: {linkedTo.join(", ")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.account_id}</TableCell>
                    <TableCell>
                      <Select
                        value={r.target}
                        onValueChange={(v) => updateRow(c.account_id, { target: v })}
                      >
                        <SelectTrigger className="h-8 w-[220px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">Create new property</SelectItem>
                          {properties.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              Attach to: {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {r.target === "new" ? (
                        <Input
                          value={r.slug}
                          onChange={(e) => updateRow(c.account_id, { slug: slugify(e.target.value) })}
                          className="h-8 w-[180px] text-xs"
                        />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={runImport} disabled={importing || selectedCount === 0}>
            {importing ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Download className="mr-1.5 h-4 w-4" />
                Import {selectedCount} account{selectedCount === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}