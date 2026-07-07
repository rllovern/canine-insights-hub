import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, MinusCircle, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePreviewMode } from "@/contexts/PreviewModeContext";

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
  ga4: "GA4",
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
  if (!r.last_run_at) return "never_run";
  // If most-recent run is failure -> failing
  if (r.last_run_status === "failure") return "failing";
  // healthy unless last success older than 24h
  if (!r.last_success_at) return "failing";
  const hours = (Date.now() - new Date(r.last_success_at).getTime()) / 3_600_000;
  if (hours > 24) return "stale";
  return "healthy";
}

function aggregateStatus(rows: HealthRow[]): Status {
  const order: Status[] = ["failing", "stale", "never_run", "healthy", "not_connected"];
  const present = rows.map(rowStatus);
  if (!present.length) return "not_connected";
  for (const s of order) if (present.includes(s)) return s;
  return "not_connected";
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

export function ApiHealth() {
  const { isSuperAdmin } = usePreviewMode();
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<string | null>(null);

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
    return Array.from(g.entries()).sort(([a], [b]) => (SOURCE_LABELS[a] ?? a).localeCompare(SOURCE_LABELS[b] ?? b));
  }, [rows]);

  const syncOne = async (source: string, propertyId: string) => {
    const fn = SOURCE_TO_FN[source];
    if (!fn) return;
    setSyncing(`${source}:${propertyId}`);
    const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.functions.invoke(fn, {
      body: { property_id: propertyId, date_from: from, date_to: to },
    });
    setSyncing(null);
    if (error) { toast.error(error.message); return; }
    if ((data as { error?: string })?.error) { toast.error((data as { error: string }).error); return; }
    toast.success("Sync completed");
    load();
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-3">
      {grouped.map(([source, srows]) => {
        const connected = srows.filter((r) => r.is_connected);
        const status = aggregateStatus(srows);
        const lastSuccess = srows
          .map((r) => r.last_success_at)
          .filter(Boolean)
          .sort()
          .pop() as string | undefined;
        const lastFailure = srows
          .map((r) => r.last_failure_at)
          .filter(Boolean)
          .sort()
          .pop() as string | undefined;
        const isOpen = expanded[source] ?? false;
        return (
          <div key={source} className="rounded-lg border border-border bg-card">
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              onClick={() => setExpanded((e) => ({ ...e, [source]: !isOpen }))}
            >
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
              <div className="flex-1">
                <div className="text-sm font-semibold">{SOURCE_LABELS[source] ?? source}</div>
                <div className="text-[11px] text-muted-foreground">
                  {connected.length} of {srows.length} properties connected
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-0.5 mr-3">
                <div className="text-[11px] text-muted-foreground">Last success: <span className="text-foreground">{relTime(lastSuccess ?? null)}</span></div>
                <div className="text-[11px] text-muted-foreground">Last issue: <span className="text-foreground">{relTime(lastFailure ?? null)}</span></div>
              </div>
              <StatusPill status={status} />
            </button>
            {isOpen && (
              <div className="border-t border-border">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">Property</th>
                      <th className="text-left font-medium px-2 py-2">Status</th>
                      <th className="text-left font-medium px-2 py-2">Last success</th>
                      <th className="text-left font-medium px-2 py-2">Last issue</th>
                      <th className="text-left font-medium px-2 py-2">Error</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {srows.map((r) => {
                      const s = rowStatus(r);
                      const key = `${r.source}:${r.property_id}`;
                      return (
                        <tr key={key} className="border-t border-border/60">
                          <td className="px-4 py-2 font-medium">{r.property_name}</td>
                          <td className="px-2 py-2"><StatusPill status={s} /></td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {r.last_success_at ? (
                              <span title={new Date(r.last_success_at).toLocaleString()}>{relTime(r.last_success_at)}</span>
                            ) : "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {r.last_failure_at ? (
                              <span title={new Date(r.last_failure_at).toLocaleString()}>{relTime(r.last_failure_at)}</span>
                            ) : "—"}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground max-w-[280px] truncate" title={r.last_error_message ?? ""}>
                            {r.last_error_message ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.is_connected && isSuperAdmin && (
                              <Button size="sm" variant="outline" onClick={() => syncOne(r.source, r.property_id)} disabled={syncing === key}>
                                {syncing === key
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <RefreshCw className="h-3.5 w-3.5" />}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}