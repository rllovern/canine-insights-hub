import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Unplug, CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Property, PropertyDataSource } from "@/lib/types";
import { toast } from "sonner";
import { usePreviewMode } from "@/contexts/PreviewModeContext";

interface Props {
  property: Property;
  source: PropertyDataSource | null;
  onChanged: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ScopeResult { label: string; path: string; ok: boolean; status: number; message: string; }

export function GHLConnectionDialog({ property, source, onChanged, trigger, open: ctlOpen, onOpenChange: setCtlOpen }: Props) {
  const { isSuperAdmin } = usePreviewMode();
  const [uOpen, setUOpen] = useState(false);
  const open = ctlOpen ?? uOpen;
  const setOpen = setCtlOpen ?? setUOpen;

  const initialLocation = ((source?.config as Record<string, unknown> | null)?.location_id as string | undefined) ?? "";
  const [locationId, setLocationId] = useState(initialLocation);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [scopeResults, setScopeResults] = useState<ScopeResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocationId(initialLocation);
    setToken("");
    setScopeResults(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = async () => {
    if (!locationId.trim()) { toast.error("Enter the GHL Location ID"); return; }
    if (!token.trim()) { toast.error("Paste the sub-account Private Integration token"); return; }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("save-ghl-connection", {
      body: { property_id: property.id, location_id: locationId.trim(), token: token.trim() },
    });
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    const payload = data as { ok?: boolean; error?: string } | null;
    if (!payload?.ok) { toast.error(payload?.error ?? "Save failed"); return; }
    toast.success("Go High Level connected");
    setToken("");
    onChanged();
  };

  const handleTest = async () => {
    setTesting(true);
    setScopeResults(null);
    const { data, error } = await supabase.functions.invoke("check-ghl-access", {
      body: { property_id: property.id },
    });
    setTesting(false);
    if (error) { toast.error(`Test failed: ${error.message}`); return; }
    const payload = data as { results?: ScopeResult[]; error?: string } | null;
    if (payload?.error) { toast.error(payload.error); return; }
    setScopeResults(payload?.results ?? []);
  };

  const handleSync = async () => {
    setSyncing(true);
    const date_from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const date_to = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.functions.invoke("sync-ghl", {
      body: { property_id: property.id, date_from, date_to },
    });
    setSyncing(false);
    if (error) { toast.error(`Sync failed: ${error.message}`); return; }
    if ((data as { error?: string })?.error) { toast.error((data as { error: string }).error); return; }
    toast.success(`Synced GHL. Wrote ${(data as { written?: number })?.written ?? 0} records.`);
    onChanged();
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    const { error } = await supabase
      .from("property_data_sources")
      .update({ is_connected: false, status: "disconnected", config: null, secret_token: null })
      .eq("property_id", property.id)
      .eq("source", "ghl");
    setDisconnecting(false);
    if (error) { toast.error(`Disconnect failed: ${error.message}`); return; }
    toast.success("GHL disconnected");
    onChanged();
    setOpen(false);
  };

  const isConnected = !!source?.is_connected;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Go High Level — {property.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground">Per sub-account setup</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>In GHL, open this client's sub-account.</li>
              <li>Settings → Private Integrations → <span className="font-medium">Create new</span>.</li>
              <li>Enable read scopes: <span className="font-medium">Contacts, Conversations, Conversation Messages, Opportunities, Locations</span>.</li>
              <li>Copy the generated <span className="font-mono">pit-…</span> token and the Location ID from Settings → Business Profile.</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ghl-location-id">GHL Location ID</Label>
            <Input
              id="ghl-location-id"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="e.g. abc123XYZ"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ghl-token">Private Integration Token</Label>
            <Input
              id="ghl-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={isConnected ? "Leave blank to keep the saved token" : "pit-..."}
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              Stored encrypted at rest. Required to (re)save the connection.
            </p>
          </div>

          {isConnected && (
            <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected. Last sync:{" "}
              {source.last_synced_at ? new Date(source.last_synced_at).toLocaleString() : "never"}
            </div>
          )}

          {scopeResults && (
            <div className="rounded-md border border-border p-2 space-y-1 text-xs">
              {scopeResults.map((r) => (
                <div key={r.label} className="flex items-start gap-2">
                  {r.ok
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success shrink-0" />
                    : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-destructive shrink-0" />}
                  <div className="flex-1">
                    <div className="font-medium">{r.label} <span className="text-muted-foreground">({r.status})</span></div>
                    {!r.ok && <div className="text-muted-foreground">{r.message}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {!isSuperAdmin && (
            <div className="mr-auto text-[11px] text-muted-foreground">
              Read-only. Only a Super Admin can save, sync, or disconnect this integration.
            </div>
          )}
          {isConnected && (
            <>
              <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting || !isSuperAdmin}>
                {disconnecting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Unplug className="mr-1.5 h-4 w-4" />}
                Disconnect
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing || !isSuperAdmin}>
                {testing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
                Test access
              </Button>
              <Button variant="outline" onClick={handleSync} disabled={syncing || !isSuperAdmin}>
                {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                Sync now
              </Button>
            </>
          )}
          <Button onClick={handleSave} disabled={saving || !locationId.trim() || !token.trim() || !isSuperAdmin}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}