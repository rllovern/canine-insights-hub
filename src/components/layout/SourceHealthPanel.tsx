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

type Status = "healthy" | "failing" | "stale" | "never_run" | "not_connected";

function rowStatus(r: HealthRow): Status {
  if (!r.is_connected) return "not_connected";
  if (!r.last_run_at) return "never_run";
  if (r.last_run_status === "failure") return "failing";
  if (!r.last_success_at) return "failing";
  const hours = (Date.now() - new Date(r.last_success_at).getTime()) / 3_600_000;
  if (hours > 24) return "stale";
  return "healthy";
}

function aggregate(rows: HealthRow[]): Status {
  const order: Status[] = ["failing", "stale", "never_run", "healthy", "not_connected"];
  const present = rows.map(rowStatus);
  if (!present.length) return "not_connected";
  for (const s of order) if (present.includes(s)) return s;
  return "not_connected";
}

const STATUS_STYLE: Record<Status, { label: string; dot: string; text: string }> = {
  healthy:       { label: "Live",    dot: "bg-success",            text: "text-success" },
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
  const matchTip =
    ctm === "healthy" && ghl === "healthy"
      ? "CTM and GHL both healthy"
      : `Reconciliation blocked${ctm !== "healthy" ? " · CTM " + STATUS_STYLE[ctm].label.toLowerCase() : ""}${ghl !== "healthy" ? " · GHL " + STATUS_STYLE[ghl].label.toLowerCase() : ""}`;

  if (loaded && scoped.length === 0) return null;

  const items: { label: string; status: Status; title?: string }[] = [
    { label: "Google Ads", status: gAds },
    { label: "CallTrackingMetrics", status: ctm },
    { label: "GoHighLevel", status: ghl },
    { label: "CTM / GHL match", status: match, title: matchTip },
  ];

  return (
    <div className="space-y-0.5">
      <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
        Data Sources
      </div>
      {items.map((it) => {
        const s = STATUS_STYLE[it.status];
        return (
          <div
            key={it.label}
            title={it.title}
            className="flex items-center gap-2 px-3 py-1 text-[13px]"
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
            <span className="truncate flex-1 text-white/80">{it.label}</span>
            <span className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", s.text)}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}