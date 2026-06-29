import { useEffect, useMemo, useState } from "react";
import {
  Link as LinkIcon,
  Copy,
  Download,
  ExternalLink,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCw,
  MoreHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Property, DataSource, PropertyDataSource } from "@/lib/types";
import { PageHeader } from "@/components/data/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SourceBadges } from "@/components/data/SourceBadges";
import { PropertyAvatar } from "@/components/brand/PropertyAvatar";
import { generateReportToken, slugify } from "@/lib/tokens";
import { useProperties } from "@/contexts/PropertyContext";
import { toast } from "sonner";
import { EmptyState } from "@/components/data/EmptyState";
import { CTMConnectionDialog } from "@/components/data/CTMConnectionDialog";
import { MCCImportDialog } from "@/components/data/MCCImportDialog";
import { CTMImportDialog } from "@/components/data/CTMImportDialog";
import { GHLConnectionDialog } from "@/components/data/GHLConnectionDialog";

function PropertyDialog({
  initial,
  onSaved,
  onDeleted,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: {
  initial?: Property | null;
  onSaved: () => void;
  onDeleted?: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = setControlledOpen ?? setUncontrolledOpen;

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "America/New_York");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setSlug(initial?.slug ?? "");
      setTimezone(initial?.timezone ?? "America/New_York");
      setLogoFile(null);
      setConfirmDelete(false);
      setDeleteConfirmText("");
    }
  }, [open, initial]);

  const onNameChange = (v: string) => {
    setName(v);
    if (!initial) setSlug(slugify(v.replace(/Ridgeside\s*Canine\s*[—-]?\s*/i, "")));
  };

  const handleSave = async () => {
    if (!name.trim() || !slug.trim()) {
      toast.error("Name and slug are required.");
      return;
    }
    setSaving(true);

    let logo_url: string | null | undefined = undefined;
    if (logoFile) {
      const path = `${slug}/${Date.now()}-${logoFile.name}`;
      const { error: upErr } = await supabase.storage
        .from("property-logos")
        .upload(path, logoFile, { upsert: true });
      if (upErr) {
        toast.error(`Logo upload failed: ${upErr.message}`);
        setSaving(false);
        return;
      }
      const { data: pub } = supabase.storage.from("property-logos").getPublicUrl(path);
      logo_url = pub.publicUrl;
    }

    if (initial) {
      const patch: Partial<Property> = { name, slug, timezone };
      if (logo_url !== undefined) patch.logo_url = logo_url;
      const { error } = await supabase.from("properties").update(patch).eq("id", initial.id);
      if (error) toast.error(error.message);
      else toast.success("Property updated.");
    } else {
      const { error } = await supabase.from("properties").insert({
        name,
        slug,
        timezone,
        logo_url: logo_url ?? null,
        public_report_token: generateReportToken(),
      });
      if (error) toast.error(error.message);
      else toast.success("Property created.");
    }
    setSaving(false);
    setOpen(false);
    onSaved();
  };

  const handleDelete = async () => {
    if (!initial) return;
    setDeleting(true);
    // Clean up related rows first to avoid FK issues.
    await supabase.from("property_data_sources").delete().eq("property_id", initial.id);
    await supabase.from("property_call_score_mappings").delete().eq("property_id", initial.id);
    await supabase.from("property_settings").delete().eq("property_id", initial.id);
    await supabase.from("viewer_property_access").delete().eq("property_id", initial.id);
    await supabase.from("daily_metrics").delete().eq("property_id", initial.id);
    await supabase.from("ctm_calls").delete().eq("property_id", initial.id);
    await supabase.from("keyword_rankings").delete().eq("property_id", initial.id);
    await supabase.from("keyword_share_of_voice").delete().eq("property_id", initial.id);
    const { error } = await supabase.from("properties").delete().eq("id", initial.id);
    setDeleting(false);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    toast.success("Property deleted.");
    setOpen(false);
    onDeleted?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{initial ? "Edit property" : "Add property"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Ridgeside K9 — Asheville" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-slug">Slug</Label>
              <Input id="p-slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="asheville" />
              <p className="text-[11px] text-muted-foreground">URL-safe identifier used in dashboard and share links.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-tz">Timezone</Label>
              <Input id="p-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-logo">Logo</Label>
              <Input id="p-logo" type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
              {initial?.logo_url && !logoFile && (
                <p className="text-[11px] text-muted-foreground">Current logo will be kept unless you upload a new one.</p>
              )}
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <div>
              {initial && (
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving || deleting}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this property?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-medium text-foreground">{initial?.name}</span> along with all of its synced metrics, calls, keyword rankings, and connections. This cannot be undone.
              <br /><br />
              Type <span className="font-mono font-semibold text-foreground">{initial?.slug}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={initial?.slug ?? ""}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || deleteConfirmText.trim() !== (initial?.slug ?? "")}
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete property"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AdminProperties() {
  const { reload } = useProperties();
  const [rows, setRows] = useState<Property[]>([]);
  const [sources, setSources] = useState<PropertyDataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [regenTarget, setRegenTarget] = useState<Property | null>(null);
  const [regenConfirm, setRegenConfirm] = useState("");
  const [ctmTarget, setCtmTarget] = useState<Property | null>(null);
  const [ghlTarget, setGhlTarget] = useState<Property | null>(null);
  const [editTarget, setEditTarget] = useState<Property | null>(null);

  const load = async () => {
    setLoading(true);
    const [props, srcs] = await Promise.all([
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      supabase.from("property_data_sources").select("*"),
    ]);
    setRows((props.data ?? []) as Property[]);
    setSources((srcs.data ?? []) as PropertyDataSource[]);
    setLoading(false);
    reload();
  };

  useEffect(() => {
    load();
  }, []);

  const sourcesByProp = useMemo(() => {
    const m = new Map<string, DataSource[]>();
    sources.filter((s) => s.is_connected).forEach((s) => {
      const arr = m.get(s.property_id) ?? [];
      arr.push(s.source as DataSource);
      m.set(s.property_id, arr);
    });
    return m;
  }, [sources]);

  const ctmByProp = useMemo(() => {
    const m = new Map<string, PropertyDataSource>();
    sources.filter((s) => s.source === "ctm").forEach((s) => m.set(s.property_id, s));
    return m;
  }, [sources]);

  const ghlByProp = useMemo(() => {
    const m = new Map<string, PropertyDataSource>();
    sources.filter((s) => s.source === "ghl").forEach((s) => m.set(s.property_id, s));
    return m;
  }, [sources]);

  const googleAdsByProp = useMemo(() => {
    const m = new Map<string, PropertyDataSource>();
    sources.filter((s) => s.source === "google_ads").forEach((s) => m.set(s.property_id, s));
    return m;
  }, [sources]);

  const lastSyncByProp = useMemo(() => {
    const m = new Map<string, string>();
    sources.forEach((s) => {
      if (!s.last_synced_at) return;
      const cur = m.get(s.property_id);
      if (!cur || new Date(s.last_synced_at) > new Date(cur)) m.set(s.property_id, s.last_synced_at);
    });
    return m;
  }, [sources]);

  const regenToken = async (p: Property) => {
    const token = generateReportToken();
    const { error } = await supabase.from("properties").update({ public_report_token: token }).eq("id", p.id);
    if (error) toast.error(error.message);
    else {
      toast.success("New share link generated.");
      load();
    }
  };

  const copyLink = async (p: Property) => {
    if (!p.public_report_token) {
      toast.error("No share token. Generate one first.");
      return;
    }
    const url = `${window.location.origin}/report/${p.public_report_token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard.");
  };

  const syncNow = async (p: Property) => {
    setSyncingId(p.id);
    const hasGoogle = !!googleAdsByProp.get(p.id)?.is_connected;
    const hasCtm = !!ctmByProp.get(p.id)?.is_connected;
    if (!hasGoogle && !hasCtm) {
      toast.error("No connected data sources to sync.");
      setSyncingId(null);
      return;
    }
    const results: string[] = [];
    let anyError = false;

    if (hasGoogle) {
      try {
        const { data, error } = await supabase.functions.invoke("sync-google-ads", {
          body: { property_id: p.id },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        results.push(`Google Ads: ${(data as any)?.written ?? 0} rows`);
      } catch (e: any) {
        anyError = true;
        results.push(`Google Ads failed: ${e?.message ?? "unknown"}`);
      }
    }

    if (hasCtm) {
      try {
        const { data, error } = await supabase.functions.invoke("sync-ctm", {
          body: { property_id: p.id, days: 30 },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        const written = (data as any)?.calls_written ?? 0;
        const fetched = (data as any)?.total_fetched ?? 0;
        results.push(`CTM: ${fetched} fetched, ${written} new`);
      } catch (e: any) {
        anyError = true;
        results.push(`CTM failed: ${e?.message ?? "unknown"}`);
      }
    }

    (anyError ? toast.error : toast.success)(results.join(" · "));
    setSyncingId(null);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Properties"
        description="Manage every Ridgeside K9 location, its data sources, and public share links."
        actions={
          <div className="flex items-center gap-2">
            <MCCImportDialog
              properties={rows}
              onImported={load}
              trigger={
                <Button variant="outline" size="sm">
                  <Download className="mr-1.5 h-4 w-4" />
                  Import from MCC
                </Button>
              }
            />
            <CTMImportDialog
              properties={rows}
              onImported={load}
              trigger={
                <Button variant="outline" size="sm">
                  <Download className="mr-1.5 h-4 w-4" />
                  Import from CTM
                </Button>
              }
            />
            <PropertyDialog
              onSaved={load}
              trigger={
                <Button size="sm">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add property
                </Button>
              }
            />
          </div>
        }
      />

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />
      ) : rows.length === 0 ? (
        <EmptyState title="No properties yet" description="Add your first Ridgeside K9 location to get started." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connected sources</TableHead>
                <TableHead>Last synced</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const isSyncing = syncingId === p.id;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <PropertyAvatar property={p} size="md" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">/{p.slug}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                        p.is_active ? "bg-success/10 text-success ring-success/20" : "bg-muted text-muted-foreground ring-border"
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${p.is_active ? "bg-success" : "bg-muted-foreground"}`} />
                        {p.is_active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SourceBadges connected={sourcesByProp.get(p.id) ?? []} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {lastSyncByProp.get(p.id)
                        ? new Date(lastSyncByProp.get(p.id)!).toLocaleString()
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {p.public_report_token && (
                          <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <LinkIcon className="h-3 w-3" />
                            <span className="truncate font-mono">/report/{p.public_report_token.slice(0, 8)}…</span>
                          </span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Actions">
                              {isSyncing ? (
                                <RotateCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-4 w-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel className="truncate">{p.name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {p.public_report_token && (
                              <DropdownMenuItem asChild>
                                <a href={`/report/${p.public_report_token}`} target="_blank" rel="noreferrer">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Open public report
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => copyLink(p)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy share link
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setRegenTarget(p); setRegenConfirm(""); }}>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Regenerate share link
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setCtmTarget(p)}>
                              <Phone className="mr-2 h-4 w-4" />
                              CTM connection
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setGhlTarget(p)}>
                              <Zap className="mr-2 h-4 w-4" />
                              Go High Level connection
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isSyncing}
                              onClick={() => syncNow(p)}
                            >
                              <Zap className="mr-2 h-4 w-4" />
                              {isSyncing ? "Syncing…" : "Sync now"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setEditTarget(p)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit property
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* CTM dialog driven from the dropdown */}
      {ctmTarget && (
        <CTMConnectionDialog
          property={ctmTarget}
          source={ctmByProp.get(ctmTarget.id) ?? null}
          onChanged={load}
          open
          onOpenChange={(o) => { if (!o) setCtmTarget(null); }}
        />
      )}

      {ghlTarget && (
        <GHLConnectionDialog
          property={ghlTarget}
          source={ghlByProp.get(ghlTarget.id) ?? null}
          onChanged={load}
          open
          onOpenChange={(o) => { if (!o) setGhlTarget(null); }}
        />
      )}

      {/* Edit dialog driven from the dropdown */}
      {editTarget && (
        <PropertyDialog
          initial={editTarget}
          onSaved={load}
          onDeleted={load}
          open
          onOpenChange={(o) => { if (!o) setEditTarget(null); }}
        />
      )}

      <AlertDialog open={!!regenTarget} onOpenChange={(o) => { if (!o) { setRegenTarget(null); setRegenConfirm(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              Regenerating the report link for <span className="font-medium text-foreground">{regenTarget?.name}</span> will
              immediately invalidate the existing public link. Anyone using the old URL will lose access.
              <br /><br />
              Type <span className="font-mono font-semibold text-foreground">Yes</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={regenConfirm}
            onChange={(e) => setRegenConfirm(e.target.value)}
            placeholder="Yes"
            onKeyDown={(e) => {
              if (e.key === "Enter" && regenConfirm.trim().toLowerCase() === "yes" && regenTarget) {
                const p = regenTarget;
                setRegenTarget(null);
                setRegenConfirm("");
                regenToken(p);
              }
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={regenConfirm.trim().toLowerCase() !== "yes"}
              onClick={() => {
                if (!regenTarget) return;
                const p = regenTarget;
                setRegenTarget(null);
                setRegenConfirm("");
                regenToken(p);
              }}
            >
              Regenerate link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}