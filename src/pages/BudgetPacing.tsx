import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProperties } from "@/contexts/PropertyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type BudgetRow = {
  id: string;
  property_id: string;
  campaign_label: string | null;
  notes: string | null;
  monthly_budget: number;
  sort_order: number;
};

type MetricRow = { date: string; campaign: string; cost: number; property_id: string };
type BudgetSnap = { property_id: string; campaign: string; daily_budget: number; status: string };

const fmtUSD = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 });
const fmtPct = (n: number | null) => (n == null || !isFinite(n) ? "—" : `${Math.round(n * 100)}%`);

// Red (far from 100%) → yellow (near) → green (≈100%). Used for % Spend & Proj Run Rate.
function paceTone(pct: number | null): string {
  if (pct == null || !isFinite(pct)) return "bg-muted/30 text-muted-foreground";
  const dist = Math.abs(pct - 1); // 0 = perfect, 1 = 100% off
  if (dist <= 0.05) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (dist <= 0.15) return "bg-lime-500/15 text-lime-700 dark:text-lime-300";
  if (dist <= 0.3) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-red-500/15 text-red-700 dark:text-red-300";
}

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" }) + (i === 0 ? " (MTD)" : "");
    out.push({ value, label });
  }
  return out;
}

function monthRange(value: string): { from: Date; to: Date; totalDays: number; daysElapsed: number; daysRemaining: number; isCurrent: boolean } {
  const [y, m] = value.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const endOfMonth = new Date(y, m, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isCurrent = today.getFullYear() === y && today.getMonth() === m - 1;
  const to = isCurrent ? today : endOfMonth;
  const totalDays = endOfMonth.getDate();
  const daysElapsed = isCurrent ? today.getDate() : totalDays;
  const daysRemaining = Math.max(0, totalDays - daysElapsed);
  return { from, to, totalDays, daysElapsed, daysRemaining, isCurrent };
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function BudgetPacing() {
  const { properties } = useProperties();
  const propMap = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const [month, setMonth] = useState(monthOptions()[0].value);
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetSnap[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const range = useMemo(() => monthRange(month), [month]);

  const reloadRows = async () => {
    const { data } = await supabase.from("budget_accounts").select("*").order("sort_order").order("created_at");
    setRows((data ?? []) as BudgetRow[]);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reloadRows();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const last5From = new Date(range.to);
      last5From.setDate(last5From.getDate() - 4);
      const fromISO = toISO(range.from < last5From ? range.from : last5From);
      const toIso = toISO(range.to);
      const { data } = await supabase
        .from("daily_metrics")
        .select("property_id, date, campaign, cost")
        .gte("date", fromISO)
        .lte("date", toIso);
      setMetrics((data ?? []) as MetricRow[]);
    })();
  }, [month, range.from, range.to]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaign_budgets").select("property_id, campaign, daily_budget, status");
      setBudgets((data ?? []) as BudgetSnap[]);
    })();
  }, []);

  const matchesLabel = (campaign: string, label: string | null) => {
    if (!label || !label.trim()) return true;
    return campaign.toLowerCase().includes(label.toLowerCase());
  };

  const computed = useMemo(() => {
    const yesterdayDate = new Date(range.to);
    if (range.isCurrent) yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayISO = toISO(yesterdayDate);
    const last5Start = new Date(range.to);
    last5Start.setDate(last5Start.getDate() - 4);
    const last5StartISO = toISO(last5Start);
    const fromISO = toISO(range.from);
    const toIso = toISO(range.to);

    return rows.map((r) => {
      const inScope = metrics.filter(
        (m) => m.property_id === r.property_id && matchesLabel(m.campaign, r.campaign_label),
      );
      const inMonth = inScope.filter((m) => m.date >= fromISO && m.date <= toIso);
      const spends = inMonth.reduce((a, m) => a + Number(m.cost || 0), 0);
      const yesterday = inScope.filter((m) => m.date === yesterdayISO).reduce((a, m) => a + Number(m.cost || 0), 0);
      const last5 = inScope.filter((m) => m.date >= last5StartISO && m.date <= toIso);
      const last5Total = last5.reduce((a, m) => a + Number(m.cost || 0), 0);
      const avgLast5 = last5Total / 5;

      const activeBudgetRows = budgets.filter(
        (b) => b.property_id === r.property_id && b.status === "ENABLED" && matchesLabel(b.campaign, r.campaign_label),
      );
      const activeBudget = activeBudgetRows.length ? activeBudgetRows.reduce((a, b) => a + Number(b.daily_budget || 0), 0) : null;

      const pctSpend = r.monthly_budget > 0 ? spends / r.monthly_budget : null;
      const targetDaily = range.daysRemaining > 0 ? Math.max(0, r.monthly_budget - spends) / range.daysRemaining : null;
      const projection = range.isCurrent ? spends + avgLast5 * range.daysRemaining : spends;
      const projRunRate = r.monthly_budget > 0 ? projection / r.monthly_budget : null;

      return { row: r, spends, pctSpend, yesterday, activeBudget, targetDaily, projection, projRunRate };
    });
  }, [rows, metrics, budgets, range]);

  const updateRow = async (id: string, patch: Partial<BudgetRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } as BudgetRow : r)));
    const { error } = await supabase.from("budget_accounts").update(patch).eq("id", id);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };

  const deleteRow = async (id: string) => {
    if (!confirm("Delete this budget row?")) return;
    const { error } = await supabase.from("budget_accounts").delete().eq("id", id);
    if (error) return toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  const syncBudgets = async () => {
    setSyncing(true);
    const propsWithGoogle = Array.from(new Set(rows.map((r) => r.property_id)));
    let ok = 0;
    for (const pid of propsWithGoogle) {
      try {
        const { error } = await supabase.functions.invoke("sync-google-ads", { body: { property_id: pid } });
        if (!error) ok++;
      } catch {}
    }
    const { data } = await supabase.from("campaign_budgets").select("property_id, campaign, daily_budget, status");
    setBudgets((data ?? []) as BudgetSnap[]);
    setSyncing(false);
    toast({ title: "Synced", description: `Refreshed budgets for ${ok}/${propsWithGoogle.length} accounts.` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Budget Pacing</h1>
          <p className="text-sm text-muted-foreground">Monthly budget vs actual spend, projected run rate per account.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions().map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={syncBudgets} disabled={syncing || rows.length === 0}>
            <RefreshCw className={cn("size-4 mr-1.5", syncing && "animate-spin")} /> Sync budgets
          </Button>
          <AddRowDialog open={addOpen} onOpenChange={setAddOpen} properties={properties} onAdded={reloadRows} />
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Account Name</TableHead>
              <TableHead>Campaign Label</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Spends</TableHead>
              <TableHead className="text-right">% Spend</TableHead>
              <TableHead className="text-right">Yesterday Spend</TableHead>
              <TableHead className="text-right">Active Budget</TableHead>
              <TableHead className="text-right">Target Daily Spend</TableHead>
              <TableHead className="text-right">Projection</TableHead>
              <TableHead className="text-right">Proj Run Rate</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {!loading && computed.length === 0 && (
              <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-8">No budget rows yet. Click <span className="font-medium">Add Account</span> to create one.</TableCell></TableRow>
            )}
            {computed.map((c, i) => {
              const prop = propMap.get(c.row.property_id);
              return (
                <TableRow key={c.row.id} className="group">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{prop?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Input
                      defaultValue={c.row.campaign_label ?? ""}
                      placeholder="—"
                      className="h-8 border-transparent hover:border-input focus:border-input"
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== c.row.campaign_label) updateRow(c.row.id, { campaign_label: v });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={c.row.notes ?? ""}
                      placeholder="—"
                      className="h-8 border-transparent hover:border-input focus:border-input"
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== c.row.notes) updateRow(c.row.id, { notes: v });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      defaultValue={c.row.monthly_budget}
                      className="h-8 w-28 ml-auto text-right border-transparent hover:border-input focus:border-input"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== Number(c.row.monthly_budget)) updateRow(c.row.id, { monthly_budget: v });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUSD(c.spends)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={cn("inline-block min-w-[3.5rem] rounded px-2 py-0.5 text-xs font-medium", paceTone(c.pctSpend))}>
                      {fmtPct(c.pctSpend)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUSD(c.yesterday)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUSD(c.activeBudget)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUSD(c.targetDaily)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUSD(c.projection)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={cn("inline-block min-w-[3.5rem] rounded px-2 py-0.5 text-xs font-medium", paceTone(c.projRunRate))}>
                      {fmtPct(c.projRunRate)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => deleteRow(c.row.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                      title="Delete row"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Projection = month-to-date spend + average of last 5 days × days remaining in month. Active Budget reflects currently enabled Google Ads campaigns (last sync).
      </p>
    </div>
  );
}

function AddRowDialog({ open, onOpenChange, properties, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; properties: { id: string; name: string }[]; onAdded: () => void }) {
  const [propertyId, setPropertyId] = useState<string>("");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [budget, setBudget] = useState("");

  const submit = async () => {
    if (!propertyId) return;
    const { error } = await supabase.from("budget_accounts").insert({
      property_id: propertyId,
      campaign_label: campaignLabel.trim() || null,
      notes: notes.trim() || null,
      monthly_budget: Number(budget) || 0,
    });
    if (error) return toast({ title: "Add failed", description: error.message, variant: "destructive" });
    setPropertyId(""); setCampaignLabel(""); setNotes(""); setBudget("");
    onOpenChange(false);
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-4 mr-1.5" /> Add Account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add budget row</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Property</Label>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger><SelectValue placeholder="Choose property" /></SelectTrigger>
              <SelectContent>
                {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Campaign label (optional)</Label>
            <Input value={campaignLabel} onChange={(e) => setCampaignLabel(e.target.value)} placeholder="e.g. Winchester" />
            <p className="text-xs text-muted-foreground">Matches campaigns whose name contains this text. Leave blank to include all.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Monthly budget (USD)</Label>
            <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!propertyId}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}