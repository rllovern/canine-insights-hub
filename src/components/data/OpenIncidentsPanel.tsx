import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BellOff, Bell, Check, Loader2, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import {
  DEFAULT_NOTICE_SETTINGS,
  NOTICE_SOURCE_LABELS,
  eastern,
  renderNotice,
  type NoticeSettings,
} from "@/contexts/NoticeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type OwnerNotice = "auto" | "show" | "hide" | "maintenance";

interface Incident {
  id: string;
  source: string;
  error_class: string;
  runbook_id: string | null;
  affected_property_ids: string[];
  first_error: string | null;
  opened_at: string;
  resolved_at: string | null;
  muted: boolean;
  mute_reason: string | null;
  acknowledged_at: string | null;
  owner_notice: OwnerNotice;
}

interface RunbookEntry { id: string; title: string; fix_steps: string }

const SOURCE_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  ctm: "CallTrackingMetrics",
  ghl: "Go High Level",
};

export function OpenIncidentsPanel() {
  const { isSuperAdmin } = usePreviewMode();
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [resolved, setResolved] = useState<Incident[]>([]);
  const [runbook, setRunbook] = useState<Record<string, RunbookEntry>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<NoticeSettings>(DEFAULT_NOTICE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: inc }, { data: res }, { data: rb }, { data: props }, { data: st }] = await Promise.all([
      supabase.from("data_source_incidents").select("*").is("resolved_at", null).order("opened_at", { ascending: false }),
      supabase.from("data_source_incidents").select("*").not("resolved_at", "is", null).gte("resolved_at", weekAgo).order("resolved_at", { ascending: false }),
      supabase.from("alert_runbook").select("id,title,fix_steps"),
      supabase.from("properties").select("id,name"),
      supabase.from("incident_notice_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    setIncidents((inc as Incident[]) ?? []);
    setResolved((res as Incident[]) ?? []);
    setRunbook(Object.fromEntries(((rb as RunbookEntry[]) ?? []).map((r) => [r.id, r])));
    setNames(Object.fromEntries(((props as { id: string; name: string }[]) ?? []).map((p) => [p.id, p.name])));
    if (st) setSettings(st as NoticeSettings);
    setLoading(false);
  }, []);

  useEffect(() => { if (isSuperAdmin) load(); else setLoading(false); }, [isSuperAdmin, load]);

  if (!isSuperAdmin) return null;

  const patch = async (
    inc: Incident,
    values: Partial<Pick<Incident, "muted" | "mute_reason" | "acknowledged_at" | "owner_notice">>,
    msg: string,
  ) => {
    setBusy(true);
    const { error } = await supabase.from("data_source_incidents").update(values).eq("id", inc.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(msg);
    load();
  };

  const toggleMute = async (inc: Incident) => {
    if (!inc.muted) {
      if (reasonFor !== inc.id) { setReasonFor(inc.id); setReason(""); return; }
      if (!reason.trim()) { toast.error("A reason is required to mute an incident."); return; }
    }
    setReasonFor(null);
    const values = inc.muted ? { muted: false, mute_reason: null } : { muted: true, mute_reason: reason.trim() };
    setReason("");
    await patch(inc, values, inc.muted ? "Alerts unmuted" : "Alerts muted");
  };

  const draftAnnouncement = (inc: Incident) => {
    const locations = inc.affected_property_ids.map((p) => names[p] ?? p).join(", ");
    navigate("/admin/announcements", {
      state: {
        draft: {
          title: "Data update",
          body: `${NOTICE_SOURCE_LABELS[inc.source] ?? inc.source} data for ${locations} was delayed from ${eastern(inc.opened_at)} to ${eastern(inc.resolved_at)}. It has fully caught up and all figures are current.`,
        },
      },
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        Open incidents
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {!loading && incidents.length === 0 && (
        <p className="text-[11px] text-muted-foreground mt-1">No open incidents — every monitored source is reporting in.</p>
      )}

      <div className="mt-2 space-y-3">
        {incidents.map((inc) => {
          const rb = inc.runbook_id ? runbook[inc.runbook_id] : undefined;
          const locationNames = inc.affected_property_ids.map((p) => names[p] ?? p);
          const preview = renderNotice(settings, inc.source, locationNames, inc.opened_at);
          return (
            <div key={inc.id} className="rounded-lg border border-border/70 p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">
                    {SOURCE_LABELS[inc.source] ?? inc.source} — {rb?.title ?? inc.error_class}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Open since {new Date(inc.opened_at).toLocaleString()} · {inc.affected_property_ids.length} location
                    {inc.affected_property_ids.length === 1 ? "" : "s"}
                    {inc.acknowledged_at && ` · acknowledged ${eastern(inc.acknowledged_at)}`}
                    {inc.muted && ` · muted: ${inc.mute_reason ?? "no reason"}`}
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleMute(inc)}>
                  {inc.muted ? <><Bell className="h-3.5 w-3.5 mr-1.5" /> Unmute</> : <><BellOff className="h-3.5 w-3.5 mr-1.5" /> Mute</>}
                </Button>
              </div>

              {reasonFor === inc.id && !inc.muted && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for muting (required)"
                    className="h-8 text-[12px]"
                  />
                  <Button size="sm" disabled={busy || !reason.trim()} onClick={() => toggleMute(inc)}>Confirm</Button>
                </div>
              )}

              <ul className="mt-2 space-y-0.5">
                {inc.affected_property_ids.map((pid) => (
                  <li key={pid} className="text-[11px] text-muted-foreground">• {names[pid] ?? pid}</li>
                ))}
              </ul>

              {rb?.fix_steps && (
                <p className="mt-2 text-[11px] whitespace-pre-wrap">
                  <span className="font-medium">Fix: </span>{rb.fix_steps}
                </p>
              )}
              {inc.first_error && (
                <p className="mt-1 text-[10px] text-muted-foreground break-words">{inc.first_error}</p>
              )}

              {/* Owner-facing notice controls */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !!inc.acknowledged_at}
                  onClick={() => patch(inc, { acknowledged_at: new Date().toISOString() }, "Incident acknowledged")}
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  {inc.acknowledged_at ? "Acknowledged" : "Acknowledge"}
                </Button>
                <span className="text-[11px] text-muted-foreground">Owner notice</span>
                <Select
                  value={inc.owner_notice}
                  onValueChange={(v) => patch(inc, { owner_notice: v as OwnerNotice }, "Owner notice updated")}
                >
                  <SelectTrigger className="h-8 w-[190px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (after {settings.auto_notice_after_hours}h)</SelectItem>
                    <SelectItem value="show">Show now</SelectItem>
                    <SelectItem value="hide">Hide</SelectItem>
                    <SelectItem value="maintenance">Maintenance page</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">What owners see</div>
                <div className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">{preview.title}</div>
                <p className="text-[11px] text-muted-foreground">{preview.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {resolved.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-[12px] font-semibold">Recently resolved</div>
          <div className="mt-2 space-y-2">
            {resolved.map((inc) => (
              <div key={inc.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0 text-[11px] text-muted-foreground">
                  {SOURCE_LABELS[inc.source] ?? inc.source} · {inc.affected_property_ids.length} location
                  {inc.affected_property_ids.length === 1 ? "" : "s"} · resolved {eastern(inc.resolved_at)}
                </div>
                <Button size="sm" variant="ghost" onClick={() => draftAnnouncement(inc)}>
                  <Megaphone className="h-3.5 w-3.5 mr-1.5" /> Draft announcement
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
