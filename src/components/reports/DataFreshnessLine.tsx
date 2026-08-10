import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

type Row = {
  source: string;
  last_success_at: string | null;
  consecutive_failures: number | null;
  status: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  ctm: "Call tracking",
  ghl: "CRM",
  ga4: "Analytics",
  keyword_com: "Rankings",
};

function relative(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Client-facing data freshness disclosure. If a source has not synced
 * recently, the client sees it here rather than having to ask.
 */
export function DataFreshnessLine({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("report_data_freshness", { _token: token })
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as Row[]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!rows || rows.length === 0) return null;

  const oldest = rows.reduce<Row | null>((acc, r) => {
    if (!acc) return r;
    const a = acc.last_success_at ? new Date(acc.last_success_at).getTime() : 0;
    const b = r.last_success_at ? new Date(r.last_success_at).getTime() : 0;
    return b < a ? r : acc;
  }, null);

  const staleHours = oldest?.last_success_at
    ? (Date.now() - new Date(oldest.last_success_at).getTime()) / 3_600_000
    : Infinity;
  const degraded = rows.some((r) => (r.consecutive_failures ?? 0) >= 3) || staleHours > 12;

  const newest = rows.reduce<string | null>((acc, r) => {
    if (!r.last_success_at) return acc;
    if (!acc || new Date(r.last_success_at) > new Date(acc)) return r.last_success_at;
    return acc;
  }, null);

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${
        degraded
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground"
      }`}
    >
      {degraded ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span>
        Data last updated {relative(newest)}.
      </span>
      {degraded && oldest && (
        <span>
          {SOURCE_LABEL[oldest.source] ?? oldest.source} last synced {relative(oldest.last_success_at)}
          {(oldest.consecutive_failures ?? 0) > 0
            ? ` after ${oldest.consecutive_failures} failed attempt${oldest.consecutive_failures === 1 ? "" : "s"}`
            : ""}
          . Some figures may be out of date.
        </span>
      )}
    </div>
  );
}
