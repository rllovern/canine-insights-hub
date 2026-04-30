import { useEffect, useMemo, useState } from "react";
import { Link as LinkIcon, Copy, ExternalLink, Pencil, Plus, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Property, DataSource, PropertyDataSource } from "@/lib/types";
import { PageHeader } from "@/components/data/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SourceBadges } from "@/components/data/SourceBadges";
import { PropertyAvatar } from "@/components/brand/PropertyAvatar";
import { generateReportToken, slugify } from "@/lib/tokens";
import { useProperties } from "@/contexts/PropertyContext";
import { toast } from "sonner";
import { EmptyState } from "@/components/data/EmptyState";

function PropertyDialog({
  initial,
  onSaved,
  trigger,
}: {
  initial?: Property | null;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "America/New_York");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setSlug(initial?.slug ?? "");
      setTimezone(initial?.timezone ?? "America/New_York");
      setLogoFile(null);
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit property" : "Add property"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Ridgeside Canine — Asheville" />
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
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminProperties() {
  const { reload } = useProperties();
  const [rows, setRows] = useState<Property[]>([]);
  const [sources, setSources] = useState<PropertyDataSource[]>([]);
  const [loading, setLoading] = useState(true);

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
      arr.push(s.source);
      m.set(s.property_id, arr);
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Properties"
        description="Manage every Ridgeside Canine location, its data sources, and public share links."
        actions={
          <PropertyDialog
            onSaved={load}
            trigger={
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                Add property
              </Button>
            }
          />
        }
      />

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />
      ) : rows.length === 0 ? (
        <EmptyState title="No properties yet" description="Add your first Ridgeside Canine location to get started." />
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
              {rows.map((p) => (
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
                  <TableCell className="text-xs text-muted-foreground">Never</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <PropertyDialog
                        initial={p}
                        onSaved={load}
                        trigger={
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Copy share link" onClick={() => copyLink(p)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Regenerate share link" onClick={() => regenToken(p)}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      {p.public_report_token && (
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Open public report">
                          <a href={`/report/${p.public_report_token}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                    </div>
                    {p.public_report_token && (
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                        <LinkIcon className="h-3 w-3" />
                        <span className="truncate font-mono">/report/{p.public_report_token.slice(0, 8)}…</span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}