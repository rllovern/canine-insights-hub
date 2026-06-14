import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Property, PropertyDataSource } from "@/lib/types";
import { toast } from "sonner";
import { Loader2, Phone, RefreshCw, Unplug, CheckCircle2, Plus, Trash2, Tags } from "lucide-react";

interface Props {
  property: Property;
  source: PropertyDataSource | null;
  onChanged: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface CTMConfig {
  account_id?: string;
  api_token?: string;
  api_secret?: string;
  account_name?: string;
  number_filter?: string[];
}

type Bucket = "projected_sale" | "good" | "bad" | "spam" | "repeat" | "no_entry" | "ignore";
const BUCKET_TO_DB: Record<Bucket, string> = {
  projected_sale: "projected_sale",
  good: "good",
  bad: "bad",
  spam: "spam",
  repeat: "repeat",
  no_entry: "no_entry",
  ignore: "ignore",
};
const DB_TO_BUCKET: Record<string, Bucket> = {
  projected_sale: "projected_sale",
  good: "good",
  bad: "bad",
  spam: "spam",
  repeat: "repeat",
  no_entry: "no_entry",
  ignore: "ignore",
};
const BUCKET_LABELS: Record<Bucket, string> = {
  projected_sale: "Projected Sale",
  good: "Good Lead",
  bad: "Bad Lead",
  spam: "Spam",
  repeat: "Repeat (excluded)",
  no_entry: "No Entry",
  ignore: "Ignore (drop)",
};

interface MappingRow {
  id?: string;
  score_label: string;
  bucket: Bucket;
}

export function CTMConnectionDialog({ property, source, onChanged, trigger, open: controlledOpen, onOpenChange: setControlledOpen }: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = setControlledOpen ?? setUncontrolledOpen;
  const cfg = (source?.config ?? {}) as CTMConfig;

  const [accountId, setAccountId] = useState(cfg.account_id ?? "");
  const [apiToken, setApiToken] = useState(cfg.api_token ?? "");
  const [apiSecret, setApiSecret] = useState(cfg.api_secret ?? "");
  const [numberFilter, setNumberFilter] = useState((cfg.number_filter ?? []).join(", "));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testedName, setTestedName] = useState<string | null>(cfg.account_name ?? null);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [seenLabels, setSeenLabels] = useState<string[]>([]);
  const [savingMappings, setSavingMappings] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    if (open) {
      setAccountId(cfg.account_id ?? "");
      setApiToken(cfg.api_token ?? "");
      setApiSecret(cfg.api_secret ?? "");
      setNumberFilter((cfg.number_filter ?? []).join(", "));
      setTestedName(cfg.account_name ?? null);
      void loadMappings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadMappings = async () => {
    const [m, c] = await Promise.all([
      supabase
        .from("property_call_score_mappings")
        .select("id,score_label,bucket")
        .eq("property_id", property.id)
        .order("score_label"),
      supabase
        .from("ctm_calls")
        .select("call_score_label")
        .eq("property_id", property.id)
        .not("call_score_label", "is", null),
    ]);
    const rows: MappingRow[] = (m.data ?? []).map((r: any) => ({
      id: r.id,
      score_label: r.score_label,
      bucket: DB_TO_BUCKET[r.bucket] ?? (r.bucket as Bucket),
    }));
    const seen = Array.from(new Set((c.data ?? []).map((r: any) => r.call_score_label).filter(Boolean) as string[]));
    setMappings(rows);
    setSeenLabels(seen);
  };

  const unmappedSeen = useMemo(() => {
    const have = new Set(mappings.map((r) => r.score_label.toLowerCase()));
    return seenLabels.filter((l) => !have.has(l.toLowerCase()));
  }, [mappings, seenLabels]);

  const updateMappingBucket = (idx: number, bucket: Bucket) => {
    setMappings((rows) => rows.map((r, i) => (i === idx ? { ...r, bucket } : r)));
  };

  const removeMapping = (idx: number) => {
    setMappings((rows) => rows.filter((_, i) => i !== idx));
  };

  const addMapping = (label: string, bucket: Bucket = "no_entry") => {
    const clean = label.trim();
    if (!clean) return;
    if (mappings.some((r) => r.score_label.toLowerCase() === clean.toLowerCase())) {
      toast.error("That label is already mapped.");
      return;
    }
    setMappings((rows) => [...rows, { score_label: clean, bucket }]);
    setNewLabel("");
  };

  const handleSaveMappings = async () => {
    setSavingMappings(true);
    // Replace-all strategy keeps it simple: delete then insert. Mappings are
    // typically <50 rows per property and only edited by internal users.
    const del = await supabase
      .from("property_call_score_mappings")
      .delete()
      .eq("property_id", property.id);
    if (del.error) {
      toast.error(del.error.message);
      setSavingMappings(false);
      return;
    }
    if (mappings.length) {
      const rows = mappings.map((r) => ({
        property_id: property.id,
        score_label: r.score_label.trim(),
        bucket: BUCKET_TO_DB[r.bucket],
        priority: 100,
      }));
      const ins = await supabase.from("property_call_score_mappings").insert(rows);
      if (ins.error) {
        toast.error(ins.error.message);
        setSavingMappings(false);
        return;
      }
    }
    setSavingMappings(false);
    toast.success("Mappings saved. Re-syncing to apply…");
    await handleSyncNow();
    await loadMappings();
  };

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
    // For brand-new connections, seed sensible default reporting-tag mappings
    // so the dashboard isn't empty out of the gate.
    if (!source) {
      await seedDefaultMappings();
    }
    // Kick off an initial 30-day sync so the property doesn't sit empty.
    handleSyncNow();
  };

