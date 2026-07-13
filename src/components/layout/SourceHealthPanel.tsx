import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useScope } from "@/contexts/ScopeContext";
import { cn } from "@/lib/utils";

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

type Status = "healthy" | "failing" | "retrying" | "stale" | "never_run" | "not_connected";

function rowStatus(r: HealthRow): Status {
  if (!r.is_connected) return "not_connected";
  if (!r.last_success_at) return "failing";
  if (r.last_run_status === "failure" && (!r.last_failure_at || new Date(r.last_failure_at) > new Date(r.last_success_at))) {
    // Within the auto-recovery window (~15m) show "Retrying" instead of a hard fail.
    const failedMinsAgo = r.last_failure_at
      ? (Date.now() - new Date(r.last_failure_at).getTime()) / 60_000
      : Infinity;
    return failedMinsAgo <= 15 ? "retrying" : "failing";
  }
  if (!r.last_run_at) return "never_run";
  const hours = (Date.now() - new Date(r.last_success_at).getTime()) / 3_600_000;
  if (hours > 24) return "stale";
  return "healthy";
}

function aggregate(rows: HealthRow[]): Status {
  const connected = rows.filter((r) => r.is_connected);
  const present = (connected.length ? connected : rows).map(rowStatus);
  const order: Status[] = ["failing", "retrying", "stale", "healthy", "never_run", "not_connected"];
  if (!present.length) return "not_connected";
  for (const s of order) if (present.includes(s)) return s;
  return "not_connected";
}

const STATUS_STYLE: Record<Status, { label: string; dot: string; text: string }> = {
  healthy:       { label: "Live",    dot: "bg-success",            text: "text-success" },
  retrying:      { label: "Retrying", dot: "bg-amber-500 animate-pulse", text: "text-amber-600" },
  stale:         { label: "Stale",   dot: "bg-amber-500",          text: "text-amber-600" },
  failing:       { label: "Blocked", dot: "bg-destructive",        text: "text-destructive" },
  never_run:     { label: "Off",     dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
  not_connected: { label: "Off",     dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

export function SourceHealthPanel() {
  const { propertyIds } = useScope();
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.rpc("get_api_health_summary");
      if (cancelled) return;
      if (error) { setRows([]); setLoaded(true); return; }
      setRows((data as HealthRow[]) ?? []);
      setLoaded(true);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const scoped = useMemo(() => {
    if (!propertyIds) return rows;
    const set = new Set(propertyIds);
    return rows.filter((r) => set.has(r.property_id));
  }, [rows, propertyIds]);

  const bySource = useMemo(() => {
    const m = new Map<string, HealthRow[]>();
    for (const r of scoped) {
      if (!m.has(r.source)) m.set(r.source, []);
      m.get(r.source)!.push(r);
    }
    return m;
  }, [scoped]);

  const gAds = aggregate(bySource.get("google_ads") ?? []);
  const ctm = aggregate(bySource.get("ctm") ?? []);
  const ghl = aggregate(bySource.get("ghl") ?? []);
  const match: Status = ctm === "healthy" && ghl === "healthy" ? "healthy" : "failing";
  const retryingItems = [
    gAds === "retrying" && "Google Ads",
    ctm === "retrying" && "CTM",
    ghl === "retrying" && "GHL",
  ].filter(Boolean);
  const matchTip =
    ctm === "healthy" && ghl === "healthy"
      ? "CTM and GHL both healthy"
      : `Reconciliation blocked${ctm !== "healthy" ? " · CTM " + STATUS_STYLE[ctm].label.toLowerCase() : ""}${ghl !== "healthy" ? " · GHL " + STATUS_STYLE[ghl].label.toLowerCase() : ""}`;

  if (loaded && scoped.length === 0) return null;

  const items: { label: string; status: Status; title?: string }[] = [
    { label: "Google Ads", status: gAds, title: gAds === "retrying" ? "Auto-retry in progress" : undefined },
    { label: "CallTrackingMetrics", status: ctm, title: ctm === "retrying" ? "Auto-retry in progress" : undefined },
    { label: "GoHighLevel", status: ghl, title: ghl === "retrying" ? "Auto-retry in progress" : undefined },
    { label: "CTM / GHL match", status: match, title: matchTip },
  ];

  return (
    <div className="space-y-0.5">
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
        Data Sources
      </div>
      {items.map((it) => {
        const s = STATUS_STYLE[it.status];
        return (
          <div
            key={it.label}
            title={it.title}
            className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
            <span className="truncate flex-1 text-white/80">{it.label}</span>
            <span className={cn("text-[11px] font-semibold tracking-[0.14em]", s.text)}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}