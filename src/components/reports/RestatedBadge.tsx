import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { History } from "lucide-react";
import { useDashboard } from "@/contexts/DashboardContext";
import { rangeToISO } from "@/lib/metrics";

type Restatement = {
  id: string;
  metric: string;
  period_start: string;
  period_end: string;
  prior_value: number;
  new_value: number;
  delta: number;
  cause: string;
  cause_detail: string | null;
  created_at: string;
};

const CAUSE_LABEL: Record<string, string> = {
  ghl_deleted: "Removed in the CRM",
  ghl_recreated_surviving_won: "Duplicate record merged in the CRM",
  ghl_recreated_surviving_not_won: "Record merged in the CRM and is no longer marked Won",
  manual: "Manual correction",
};

const METRIC_LABEL: Record<string, string> = {
  wins: "Deals marked Won",
  won_revenue: "Revenue from deals marked Won",
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/**
 * Client-facing restatement disclosure. When a previously reported figure moves
 * because the CRM changed underneath it, the person reading the report is the
 * one who needs to see the delta and the date it changed — so this renders on
 * /report/:token, not only on internal surfaces.
 */
export function RestatedBadge({
  token,
  propertyIds,
  from,
  to,
}: {
  token?: string;
  propertyIds?: string[];
  from?: string;
  to?: string;
}) {
  const dash = useDashboard();
  const iso = dash?.range ? rangeToISO(dash.range) : null;
  const rangeFrom = from ?? iso?.from;
  const rangeTo = to ?? iso?.to;
  const [rows, setRows] = useState<Restatement[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!rangeFrom || !rangeTo) return;
    let cancelled = false;
    const q = token
      ? supabase.rpc("get_restatements_by_report_token", { _token: token, _from: rangeFrom, _to: rangeTo })
      : supabase.rpc("get_restatements", {
          _property_ids: propertyIds && propertyIds.length ? propertyIds : null,
          _from: rangeFrom,
          _to: rangeTo,
        });
    q.then(({ data }) => {
      if (!cancelled) setRows((data ?? []) as unknown as Restatement[]);
    });
    return () => {
      cancelled = true;
    };
  }, [token, propertyIds?.join(","), rangeFrom, rangeTo]);

  if (!rows || rows.length === 0) return null;

  const latest = rows.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-amber-600 dark:text-amber-400"
      >
        <History className="h-4 w-4 shrink-0" />
        <span>
          Restated — {rows.length} figure{rows.length === 1 ? "" : "s"} in this period changed after
          they were first reported. Last updated {fmtDate(latest.created_at)}.
        </span>
        <span className="ml-auto text-xs underline">{open ? "Hide" : "Details"}</span>
      </button>

      {open && (
        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
          {rows.map((r) => {
            const isMoney = r.metric === "won_revenue";
            const fmt = (n: number) => (isMoney ? money(n) : String(n));
            return (
              <li key={r.id} className="rounded-md bg-background/60 px-3 py-2">
                <div className="font-medium text-foreground">
                  {METRIC_LABEL[r.metric] ?? r.metric} · {monthLabel(r.period_start)}
                </div>
                <div>
                  {fmt(r.prior_value)} → {fmt(r.new_value)}{" "}
                  <span className={r.delta < 0 ? "text-destructive" : "text-emerald-600"}>
                    ({r.delta > 0 ? "+" : ""}
                    {fmt(r.delta)})
                  </span>{" "}
                  · changed {fmtDate(r.created_at)}
                </div>
                <div className="mt-1">
                  {CAUSE_LABEL[r.cause] ?? r.cause}
                  {r.cause_detail ? ` — ${r.cause_detail}` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}