import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProperties } from "@/contexts/PropertyContext";
import { useNotices, eastern } from "@/contexts/NoticeContext";
import { AnnouncementBody } from "@/components/notices/AnnouncementDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { AppRole } from "@/lib/types";

type Severity = "info" | "warning" | "critical";
type Audience = "all" | "roles" | "properties";
type Frequency = "once" | "every_login";

interface Row {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  audience: Audience;
  audience_roles: AppRole[] | null;
  audience_property_ids: string[] | null;
  frequency: Frequency;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
}

const ROLES: AppRole[] = ["super_admin", "admin", "owner", "location_owner"];
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  owner: "Owner",
  location_owner: "Location Owner",
  viewer: "Viewer",
};

const blank = {
  title: "",
  body: "",
  severity: "info" as Severity,
  audience: "all" as Audience,
  audience_roles: [] as AppRole[],
  audience_property_ids: [] as string[],
  frequency: "once" as Frequency,
  ends_at: "",
  active: true,
};

export default function AdminAnnouncements() {
  const { user } = useAuth();
  const { properties } = useProperties();
  const { maintenance, reload: reloadNotices } = useNotices();
  const navState = useLocation().state as { draft?: { title: string; body: string } } | null;

  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Maintenance form
  const [mMessage, setMMessage] = useState("");
  const [mBackAt, setMBackAt] = useState("");
  const [mStart, setMStart] = useState("");
  const [mEnd, setMEnd] = useState("");

  const load = useCallback(async () => {
    const [{ data: a }, { data: d }] = await Promise.all([
      supabase.from("site_announcements").select("*").order("created_at", { ascending: false }),
      supabase.from("announcement_dismissals").select("announcement_id"),
    ]);
    setRows((a as Row[]) ?? []);
    const c: Record<string, number> = {};
    ((d as { announcement_id: string }[]) ?? []).forEach((r) => { c[r.announcement_id] = (c[r.announcement_id] ?? 0) + 1; });
    setCounts(c);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (maintenance) {
      setMMessage(maintenance.message ?? "");
      setMBackAt(maintenance.expected_back_at ? maintenance.expected_back_at.slice(0, 16) : "");
      setMStart(maintenance.scheduled_start ? maintenance.scheduled_start.slice(0, 16) : "");
      setMEnd(maintenance.scheduled_end ? maintenance.scheduled_end.slice(0, 16) : "");
    }
  }, [maintenance]);

  // Draft handed over from a resolved incident.
  useEffect(() => {
    if (navState?.draft) {
      setForm({ ...blank, title: navState.draft.title, body: navState.draft.body, active: false });
      setEditingId(null);
      setOpen(true);
    }
  }, [navState]);

  const startNew = () => { setForm({ ...blank }); setEditingId(null); setOpen(true); };
  const startEdit = (r: Row) => {
    setForm({
      title: r.title,
      body: r.body,
      severity: r.severity,
      audience: r.audience,
      audience_roles: r.audience_roles ?? [],
      audience_property_ids: r.audience_property_ids ?? [],
      frequency: r.frequency,
      ends_at: r.ends_at ? r.ends_at.slice(0, 16) : "",
      active: r.active,
    });
    setEditingId(r.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) { toast.error("Title and message are required."); return; }
    setBusy(true);
    const payload = {
      title: form.title.trim(),
      body: form.body,
      severity: form.severity,
      audience: form.audience,
      audience_roles: form.audience === "roles" ? form.audience_roles : null,
      audience_property_ids: form.audience === "properties" ? form.audience_property_ids : null,
      frequency: form.frequency,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      active: form.active,
      created_by: user?.id ?? null,
    };
    const { error } = editingId
      ? await supabase.from("site_announcements").update(payload).eq("id", editingId)
      : await supabase.from("site_announcements").insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? "Announcement updated" : "Announcement created");
    setOpen(false);
    void load();
    void reloadNotices();
  };

  const toggleActive = async (r: Row) => {
    const { error } = await supabase.from("site_announcements").update({ active: !r.active }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    void load(); void reloadNotices();
  };

  const remove = async (r: Row) => {
    const { error } = await supabase.from("site_announcements").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Announcement deleted");
    void load(); void reloadNotices();
  };

  const saveMaintenance = async (patch: {
    active?: boolean;
    message?: string;
    expected_back_at?: string | null;
    scheduled_start?: string | null;
    scheduled_end?: string | null;
    started_by?: string | null;
    started_at?: string | null;
  }) => {
    const { error } = await supabase.from("maintenance_mode").update(patch).eq("id", 1);
    if (error) { toast.error(error.message); return; }
    void reloadNotices();
    toast.success("Maintenance settings saved");
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Announcements &amp; Maintenance</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Post a notice to owners, and take the dashboard offline for everyone except internal staff.
        </p>
      </div>

      {/* Maintenance ------------------------------------------------------ */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-semibold">Maintenance mode</div>
            <div className="text-[11px] text-muted-foreground">
              {maintenance?.active
                ? "ON — everyone except Super Admins and Admins sees the maintenance page."
                : maintenance?.scheduled_start && maintenance?.scheduled_end
                  ? `Scheduled ${eastern(maintenance.scheduled_start)} → ${eastern(maintenance.scheduled_end)}`
                  : "Off"}
            </div>
          </div>
          <Switch
            checked={!!maintenance?.active}
            onCheckedChange={(v) =>
              saveMaintenance({
                active: v,
                message: mMessage || "The dashboard is down for scheduled maintenance.",
                expected_back_at: mBackAt ? new Date(mBackAt).toISOString() : null,
                started_by: v ? user?.id ?? null : null,
                started_at: v ? new Date().toISOString() : null,
              })
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Message shown to users</Label>
            <Textarea value={mMessage} onChange={(e) => setMMessage(e.target.value)} rows={2} className="text-[13px]" />
          </div>
          <div>
            <Label className="text-[11px]">Expected back at</Label>
            <Input type="datetime-local" value={mBackAt} onChange={(e) => setMBackAt(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                saveMaintenance({
                  message: mMessage || "The dashboard is down for scheduled maintenance.",
                  expected_back_at: mBackAt ? new Date(mBackAt).toISOString() : null,
                })
              }
            >
              Save message
            </Button>
          </div>
          <div>
            <Label className="text-[11px]">Schedule start</Label>
            <Input type="datetime-local" value={mStart} onChange={(e) => setMStart(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Schedule end</Label>
            <Input type="datetime-local" value={mEnd} onChange={(e) => setMEnd(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                saveMaintenance({
                  scheduled_start: mStart ? new Date(mStart).toISOString() : null,
                  scheduled_end: mEnd ? new Date(mEnd).toISOString() : null,
                })
              }
            >
              Save window
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setMStart(""); setMEnd(""); saveMaintenance({ scheduled_start: null, scheduled_end: null }); }}
            >
              Clear window
            </Button>
          </div>
        </div>
      </div>

      {/* Announcements ---------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Announcements</h2>
        <Button size="sm" onClick={startNew}><Plus className="h-3.5 w-3.5 mr-1.5" /> New announcement</Button>
      </div>

      {open && (
        <div className="rounded-lg border border-border bg-card p-4 grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <Label className="text-[11px]">Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px]">Message</Label>
              <Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as Severity })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">How often</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as Frequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Once, until dismissed</SelectItem>
                    <SelectItem value="every_login">Every login</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-[11px]">Who sees it</Label>
              <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v as Audience })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="roles">Selected roles</SelectItem>
                  <SelectItem value="properties">Selected locations</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.audience === "roles" && (
              <div className="flex flex-wrap gap-3">
                {ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1.5 text-[12px]">
                    <Checkbox
                      checked={form.audience_roles.includes(r)}
                      onCheckedChange={(c) =>
                        setForm({
                          ...form,
                          audience_roles: c ? [...form.audience_roles, r] : form.audience_roles.filter((x) => x !== r),
                        })
                      }
                    />
                    {ROLE_LABELS[r] ?? r}
                  </label>
                ))}
              </div>
            )}
            {form.audience === "properties" && (
              <div className="flex flex-wrap gap-3">
                {properties.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-[12px]">
                    <Checkbox
                      checked={form.audience_property_ids.includes(p.id)}
                      onCheckedChange={(c) =>
                        setForm({
                          ...form,
                          audience_property_ids: c
                            ? [...form.audience_property_ids, p.id]
                            : form.audience_property_ids.filter((x) => x !== p.id),
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <Label className="text-[11px]">Stop showing after (optional)</Label>
                <Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-[12px]">
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /> Active
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={save}>{editingId ? "Save changes" : "Create"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Preview</div>
            <AnnouncementBody announcement={{ title: form.title || "Title", body: form.body || "Message", severity: form.severity }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No announcements yet.</div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-3 p-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{r.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {r.severity} · {r.audience === "all" ? "everyone" : r.audience === "roles" ? (r.audience_roles ?? []).map((x) => ROLE_LABELS[x] ?? x).join(", ") : `${(r.audience_property_ids ?? []).length} location(s)`}
                  {" · "}{r.frequency === "once" ? "once" : "every login"}
                  {" · "}dismissed by {counts[r.id] ?? 0}
                  {r.ends_at ? ` · ends ${eastern(r.ends_at)}` : ""}
                </div>
              </div>
              <Switch checked={r.active} onCheckedChange={() => toggleActive(r)} />
              <Button size="sm" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