  const seedDefaultMappings = async () => {
    const existing = await supabase
      .from("property_call_score_mappings")
      .select("id")
      .eq("property_id", property.id)
      .limit(1);
    if (existing.data && existing.data.length > 0) return;
    const seeds: Array<[string, Bucket]> = [
      ["Projected Sale", "projected_sale"],
      ["Good Lead", "good"],
      ["Bad Lead", "bad"],
      ["Repeat Caller", "repeat"],
      ["Misc", "no_entry"],
      ["SPAM / Dead Air / Hangup", "spam"],
    ];
    await supabase.from("property_call_score_mappings").insert(
      seeds.map(([score_label, b]) => ({
        property_id: property.id,
        score_label,
        bucket: BUCKET_TO_DB[b],
        priority: 100,
      })),
    );
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
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
              {(cfg as any).use_agency_credentials && (
                <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Agency credentials
                </span>
              )}
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
            <Input
              id="ctm-token"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={(cfg as any).use_agency_credentials ? "Using agency credentials (override here)" : ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctm-secret">API Secret</Label>
            <Input
              id="ctm-secret"
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder={(cfg as any).use_agency_credentials ? "Using agency credentials (override here)" : ""}
            />
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

        {source?.is_connected && (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Tags className="h-3.5 w-3.5" />
              Reporting Tag Mappings
            </div>
            <p className="text-[11px] text-muted-foreground">
              Map each CTM reporting tag to a dashboard bucket. Saving re-syncs and re-classifies existing calls.
            </p>

            {unmappedSeen.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]">
                <div className="mb-1 font-medium">Unmapped tags seen in calls:</div>
                <div className="flex flex-wrap gap-1">
                  {unmappedSeen.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => addMapping(l, "no_entry")}
                      className="rounded bg-card px-1.5 py-0.5 ring-1 ring-border hover:ring-primary"
                      title="Click to add"
                    >
                      <Plus className="mr-0.5 inline h-3 w-3" />
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {mappings.length === 0 && (
                <div className="text-[11px] text-muted-foreground italic">No mappings yet.</div>
              )}
              {mappings.map((row, idx) => (
                <div key={`${row.score_label}-${idx}`} className="flex items-center gap-2">
                  <Input
                    value={row.score_label}
                    onChange={(e) =>
                      setMappings((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, score_label: e.target.value } : r)),
                      )
                    }
                    className="h-8 flex-1 text-xs"
                  />
                  <Select value={row.bucket} onValueChange={(v) => updateMappingBucket(idx, v as Bucket)}>
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => (
                        <SelectItem key={b} value={b} className="text-xs">
                          {BUCKET_LABELS[b]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeMapping(idx)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Add new label…"
                className="h-8 flex-1 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addMapping(newLabel);
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={() => addMapping(newLabel)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
              <Button size="sm" onClick={handleSaveMappings} disabled={savingMappings}>
                {savingMappings ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Save mappings
              </Button>
            </div>
          </div>
        )}

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
