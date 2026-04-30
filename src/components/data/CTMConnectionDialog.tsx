import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Property, PropertyDataSource } from "@/lib/types";
import { toast } from "sonner";
import { Loader2, Phone, RefreshCw, Unplug, CheckCircle2 } from "lucide-react";

interface Props {
  property: Property;
  source: PropertyDataSource | null;
  onChanged: () => void;
  trigger: React.ReactNode;
}

interface CTMConfig {
  account_id?: string;
  api_token?: string;
  api_secret?: string;
  account_name?: string;
  number_filter?: string[];
}

export function CTMConnectionDialog({ property, source, onChanged, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const cfg = (source?.config ?? {}) as CTMConfig;

  const [accountId, setAccountId] = useState(cfg.account_id ?? "");
  const [apiToken, setApiToken] = useState(cfg.api_token ?? "");
  const [apiSecret, setApiSecret] = useState(cfg.api_secret ?? "");
  const [numberFilter, setNumberFilter] = useState((cfg.number_filter ?? []).join(", "));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testedName, setTestedName] = useState<string | null>(cfg.account_name ?? null);

  useEffect(() => {
    if (open) {
      setAccountId(cfg.account_id ?? "");
      setApiToken(cfg.api_token ?? "");
      setApiSecret(cfg.api_secret ?? "");
      setNumberFilter((cfg.number_filter ?? []).join(", "));
      setTestedName(cfg.account_name ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleTest = async () => {
    if (!accountId || !apiToken || !apiSecret) {
      toast.error("Account ID, token, and secret are required.");
      return;
    }
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("test-ctm", {
      body: { account_id: accountId, api_token: apiToken, api_secret: apiSecret },
    });
    setTesting(false);
    if (error || !data?.ok) {
      setTestedName(null);
      toast.error(`Connection failed: ${data?.error ?? error?.message ?? "unknown error"}`);
      return;
    }
    setTestedName(data.account_name ?? "Connected");
    toast.success(`Connected to ${data.account_name ?? "CTM account"}`);
  };

  const handleSave = async () => {
    if (!accountId || !apiToken || !apiSecret) {
      toast.error("All fields are required.");
      return;
    }
    setSaving(true);
    const config: CTMConfig = {
      account_id: accountId.trim(),
      api_token: apiToken.trim(),
      api_secret: apiSecret.trim(),
      account_name: testedName ?? undefined,
      number_filter: numberFilter
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (source) {
      const { error } = await supabase
        .from("property_data_sources")
        .update({ config: config as never, is_connected: true })
        .eq("id", source.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase
        .from("property_data_sources")
        .insert({
          property_id: property.id,
          source: "ctm",
          is_connected: true,
          config: config as never,
        });
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    setSaving(false);
    toast.success("CTM connection saved.");
    onChanged();
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const { data, error } = await supabase.functions.invoke("sync-ctm", {
      body: { property_id: property.id, from_date: ymd(from), to_date: ymd(to) },
    });
    setSyncing(false);
    if (error) { toast.error(error.message); return; }
    if ((data as { error?: string })?.error) { toast.error((data as { error: string }).error); return; }
    toast.success(`Synced ${(data as { rows_written?: number })?.rows_written ?? 0} calls.`);
    onChanged();
  };

  const handleDisconnect = async () => {
    if (!source) return;
    const { error } = await supabase
      .from("property_data_sources")
      .update({ is_connected: false, config: {} as never })
      .eq("id", source.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Disconnected CTM.");
    setOpen(false);
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            CallTrackingMetrics — {property.name}
          </DialogTitle>
        </DialogHeader>

        {source?.is_connected && source.last_synced_at && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              Connected{cfg.account_name ? ` to ${cfg.account_name}` : ""}
            </div>
            <div className="mt-1 text-muted-foreground">
              Last synced {new Date(source.last_synced_at).toLocaleString()}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ctm-acct">Account ID</Label>
            <Input id="ctm-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="123456" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctm-token">API Token (Access Key)</Label>
            <Input id="ctm-token" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctm-secret">API Secret</Label>
            <Input id="ctm-secret" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctm-filter">Tracking number filter (optional)</Label>
            <Input
              id="ctm-filter"
              value={numberFilter}
              onChange={(e) => setNumberFilter(e.target.value)}
              placeholder="+15555550100, +15555550101"
            />
            <p className="text-[11px] text-muted-foreground">
              Comma-separated. Use when one CTM account spans multiple Ridgeside properties.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Test connection
            </Button>
            {testedName && <span className="text-xs text-success">{testedName}</span>}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            {source?.is_connected && (
              <>
                <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing}>
                  {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Sync now (30d)
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDisconnect}>
                  <Unplug className="mr-1.5 h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : source?.is_connected ? "Update" : "Connect"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
