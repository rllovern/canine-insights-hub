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

type MccCustomer = {
  customer_id: string;
  name: string;
  currency: string;
  status: string;
};

type RowState = {
  selected: boolean;
  // "new" => create a fresh property, otherwise an existing property id to attach to
  target: string;
  slug: string;
  name: string;
};

export function MCCImportDialog({
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
  const [customers, setCustomers] = useState<MccCustomer[]>([]);
  const [linkedMap, setLinkedMap] = useState<Map<string, string[]>>(new Map());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [filter, setFilter] = useState("");
  const [mccId, setMccId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data, error }, srcs] = await Promise.all([
        supabase.functions.invoke("list-mcc-customers", { body: {} }),
        supabase
          .from("property_data_sources")
          .select("property_id, source, external_account_id, is_connected, properties(name)"),
      ]);
      if (error) throw error;
      const list: MccCustomer[] = (data as any)?.customers ?? [];
      setMccId((data as any)?.mcc_id ?? null);
      const linked = new Map<string, string[]>();
      (srcs.data ?? []).forEach((s: any) => {
        if (s.source !== "google_ads" || !s.external_account_id) return;
        const key = String(s.external_account_id);
        const name = s.properties?.name ?? "(unknown)";
        const arr = linked.get(key) ?? [];
        arr.push(name);
        linked.set(key, arr);
      });
      setLinkedMap(linked);
      setCustomers(list);
      const init: Record<string, RowState> = {};
      list.forEach((c) => {
        const existing = properties.find(
          (p) => slugify(p.name) === slugify(c.name) || p.slug === slugify(c.name),
        );
        init[c.customer_id] = {
          selected: !linked.has(c.customer_id),
          target: existing ? existing.id : "new",
          slug: slugify(c.name).slice(0, 60) || `mcc-${c.customer_id}`,
          name: c.name,
        };
      });
      setRows(init);
    } catch (e: any) {
      toast.error(`Failed to load MCC customers: ${e?.message ?? "unknown"}`);
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

  const visible = customers.filter((c) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.customer_id.includes(q);
  });

  const selectedCount = Object.values(rows).filter((r) => r.selected).length;

  const runImport = async () => {
    setImporting(true);
    let created = 0;
    let attached = 0;
    let failed = 0;
    for (const c of customers) {
      const r = rows[c.customer_id];
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
              source: "google_ads",
              is_connected: true,
              external_account_id: c.customer_id,
              login_customer_id: mccId,
              status: "connected",
            },
            { onConflict: "property_id,source" } as any,
          );
        if (srcErr) throw srcErr;
      } catch (e: any) {
        console.error("MCC import row failed", c, e);
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
          <DialogTitle>Import from MCC</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Input
            placeholder="Filter by name or customer ID…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
          <div className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${customers.length} customers · ${selectedCount} selected`}
          </div>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Customer ID</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Slug</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c) => {
                const r = rows[c.customer_id];
                if (!r) return null;
                const linkedTo = linkedMap.get(c.customer_id) ?? [];
                return (
                  <TableRow key={c.customer_id}>
                    <TableCell>
                      <Checkbox
                        checked={r.selected}
                        onCheckedChange={(v) => updateRow(c.customer_id, { selected: !!v })}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.currency} · {c.status}
                        {linkedTo.length > 0 && (
                          <span className="ml-1 text-warning">
                            · linked to: {linkedTo.join(", ")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.customer_id}</TableCell>
                    <TableCell>
                      <Select
                        value={r.target}
                        onValueChange={(v) => updateRow(c.customer_id, { target: v })}
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
                          onChange={(e) => updateRow(c.customer_id, { slug: slugify(e.target.value) })}
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
                Import {selectedCount} customer{selectedCount === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}