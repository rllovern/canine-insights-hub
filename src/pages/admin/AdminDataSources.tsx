import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface HealthRow {
  source: string;
  property_id: string;
  property_name: string;
  is_connected: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_message: string | null;
  last_run_status: string | null;
  last_run_at: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  ctm: "CallTrackingMetrics",
  ga4: "Google Analytics 4",
  keyword_com: "Keyword.com",
  ghl: "Go High Level",
};
const SOURCE_TO_FN: Record<string, string> = {
  google_ads: "sync-google-ads",
  ctm: "sync-ctm",
  ga4: "sync-ga4",
  keyword_com: "sync-keyword-com",
  ghl: "sync-ghl",
};
const SOURCE_ORDER = ["ghl", "ctm", "google_ads", "ga4", "keyword_com"];

type Status = "healthy" | "failing" | "stale" | "not_connected" | "never_run";

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function rowStatus(r: HealthRow): Status {
  if (!r.is_connected) return "not_connected";
  if (!r.last_success_at) {
    return r.last_run_status === "failure" ? "failing" : "never_run";
  }
  if (
    r.last_run_status === "failure" &&
    (!r.last_failure_at || new Date(r.last_failure_at) > new Date(r.last_success_at))
  ) return "failing";
  const hours = (Date.now() - new Date(r.last_success_at).getTime()) / 3_600_000;
  if (hours > 24) return "stale";
  return "healthy";
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    healthy: { label: "Healthy", cls: "bg-success/10 text-success ring-success/20", Icon: CheckCircle2 },
    failing: { label: "Failing", cls: "bg-destructive/10 text-destructive ring-destructive/20", Icon: XCircle },
    stale: { label: "Stale", cls: "bg-amber-500/10 text-amber-600 ring-amber-500/20", Icon: AlertCircle },
    never_run: { label: "Never run", cls: "bg-muted text-muted-foreground ring-border", Icon: MinusCircle },
    not_connected: { label: "Not connected", cls: "bg-muted text-muted-foreground ring-border", Icon: MinusCircle },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", cls)}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

export default function AdminDataSources() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data, error } = await supabase.rpc("get_api_health_summary");
    if (error) { toast.error(error.message); setLoading(false); return; }
    setRows((data as HealthRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const grouped = useMemo(() => {
    const g = new Map<string, HealthRow[]>();
    for (const r of rows) {
      if (!g.has(r.source)) g.set(r.source, []);
      g.get(r.source)!.push(r);
    }
    for (const [, list] of g) list.sort((a, b) => a.property_name.localeCompare(b.property_name));
    return SOURCE_ORDER
      .filter((s) => g.has(s))
      .map((s) => [s, g.get(s)!] as const);
  }, [rows]);

  const runSync = async (source: string, propertyId: string): Promise<boolean> => {
    const fn = SOURCE_TO_FN[source];
    if (!fn) return false;
    const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.functions.invoke(fn, {
      body: { property_id: propertyId, date_from: from, date_to: to },
    });
    if (error) return false;
    if ((data as { error?: string })?.error) return false;
    return true;
  };

  const syncOne = async (source: string, propertyId: string, propertyName: string) => {
    const key = `${source}:${propertyId}`;
    setSyncing((s) => new Set(s).add(key));
    const ok = await runSync(source, propertyId);
    setSyncing((s) => { const n = new Set(s); n.delete(key); return n; });
    if (ok) toast.success(`${SOURCE_LABELS[source] ?? source} synced for ${propertyName}`);
    else toast.error(`Sync failed for ${propertyName}`);
    load();
  };

  const syncSource = async (source: string, srows: HealthRow[]) => {
    const targets = srows.filter((r) => r.is_connected);
    if (!targets.length) { toast.message("No connected properties for this source."); return; }
    const allKey = `__all:${source}`;
    setSyncing((s) => new Set(s).add(allKey));
    const perKeys = targets.map((r) => `${source}:${r.property_id}`);
    setSyncing((s) => { const n = new Set(s); perKeys.forEach((k) => n.add(k)); return n; });

    let ok = 0, fail = 0;
    // Run in parallel — each edge function tracks its own sync_run.
    const results = await Promise.all(targets.map((r) => runSync(source, r.property_id)));
    results.forEach((r) => (r ? ok++ : fail++));

    setSyncing((s) => {
      const n = new Set(s);
      n.delete(allKey);
      perKeys.forEach((k) => n.delete(k));
      return n;
    });
    if (fail === 0) toast.success(`${SOURCE_LABELS[source] ?? source}: ${ok} of ${targets.length} synced`);
    else if (ok === 0) toast.error(`${SOURCE_LABELS[source] ?? source}: all ${targets.length} syncs failed`);
    else toast.warning(`${SOURCE_LABELS[source] ?? source}: ${ok} succeeded, ${fail} failed`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-semibold tracking-tight">Data Sources</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Trigger a manual sync for every connected source. Use the source-level button to sync all properties at once,
          or the per-property button to refresh just one.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-xs text-muted-foreground">No data sources configured.</div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([source, srows]) => {
            const allKey = `__all:${source}`;
            const isSyncingAll = syncing.has(allKey);
            const connectedCount = srows.filter((r) => r.is_connected).length;
            return (
              <div key={source} className="rounded-lg border border-border bg-card">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{SOURCE_LABELS[source] ?? source}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {connectedCount} of {srows.length} properties connected
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => syncSource(source, srows)}
                    disabled={isSyncingAll || connectedCount === 0}
                  >
                    {isSyncingAll
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Syncing all…</>
                      : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Sync all properties</>}
                  </Button>
                </div>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">Property</th>
                      <th className="text-left font-medium px-2 py-2">Status</th>
                      <th className="text-left font-medium px-2 py-2">Last success</th>
                      <th className="text-left font-medium px-2 py-2">Last issue</th>
                      <th className="text-left font-medium px-2 py-2">Error</th>
                      <th className="px-4 py-2 w-32"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {srows.map((r) => {
                      const s = rowStatus(r);
                      const key = `${r.source}:${r.property_id}`;
                      const isSyncing = syncing.has(key);
                      return (
                        <tr key={key} className="border-t border-border/60">
                          <td className="px-4 py-2 font-medium">{r.property_name}</td>
                          <td className="px-2 py-2"><StatusPill status={s} /></td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {r.last_success_at
                              ? <span title={new Date(r.last_success_at).toLocaleString()}>{relTime(r.last_success_at)}</span>
                              : "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {r.last_failure_at
                              ? <span title={new Date(r.last_failure_at).toLocaleString()}>{relTime(r.last_failure_at)}</span>
                              : "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground max-w-[280px] truncate" title={r.last_error_message ?? ""}>
                            {r.last_error_message ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.is_connected ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => syncOne(r.source, r.property_id, r.property_name)}
                                disabled={isSyncing}
                              >
                                {isSyncing
                                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Syncing</>
                                  : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Sync</>}
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Not connected</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}