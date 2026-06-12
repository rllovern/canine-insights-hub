import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Unplug, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Property, PropertyDataSource } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  property: Property;
  source: PropertyDataSource | null;
  onChanged: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface GhlLocation { id: string; name: string; address: string | null; }

export function GHLConnectionDialog({ property, source, onChanged, trigger, open: ctlOpen, onOpenChange: setCtlOpen }: Props) {
  const [uOpen, setUOpen] = useState(false);
  const open = ctlOpen ?? uOpen;
  const setOpen = setCtlOpen ?? setUOpen;

  const initialLocation = ((source?.config as Record<string, unknown> | null)?.location_id as string | undefined) ?? "";
  const [locationId, setLocationId] = useState(initialLocation);
  const [locations, setLocations] = useState<GhlLocation[]>([]);
  const [loadingLocs, setLoadingLocs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocationId(initialLocation);
    void loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadLocations = async () => {
    setLoadingLocs(true);
    const { data, error } = await supabase.functions.invoke("list-ghl-locations", { body: {} });
    setLoadingLocs(false);
    if (error) { toast.error(`Could not load GHL locations: ${error.message}`); return; }
    const payload = data as { locations?: GhlLocation[]; error?: string } | null;
    if (payload?.error) toast.error(payload.error);
    setLocations(payload?.locations ?? []);
  };

  const handleSave = async () => {
    if (!locationId) { toast.error("Pick a GHL location"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("property_data_sources")
      .upsert(
        {
          property_id: property.id,
          source: "ghl",
          is_connected: true,
          status: "connected",
          config: { location_id: locationId },
          last_error: null,
        },
        { onConflict: "property_id,source" },
      );
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    toast.success("Go High Level connected");
    onChanged();
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
      .update({ is_connected: false, status: "disconnected", config: null })
      .eq("property_id", property.id)
      .eq("source", "ghl");
    setDisconnecting(false);
    if (error) { toast.error(`Disconnect failed: ${error.message}`); return; }
    toast.success("GHL disconnected");
    onChanged();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Go High Level — {property.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>GHL Location</Label>
            {loadingLocs ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading locations…
              </div>
            ) : (
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                  {!locations.length && (
                    <div className="p-2 text-xs text-muted-foreground">No locations returned.</div>
                  )}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-muted-foreground">
              Uses the agency-wide GHL Private Integration token.
            </p>
          </div>

          {source?.is_connected && (
            <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected. Last sync:{" "}
              {source.last_synced_at ? new Date(source.last_synced_at).toLocaleString() : "never"}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {source?.is_connected && (
            <>
              <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Unplug className="mr-1.5 h-4 w-4" />}
                Disconnect
              </Button>
              <Button variant="outline" onClick={handleSync} disabled={syncing}>
                {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                Sync now
              </Button>
            </>
          )}
          <Button onClick={handleSave} disabled={saving || !locationId}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}