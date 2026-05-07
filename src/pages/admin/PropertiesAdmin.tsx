import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Download, Loader2, RefreshCw, Phone, Link2, Copy, Check, Upload, X, ImageIcon, Settings2, ListChecks, Stethoscope, CalendarRange, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { ScoreMappingsDialog } from "@/components/admin/ScoreMappingsDialog";
import { CtmDiagnosticDialog } from "@/components/admin/CtmDiagnosticDialog";

interface Property {
  id: string;
  name: string;
  slug: string;
  brand_color: string | null;
  public_report_token: string | null;
  logo_url: string | null;
  metric_labels: Record<string, string> | null;
  hidden_metrics: string[] | null;
}
interface MccCustomer { customer_id: string; name: string; currency: string; status: string; }
interface CtmAccount { account_id: string; name: string; status: string; }
interface DataSource {
  property_id: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  source: string;
}
type SourcesByClient = Record<string, { google_ads?: DataSource; ctm?: DataSource; ga4?: DataSource; keyword_com?: DataSource }>;

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `client-${Date.now()}`;
}

function generateReportToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // url-safe base64 (no padding)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const PUBLIC_REPORT_BASE = "https://ridgeside-canine.lovable.app";

function reportUrl(token: string): string {
  return `${PUBLIC_REPORT_BASE}/report/${token}`;
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoYesterday(): string {
  return isoDaysAgo(1);
}

const DEFAULT_BRAND = "#2563EB";

export default function ClientsAdmin() {
  const queryClient = useQueryClient();
  const [clients, setClients] = useState<Property[]>([]);
  const [sources, setSources] = useState<SourcesByClient>({});
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState(DEFAULT_BRAND);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingMcc, setLoadingMcc] = useState(false);
  const [mccId, setMccId] = useState<string>("");
  const [mccCustomers, setMccCustomers] = useState<MccCustomer[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // CTM import dialog
  const [ctmOpen, setCtmOpen] = useState(false);
  const [ctmLoading, setCtmLoading] = useState(false);
  const [ctmImporting, setCtmImporting] = useState(false);
  const [ctmAccounts, setCtmAccounts] = useState<CtmAccount[]>([]);
  // ctm sub-account ID -> client.id mapping
  const [ctmMap, setCtmMap] = useState<Record<string, string>>({});

  // Customize metrics dialog
  const [customizeClient, setCustomizeClient] = useState<Property | null>(null);
  // Score mappings dialog
  const [mappingsClient, setMappingsClient] = useState<Property | null>(null);
  // CTM diagnostic dialog
  const [diagnosticClient, setDiagnosticClient] = useState<Property | null>(null);

  // Keyword.com connection dialog
  const [kwClient, setKwClient] = useState<Property | null>(null);
  const [kwToken, setKwToken] = useState("");
  const [kwProject, setKwProject] = useState("");
  const [kwSaving, setKwSaving] = useState(false);

  const openKwDialog = (c: Property) => {
    setKwClient(c);
    setKwToken("");
    setKwProject("");
  };

  const saveKwConnection = async () => {
    if (!kwClient || !kwToken.trim() || !kwProject.trim()) {
      toast({ title: "Missing fields", description: "Both API token and project name are required.", variant: "destructive" });
      return;
    }
    setKwSaving(true);
    const { data: existing } = await supabase
      .from("property_data_sources")
      .select("id")
      .eq("property_id", kwClient.id)
      .eq("source", "keyword_com")
      .maybeSingle();
    const payload = {
      property_id: kwClient.id,
      source: "keyword_com" as const,
      external_account_id: kwProject.trim(),
      refresh_token: kwToken.trim(),
      status: "connected" as const,
    };
    const { error } = existing
      ? await supabase.from("property_data_sources").update(payload).eq("id", existing.id)
      : await supabase.from("property_data_sources").insert(payload);
    setKwSaving(false);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Keyword.com connected", description: "Syncing now…" });
    setKwClient(null);
    await load();
    syncOne(kwClient.id, { silent: true }).then(() => load());
  };

  const load = async () => {
    const [{ data: clientData }, { data: sourceData }] = await Promise.all([
      supabase.from("properties").select("*").order("name"),
      supabase.from("property_data_sources").select("property_id,status,last_synced_at,last_error,source").in("source", ["google_ads", "ctm", "ga4", "keyword_com"]),
    ]);
    setClients((clientData ?? []) as Property[]);
    const map: SourcesByClient = {};
    for (const s of (sourceData ?? []) as DataSource[]) {
      if (!map[s.property_id]) map[s.property_id] = {};
      (map[s.property_id] as any)[s.source] = s;
    }
    setSources(map);
  };
  useEffect(() => { load(); }, []);

  const syncOne = async (clientId: string, opts?: { silent?: boolean }): Promise<{ ok: boolean; written?: number; error?: string }> => {
    setSyncingIds((s) => new Set(s).add(clientId));
    try {
      const srcs = sources[clientId] ?? {};
      const fns: Array<{ key: string; name: string }> = [];
      if (srcs.google_ads) fns.push({ key: "google_ads", name: "sync-google-ads" });
      if (srcs.ctm) fns.push({ key: "ctm", name: "sync-ctm" });
      if (srcs.ga4) fns.push({ key: "ga4", name: "sync-ga4" });
      if (srcs.keyword_com) fns.push({ key: "keyword_com", name: "sync-keyword-com" });

      if (fns.length === 0) {
        if (!opts?.silent) toast({ title: "Nothing to sync", description: "This client has no connected sources." });
        return { ok: false, error: "no sources" };
      }

      const results = await Promise.all(
        fns.map(async ({ key, name }) => {
          const { data, error } = await supabase.functions.invoke(name, {
            body: { property_id: clientId, date_from: isoDaysAgo(90), date_to: isoYesterday() },
          });
          if (error || (data as any)?.error) {
            return { key, ok: false, error: String(error?.message ?? (data as any)?.error ?? "Sync failed") };
          }
          return { key, ok: true, written: ((data as any)?.written ?? 0) as number };
        }),
      );

      let totalWritten = 0;
      const failed: string[] = [];
      for (const r of results) {
        if (r.ok) totalWritten += r.written ?? 0;
        else failed.push(`${r.key}: ${r.error}`);
      }

      if (!opts?.silent) {
        if (failed.length === 0) {
          toast({ title: "Sync complete", description: `${totalWritten} rows written across ${results.length} source${results.length === 1 ? "" : "s"}` });
        } else if (failed.length < results.length) {
          toast({ title: "Sync partially failed", description: failed.join(" · ").slice(0, 240), variant: "destructive" });
        } else {
          toast({ title: "Sync failed", description: failed.join(" · ").slice(0, 240), variant: "destructive" });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["metrics", clientId] });
      return { ok: failed.length === 0, written: totalWritten, error: failed.join(" · ") };
    } finally {
      setSyncingIds((s) => { const n = new Set(s); n.delete(clientId); return n; });
    }
  };

  const handleSyncOne = async (clientId: string) => {
    await syncOne(clientId);
    load();
  };

  const handleSyncAll = async () => {
    const targets = clients.filter((c) => sources[c.id] && Object.keys(sources[c.id]).length > 0);
    if (targets.length === 0) {
      toast({ title: "Nothing to sync", description: "No clients have a connected source." });
      return;
    }
    setSyncingAll(true);
    let ok = 0;
    let failed = 0;
    for (const c of targets) {
      const res = await syncOne(c.id, { silent: true });
      if (res.ok) ok++; else failed++;
    }
    setSyncingAll(false);
    toast({
      title: `Synced ${ok}/${targets.length} clients`,
      description: failed ? `${failed} failed — check status column` : "All clients refreshed",
      variant: failed ? "destructive" : undefined,
    });
    load();
  };

  // ===== Backfill =====
  const backfillOne = async (clientId: string, dateFrom: string, dateTo: string): Promise<{ ok: boolean; written: number; error?: string }> => {
    setSyncingIds((s) => new Set(s).add(clientId));
    try {
      const srcs = sources[clientId] ?? {};
      const fns: Array<{ key: string; name: string }> = [];
      if (srcs.google_ads) fns.push({ key: "google_ads", name: "sync-google-ads" });
      if (srcs.ctm) fns.push({ key: "ctm", name: "sync-ctm" });
      if (srcs.ga4) fns.push({ key: "ga4", name: "sync-ga4" });
      if (srcs.keyword_com) fns.push({ key: "keyword_com", name: "sync-keyword-com" });

      if (fns.length === 0) {
        toast({ title: "Nothing to backfill", description: "This client has no connected sources." });
        return { ok: false, written: 0, error: "no sources" };
      }

      const results = await Promise.all(
        fns.map(async ({ key, name }) => {
          const { data, error } = await supabase.functions.invoke(name, {
            body: { property_id: clientId, date_from: dateFrom, date_to: dateTo },
          });
          if (error || (data as any)?.error) {
            return { key, ok: false, written: 0, error: String(error?.message ?? (data as any)?.error ?? "Backfill failed") };
          }
          return { key, ok: true, written: ((data as any)?.written ?? 0) as number };
        }),
      );
      let totalWritten = 0;
      const failed: string[] = [];
      for (const r of results) {
        if (r.ok) totalWritten += r.written;
        else failed.push(`${r.key}: ${r.error}`);
      }
      if (failed.length === 0) {
        toast({ title: "Backfill complete", description: `${totalWritten} rows written for ${dateFrom} → ${dateTo}` });
      } else if (failed.length < results.length) {
        toast({ title: "Backfill partially failed", description: failed.join(" · ").slice(0, 240), variant: "destructive" });
      } else {
        toast({ title: "Backfill failed", description: failed.join(" · ").slice(0, 240), variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["metrics", clientId] });
      return { ok: failed.length === 0, written: totalWritten };
    } finally {
      setSyncingIds((s) => { const n = new Set(s); n.delete(clientId); return n; });
      load();
    }
  };


  const openCtmImport = async () => {
    setCtmOpen(true);
    setCtmLoading(true);
    setCtmAccounts([]);
    setCtmMap({});
    const { data, error } = await supabase.functions.invoke("list-ctm-accounts", { body: {} });
    setCtmLoading(false);
    if (error || !data?.accounts) {
      toast({ title: "Failed to fetch CTM accounts", description: error?.message ?? "Unknown error", variant: "destructive" });
      return;
    }
    setCtmAccounts(data.accounts as CtmAccount[]);
    // auto-suggest by exact (case-insensitive) name match
    const init: Record<string, string> = {};
    for (const a of data.accounts as CtmAccount[]) {
      const match = clients.find((c) => c.name.toLowerCase().trim() === a.name.toLowerCase().trim());
      if (match) init[a.account_id] = match.id;
    }
    setCtmMap(init);
  };

  const runCtmImport = async () => {
    const picks = Object.entries(ctmMap).filter(([, clientId]) => !!clientId);
    if (picks.length === 0) {
      toast({ title: "Pick at least one mapping" });
      return;
    }
    setCtmImporting(true);

    const { data: existing } = await supabase
      .from("property_data_sources")
      .select("property_id,external_account_id")
      .eq("source", "ctm");
    const existingByClient = new Set((existing ?? []).map((r: any) => r.property_id));

    let added = 0;
    let skipped = 0;
    const newClientIds: string[] = [];
    for (const [accountId, clientId] of picks) {
      if (existingByClient.has(clientId)) { skipped++; continue; }
      const { error } = await supabase.from("property_data_sources").insert({
        property_id: clientId,
        source: "ctm",
        external_account_id: accountId,
        status: "connected",
      });
      if (error) { skipped++; continue; }
      added++;
      newClientIds.push(clientId);
    }

    setCtmImporting(false);
    setCtmOpen(false);
    toast({
      title: `Linked ${added} CTM account${added === 1 ? "" : "s"}`,
      description: skipped ? `${skipped} skipped (already linked)` : "Auto-syncing now…",
    });
    await load();
    if (newClientIds.length) {
      (async () => {
        for (const id of newClientIds) await syncOne(id, { silent: true });
        toast({ title: "CTM auto-sync complete", description: `${newClientIds.length} client${newClientIds.length === 1 ? "" : "s"} refreshed` });
        load();
      })();
    }
  };

  const create = async () => {
    if (!name || !slug) return;
    const { error } = await supabase.from("properties").insert({ name, slug, brand_color: color });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    setName(""); setSlug("");
    toast({ title: "Property created" });
    load();
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Property removed" }); load();
  };

  const generateShareLink = async (clientId: string, isRegenerate: boolean) => {
    const token = generateReportToken();
    const { error } = await supabase.from("properties").update({ public_report_token: token }).eq("id", clientId);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    try { await navigator.clipboard.writeText(reportUrl(token)); } catch { /* ignore */ }
    toast({
      title: isRegenerate ? "Link regenerated & copied" : "Share link created & copied",
      description: "The previous link (if any) is now invalid.",
    });
    load();
  };

  const copyShareLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(reportUrl(token));
      toast({ title: "Link copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", description: "Select the link manually to copy.", variant: "destructive" });
    }
  };

  const uploadLogo = async (clientId: string, file: File) => {
    const MAX_BYTES = 2 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Logos must be under 2 MB.", variant: "destructive" });
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Unsupported file type", description: "Use PNG, JPG, SVG, or WebP.", variant: "destructive" });
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${clientId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("client-logos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      toast({ title: "Upload failed", description: upErr.message, variant: "destructive" });
      return;
    }
    const { data: pub } = supabase.storage.from("client-logos").getPublicUrl(path);
    const publicUrl = pub.publicUrl;
    const { error: updErr } = await supabase
      .from("properties")
      .update({ logo_url: publicUrl })
      .eq("id", clientId);
    if (updErr) {
      toast({ title: "Failed to save logo URL", description: updErr.message, variant: "destructive" });
      return;
    }
    toast({ title: "Logo uploaded" });
    load();
  };

  const removeLogo = async (clientId: string, currentUrl: string | null) => {
    const { error: updErr } = await supabase
      .from("properties")
      .update({ logo_url: null })
      .eq("id", clientId);
    if (updErr) {
      toast({ title: "Failed", description: updErr.message, variant: "destructive" });
      return;
    }
    // Best-effort delete of the storage object
    if (currentUrl) {
      const marker = "/client-logos/";
      const idx = currentUrl.indexOf(marker);
      if (idx !== -1) {
        const objectPath = currentUrl.slice(idx + marker.length);
        await supabase.storage.from("client-logos").remove([objectPath]);
      }
    }
    toast({ title: "Logo removed" });
    load();
  };


  const openImport = async () => {
    setImportOpen(true);
    setLoadingMcc(true);
    setMccCustomers([]);
    setSelected({});
    const { data, error } = await supabase.functions.invoke("list-mcc-customers", { body: {} });
    setLoadingMcc(false);
    if (error || !data?.customers) {
      toast({ title: "Failed to fetch MCC", description: error?.message ?? "Unknown error", variant: "destructive" });
      return;
    }
    setMccId(data.mcc_id ?? "");
    setMccCustomers(data.customers as MccCustomer[]);
    const init: Record<string, boolean> = {};
    for (const c of data.customers as MccCustomer[]) init[c.customer_id] = c.status === "ENABLED";
    setSelected(init);
  };

  const runImport = async () => {
    const picked = mccCustomers.filter((c) => selected[c.customer_id]);
    if (picked.length === 0) {
      toast({ title: "Pick at least one client" });
      return;
    }
    setImporting(true);

    const { data: existingConns } = await supabase
      .from("property_data_sources")
      .select("external_account_id")
      .eq("source", "google_ads");
    const existing = new Set((existingConns ?? []).map((r: any) => String(r.external_account_id ?? "").replace(/-/g, "")));

    let imported = 0;
    let skipped = 0;
    const newClientIds: string[] = [];
    const usedSlugs = new Set(clients.map((c) => c.slug));

    for (const cust of picked) {
      const cleanCustId = cust.customer_id.replace(/-/g, "");
      if (existing.has(cleanCustId)) { skipped++; continue; }

      let baseSlug = slugify(cust.name);
      let finalSlug = baseSlug;
      let i = 2;
      while (usedSlugs.has(finalSlug)) { finalSlug = `${baseSlug}-${i++}`; }
      usedSlugs.add(finalSlug);

      const { data: newClient, error: clientErr } = await supabase
        .from("properties")
        .insert({ name: cust.name, slug: finalSlug, brand_color: DEFAULT_BRAND })
        .select("id")
        .single();
      if (clientErr || !newClient) {
        skipped++;
        continue;
      }

      const { error: dsErr } = await supabase.from("property_data_sources").insert({
        property_id: newClient.id,
        source: "google_ads",
        external_account_id: cleanCustId,
        login_customer_id: mccId || null,
        refresh_token: null,
        status: "connected",
      });
      if (dsErr) {
        await supabase.from("properties").delete().eq("id", newClient.id);
        skipped++;
        continue;
      }
      imported++;
      newClientIds.push(newClient.id);
    }

    setImporting(false);
    setImportOpen(false);
    toast({
      title: `Imported ${imported} client${imported === 1 ? "" : "s"}`,
      description: skipped ? `${skipped} skipped (duplicate or error). Auto-syncing now…` : "Auto-syncing now…",
    });
    await load();

    // Fire-and-forget auto-sync of newly imported clients
    if (newClientIds.length) {
      (async () => {
        let ok = 0;
        let failed = 0;
        for (const id of newClientIds) {
          const res = await syncOne(id, { silent: true });
          if (res.ok) ok++; else failed++;
        }
        toast({
          title: `Auto-sync complete: ${ok}/${newClientIds.length}`,
          description: failed ? `${failed} failed — check status column` : "Dashboard data is ready",
          variant: failed ? "destructive" : undefined,
        });
        load();
      })();
    }
  };

  const allSelected = mccCustomers.length > 0 && mccCustomers.every((c) => selected[c.customer_id]);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    for (const c of mccCustomers) next[c.customer_id] = !allSelected;
    setSelected(next);
  };

  const connectedCount = clients.filter((c) => sources[c.id] && Object.keys(sources[c.id]).length > 0).length;

  return (
    <>
    <AppShell title="Property Management">
      <SectionDivider title="Add a client" subtitle="Internal users only" />
      <div className="bg-card border border-border rounded-xl p-5 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Academy" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Slug</Label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Brand color</Label>
          <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 p-1" />
        </div>
        <Button onClick={create}><Plus className="size-4 mr-1" /> Add client</Button>
        <Button variant="outline" onClick={openImport}><Download className="size-4 mr-1" /> Import from MCC</Button>
        <Button variant="outline" onClick={openCtmImport}><Phone className="size-4 mr-1" /> Import from CTM</Button>
      </div>

      <div className="flex items-center justify-between mt-6 mb-2">
        <SectionDivider title="All clients" />
        <Button variant="outline" size="sm" onClick={handleSyncAll} disabled={syncingAll || connectedCount === 0}>
          {syncingAll ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <RefreshCw className="size-4 mr-1.5" />}
          Sync all clients
        </Button>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Brand</TableHead>
              <TableHead>Logo</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Sources</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last synced</TableHead>
              <TableHead>Share link</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => {
              const srcs = sources[c.id] ?? {};
              const srcList = [srcs.google_ads, srcs.ctm, srcs.ga4, srcs.keyword_com].filter(Boolean) as DataSource[];
              const isSyncing = syncingIds.has(c.id);

              const hasError = srcList.some((s) => s.status === "error");
              const hasConn = srcList.some((s) => s.status === "connected");
              const rolledStatus = srcList.length === 0 ? "—" : hasError ? "error" : hasConn ? "connected" : "disconnected";
              const statusClass =
                rolledStatus === "connected" ? "bg-success/10 text-success" :
                rolledStatus === "error" ? "bg-destructive/10 text-destructive" :
                "bg-muted text-muted-foreground";
              const lastSyncedIso = srcList
                .map((s) => s.last_synced_at)
                .filter(Boolean)
                .sort()
                .pop() ?? null;
              const errors = srcList.filter((s) => s.status === "error" && s.last_error).map((s) => `${s.source}: ${s.last_error}`).join("\n");

              const statusBadge = (
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
                  {rolledStatus}
                </span>
              );

              return (
                <TableRow key={c.id}>
                  <TableCell><div className="size-6 rounded" style={{ background: c.brand_color || "#2563EB" }} /></TableCell>
                  <TableCell>
                    <LogoCell
                      client={c}
                      onUpload={(file) => uploadLogo(c.id, file)}
                      onRemove={() => removeLogo(c.id, c.logo_url)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {srcs.google_ads && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">ADS</span>}
                      {srcs.ctm && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">CTM</span>}
                      {srcs.ga4 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">GA4</span>}
                      {srcs.keyword_com && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">KW</span>}
                      {srcList.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {errors ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild><span className="cursor-help">{statusBadge}</span></TooltipTrigger>
                          <TooltipContent className="max-w-md break-words whitespace-pre-line">{errors}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : statusBadge}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatLastSynced(lastSyncedIso)}</TableCell>
                  <TableCell>
                    <ShareLinkCell
                      token={c.public_report_token}
                      onGenerate={() => generateShareLink(c.id, false)}
                      onRegenerate={() => generateShareLink(c.id, true)}
                      onCopy={(t) => copyShareLink(t)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setMappingsClient(c)}
                          >
                            <ListChecks className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Call score mappings</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => setDiagnosticClient(c)}
                              disabled={!srcs.ctm}
                            >
                              <Stethoscope className="size-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{srcs.ctm ? "Run CTM diagnostic" : "No CTM connection"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setCustomizeClient(c)}
                          >
                            <Settings2 className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Customize metric labels &amp; visibility</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => openKwDialog(c)}
                          >
                            <Search className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{srcs.keyword_com ? "Update Keyword.com connection" : "Connect Keyword.com"}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => handleSyncOne(c.id)}
                      disabled={isSyncing || srcList.length === 0}
                      title={srcList.length === 0 ? "No connected sources" : `Sync ${srcList.length} source${srcList.length === 1 ? "" : "s"} (last 90 days)`}
                    >
                      {isSyncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      <span className="ml-1.5">Sync</span>
                    </Button>
                    <BackfillPopover
                      disabled={isSyncing || srcList.length === 0}
                      onRun={(from, to) => backfillOne(c.id, from, to)}
                    />

                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(c.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import clients from MCC</DialogTitle>
            <DialogDescription>
              {mccId ? <>Pulling accounts under MCC <code className="font-mono">{mccId}</code>. Pick which to add.</> : "Loading accounts from your manager account..."}
            </DialogDescription>
          </DialogHeader>

          {loadingMcc ? (
            <div className="py-12 grid place-items-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto border border-border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Customer ID</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mccCustomers.length === 0 && !loadingMcc && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No customer accounts returned.</TableCell></TableRow>
                  )}
                  {mccCustomers.map((c) => (
                    <TableRow key={c.customer_id}>
                      <TableCell>
                        <Checkbox
                          checked={!!selected[c.customer_id]}
                          onCheckedChange={(v) => setSelected((s) => ({ ...s, [c.customer_id]: !!v }))}
                          aria-label={`Select ${c.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="font-mono text-xs">{c.customer_id}</TableCell>
                      <TableCell className="text-muted-foreground">{c.currency || "—"}</TableCell>
                      <TableCell>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${c.status === "ENABLED" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                          {c.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)} disabled={importing}>Cancel</Button>
            <Button onClick={runImport} disabled={importing || loadingMcc || mccCustomers.length === 0}>
              {importing && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              Import selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CTM import dialog */}
      <Dialog open={ctmOpen} onOpenChange={setCtmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import from CallTrackingMetrics</DialogTitle>
            <DialogDescription>
              Map each CTM sub-account to a Lovable client. Auto-suggested by exact name match.
            </DialogDescription>
          </DialogHeader>

          {ctmLoading ? (
            <div className="py-12 grid place-items-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto border border-border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>CTM Account</TableHead>
                    <TableHead>Account ID</TableHead>
                    <TableHead>Map to Lovable client</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ctmAccounts.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No CTM accounts returned.</TableCell></TableRow>
                  )}
                  {ctmAccounts.map((a) => (
                    <TableRow key={a.account_id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.account_id}</TableCell>
                      <TableCell>
                        <Select value={ctmMap[a.account_id] ?? "__none__"} onValueChange={(v) => setCtmMap((m) => ({ ...m, [a.account_id]: v === "__none__" ? "" : v }))}>
                          <SelectTrigger className="h-8 w-full"><SelectValue placeholder="— skip —" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— skip —</SelectItem>
                            {clients.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCtmOpen(false)} disabled={ctmImporting}>Cancel</Button>
            <Button onClick={runCtmImport} disabled={ctmImporting || ctmLoading || ctmAccounts.length === 0}>
              {ctmImporting && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              Link selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomizeMetricsDialog
        client={customizeClient}
        onClose={() => setCustomizeClient(null)}
        onSaved={() => { setCustomizeClient(null); load(); }}
      />

      <ScoreMappingsDialog
        client={mappingsClient}
        onClose={() => setMappingsClient(null)}
      />

      <CtmDiagnosticDialog
        client={diagnosticClient}
        onClose={() => setDiagnosticClient(null)}
      />
    </AppShell>
      <Dialog open={!!kwClient} onOpenChange={(o) => !o && setKwClient(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Keyword.com — {kwClient?.name}</DialogTitle>
            <DialogDescription>
              Paste an API token from Keyword.com (Settings → Account) and the project name as it appears in Keyword.com.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">API Token</Label>
              <Input type="password" value={kwToken} onChange={(e) => setKwToken(e.target.value)} placeholder="kw_..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Project name</Label>
              <Input value={kwProject} onChange={(e) => setKwProject(e.target.value)} placeholder="Acme Brand" />
              <p className="text-[11px] text-muted-foreground">Use the exact group/project name from your Keyword.com dashboard.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKwClient(null)} disabled={kwSaving}>Cancel</Button>
            <Button onClick={saveKwConnection} disabled={kwSaving}>
              {kwSaving && <Loader2 className="size-4 mr-1.5 animate-spin" />} Save & sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


function ShareLinkCell({
  token, onGenerate, onRegenerate, onCopy,
}: {
  token: string | null;
  onGenerate: () => void;
  onRegenerate: () => void;
  onCopy: (token: string) => void;
}) {
  const [justCopied, setJustCopied] = useState(false);
  const handleCopy = async () => {
    if (!token) return;
    onCopy(token);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 1500);
  };

  if (!token) {
    return (
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onGenerate}>
        <Link2 className="size-3.5" />
        Generate link
      </Button>
    );
  }

  const url = reportUrl(token);
  return (
    <div className="flex items-center gap-1.5 max-w-[280px]">
      <code className="text-[10px] font-mono px-2 py-1 rounded bg-muted text-muted-foreground truncate flex-1" title={url}>
        /report/{token.slice(0, 10)}…
      </code>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleCopy}>
              {justCopied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy share link</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onRegenerate}>
              <RefreshCw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Regenerate (invalidates current link)</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function LogoCell({
  client, onUpload, onRemove,
}: {
  client: { id: string; name: string; brand_color: string | null; logo_url: string | null };
  onUpload: (file: File) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const inputId = `logo-upload-${client.id}`;
  return (
    <div className="flex items-center gap-2">
      {client.logo_url ? (
        <img
          src={client.logo_url}
          alt={`${client.name} logo`}
          className="h-9 w-9 rounded object-contain bg-card border border-border"
        />
      ) : (
        <div
          className="h-9 w-9 rounded grid place-items-center text-xs font-semibold text-white"
          style={{ background: client.brand_color || "#2563EB" }}
          aria-label="No logo set"
        >
          {client.name.charAt(0)}
        </div>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => document.getElementById(inputId)?.click()}
            >
              <Upload className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{client.logo_url ? "Replace logo" : "Upload logo"}</TooltipContent>
        </Tooltip>
        {client.logo_url && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => onRemove()}
              >
                <X className="size-3.5 text-destructive" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove logo</TooltipContent>
          </Tooltip>
        )}
      </TooltipProvider>
    </div>
  );
}

const METRIC_KEYS: { key: string; defaultLabel: string; description: string }[] = [
  { key: "leads", defaultLabel: "Leads", description: "Total inbound leads" },
  { key: "good_leads", defaultLabel: "Good Leads", description: "Qualified leads" },
  { key: "bad_leads", defaultLabel: "Bad Leads", description: "Disqualified leads" },
  { key: "admissions", defaultLabel: "Admissions", description: "Final conversions (e.g. \"Sales\", \"Intakes\")" },
  { key: "medicaid", defaultLabel: "Medicaid", description: "Medicaid-tagged calls" },
  { key: "spam", defaultLabel: "Spam", description: "Spam calls (internal view only)" },
];

function CustomizeMetricsDialog({
  client, onClose, onSaved,
}: {
  client: Property | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setLabels({ ...(client.metric_labels ?? {}) });
      const h: Record<string, boolean> = {};
      for (const k of (client.hidden_metrics ?? [])) h[k] = true;
      setHidden(h);
    }
  }, [client]);

  if (!client) return null;

  const save = async () => {
    setSaving(true);
    // Strip empty label overrides so we fall back to defaults
    const cleanLabels: Record<string, string> = {};
    for (const [k, v] of Object.entries(labels)) {
      const trimmed = (v ?? "").trim();
      if (trimmed && trimmed !== METRIC_KEYS.find((m) => m.key === k)?.defaultLabel) {
        cleanLabels[k] = trimmed;
      }
    }
    const hiddenList = Object.entries(hidden).filter(([, v]) => v).map(([k]) => k);
    const { error } = await supabase
      .from("properties")
      .update({ metric_labels: cleanLabels, hidden_metrics: hiddenList })
      .eq("id", client.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Metric settings saved", description: `Updated for ${client.name}` });
    onSaved();
  };

  return (
    <Dialog open={!!client} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Customize metrics — {client.name}</DialogTitle>
          <DialogDescription>
            Rename metrics or hide ones that don't apply to this client. Underlying data is unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Metric</TableHead>
                <TableHead>Display label</TableHead>
                <TableHead className="w-20 text-center">Hide</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRIC_KEYS.map((m) => (
                <TableRow key={m.key}>
                  <TableCell>
                    <div className="font-medium text-sm">{m.defaultLabel}</div>
                    <div className="text-[11px] text-muted-foreground">{m.description}</div>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={labels[m.key] ?? ""}
                      placeholder={m.defaultLabel}
                      onChange={(e) => setLabels((s) => ({ ...s, [m.key]: e.target.value }))}
                      disabled={!!hidden[m.key]}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={!!hidden[m.key]}
                      onCheckedChange={(v) => setHidden((s) => ({ ...s, [m.key]: !!v }))}
                      aria-label={`Hide ${m.defaultLabel}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Backfill popover (per-row) =====
function isoNDaysAgoLocal(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoTodayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

function BackfillPopover({
  disabled,
  onRun,
}: {
  disabled?: boolean;
  onRun: (dateFrom: string, dateTo: string) => Promise<{ ok: boolean; written: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(isoNDaysAgoLocal(90));
  const [to, setTo] = useState(isoTodayLocal());
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!from || !to) {
      toast({ title: "Pick a date range", variant: "destructive" });
      return;
    }
    if (from > to) {
      toast({ title: "Invalid range", description: "Start must be on or before end.", variant: "destructive" });
      return;
    }
    setRunning(true);
    await onRun(from, to);
    setRunning(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8" disabled={disabled} title="Backfill historical data for a date range">
          <CalendarRange className="size-4" />
          <span className="ml-1.5">Backfill</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold">Backfill date range</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pulls all connected sources for this client over the chosen window. Existing rows are merged, not overwritten.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="bf-from" className="text-xs">From</Label>
              <Input id="bf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" />
            </div>
            <div>
              <Label htmlFor="bf-to" className="text-xs">To</Label>
              <Input id="bf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={running}>Cancel</Button>
            <Button size="sm" onClick={run} disabled={running}>
              {running && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Run backfill
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
