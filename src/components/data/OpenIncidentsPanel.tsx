import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellOff, Bell, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Incident {
  id: string;
  source: string;
  error_class: string;
  runbook_id: string | null;
  affected_property_ids: string[];
  first_error: string | null;
  opened_at: string;
  muted: boolean;
  mute_reason: string | null;
}

interface RunbookEntry { id: string; title: string; fix_steps: string }

const SOURCE_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  ctm: "CallTrackingMetrics",
  ghl: "Go High Level",
};

export function OpenIncidentsPanel() {
  const { isSuperAdmin } = usePreviewMode();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [runbook, setRunbook] = useState<Record<string, RunbookEntry>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: inc }, { data: rb }, { data: props }] = await Promise.all([
      supabase.from("data_source_incidents").select("*").is("resolved_at", null).order("opened_at", { ascending: false }),
      supabase.from("alert_runbook").select("id,title,fix_steps"),
      supabase.from("properties").select("id,name"),
    ]);
    setIncidents((inc as Incident[]) ?? []);
    setRunbook(Object.fromEntries(((rb as RunbookEntry[]) ?? []).map((r) => [r.id, r])));
    setNames(Object.fromEntries(((props as { id: string; name: string }[]) ?? []).map((p) => [p.id, p.name])));
    setLoading(false);
  }, []);

  useEffect(() => { if (isSuperAdmin) load(); else setLoading(false); }, [isSuperAdmin, load]);

  if (!isSuperAdmin) return null;

  const toggleMute = async (inc: Incident) => {
    if (!inc.muted) {
      if (reasonFor !== inc.id) { setReasonFor(inc.id); setReason(""); return; }
      if (!reason.trim()) { toast.error("A reason is required to mute an incident."); return; }
    }
    setBusy(true);
    const { error } = await supabase
      .from("data_source_incidents")
      .update(inc.muted ? { muted: false, mute_reason: null } : { muted: true, mute_reason: reason.trim() })
      .eq("id", inc.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(inc.muted ? "Alerts unmuted" : "Alerts muted");
    setReasonFor(null); setReason("");
    load();
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
