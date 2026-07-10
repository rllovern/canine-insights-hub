import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/data/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useProperties } from "@/contexts/PropertyContext";
import {
  useSaleRecords,
  useRevenueTarget,
  useRevenueForecast,
  buildRunwaySeries,
  type SaleRecord,
} from "@/lib/verified-sales";
import { resolveTargetPeriod } from "@/lib/dateRange";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { SalesHeatmap, type HeatmapMetric } from "@/components/sales/SalesHeatmap";
import { RevenueRunway } from "@/components/sales/RevenueRunway";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function toIsoDay(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  try { return format(new Date(v), "MMM d, yyyy"); } catch { return v; }
}

function toCsv(rows: SaleRecord[], propertyName: (id: string) => string, showProperty: boolean): string {
  const header = [
    ...(showProperty ? ["Property"] : []),
    "Name", "Phone", "Email", "Created", "Sold", "Amount",
  ];
  const escape = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    const cols = [
      ...(showProperty ? [propertyName(r.property_id)] : []),
      r.name ?? "",
      r.phone ?? "",
      r.email ?? "",
      r.created_at ? format(new Date(r.created_at), "yyyy-MM-dd") : "",
      r.won_at ? format(new Date(r.won_at), "yyyy-MM-dd") : "",
      r.amount == null ? "" : r.amount.toFixed(2),
    ];
    lines.push(cols.map(escape).join(","));
  }
  return lines.join("\n");
}

export default function SaleRecords() {
  const { propertyIds, label } = useScope();
  const { range, rangePreset } = useDateRange();
  const { properties } = useProperties();

  const from = toIsoDay(range.from);
  const to = toIsoDay(range.to);
  const { data, isLoading } = useSaleRecords(propertyIds, from, to);
  const rows = data ?? [];

  const propertyName = useMemo(() => {
    const map = new Map(properties.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [properties]);

  const showProperty = (propertyIds?.length ?? properties.length) !== 1;
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>("wins");

  const targetPeriod = useMemo(
    () => resolveTargetPeriod(rangePreset, range, new Date()),
    [rangePreset, range],
  );
  const allPropertyCount = properties.length;

  // Daily revenue map keyed by yyyy-MM-dd for the runway series.
  const actualByDay = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (!r.won_at) continue;
      const day = r.won_at.slice(0, 10);
      out[day] = (out[day] ?? 0) + (r.amount ?? 0);
    }
    return out;
  }, [rows]);

  // Closed revenue to date over [targetPeriodStart, asOfDate]. Same source
  // the runway "actual" series uses (invariant: latestActual === closedToDate).
  const closedRevenueToDate = useMemo(() => {
    if (!targetPeriod.asOfDate) return 0;
    const startKey = toIsoDay(targetPeriod.targetPeriodStart);
    const endKey = toIsoDay(targetPeriod.asOfDate);
    let sum = 0;
    for (const [day, v] of Object.entries(actualByDay)) {
      if (day >= startKey && day <= endKey) sum += v;
    }
    return sum;
  }, [actualByDay, targetPeriod.asOfDate, targetPeriod.targetPeriodStart]);

  const targetRes = useRevenueTarget(propertyIds, allPropertyCount, {
    targetPeriodStart: targetPeriod.targetPeriodStart,
    targetPeriodEnd: targetPeriod.targetPeriodEnd,
    targetPeriodDays: targetPeriod.targetPeriodDays,
  });
  const forecastRes = useRevenueForecast(
    propertyIds,
    allPropertyCount,
    {
      targetPeriodStart: targetPeriod.targetPeriodStart,
      targetPeriodEnd: targetPeriod.targetPeriodEnd,
      asOfDate: targetPeriod.asOfDate,
      elapsedDays: targetPeriod.elapsedDays,
      remainingDays: targetPeriod.remainingDays,
    },
    closedRevenueToDate,
  );

  const runwayData = useMemo(
    () =>
      buildRunwaySeries({
        targetPeriodStart: targetPeriod.targetPeriodStart,
        targetPeriodDays: targetPeriod.targetPeriodDays,
        elapsedDays: targetPeriod.elapsedDays,
        remainingDays: targetPeriod.remainingDays,
        actualByDay,
        target: targetRes.target,
        closedRevenueToDate,
        projectedFutureRevenue: forecastRes.projectedFutureRevenue,
        hasForecast: forecastRes.forecastMethod === "ctm_future_good_lead_pace",
      }),
    [targetPeriod, actualByDay, targetRes.target, closedRevenueToDate, forecastRes.projectedFutureRevenue, forecastRes.forecastMethod],
  );

  const download = () => {
    const csv = toCsv(rows, propertyName, showProperty);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sale-records_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sale Records"
        description={`${label} · ${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")} · ${rows.length} ${rows.length === 1 ? "sale" : "sales"}${total > 0 ? ` · ${currency.format(total)}` : ""}`}
        actions={
          <Button variant="outline" size="sm" onClick={download} disabled={rows.length === 0}>
            <Download className="mr-2 size-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <ChartCard
          title="Sales Cadence"
          subtitle={`${heatmapMetric === "wins" ? "Daily won deals" : "Daily closed revenue"} · ${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`}
        >
          {isLoading ? (
            <Skeleton className="h-[320px] w-full" />
          ) : (
            <SalesHeatmap
              from={range.from}
              to={range.to}
              rows={rows}
              metric={heatmapMetric}
              onMetricChange={setHeatmapMetric}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Revenue Runway"
          subtitle={`${format(targetPeriod.targetPeriodStart, "MMM d")} – ${format(targetPeriod.targetPeriodEnd, "MMM d, yyyy")} · Fixed target from prior 30d CTM Good Leads`}
        >
          {isLoading || targetRes.isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <RevenueRunway
              data={runwayData}
              actualTotal={closedRevenueToDate}
              target={targetRes}
              forecast={forecastRes}
              asOfDate={targetPeriod.asOfDate}
              isCustomRange={targetPeriod.isCustomRange}
              targetPeriodDays={targetPeriod.targetPeriodDays}
            />
          )}
        </ChartCard>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No sales in this date range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {showProperty && <th className="text-left font-medium px-3 py-2">Property</th>}
                  <th className="text-left font-medium px-3 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2">Phone</th>
                  <th className="text-left font-medium px-3 py-2">Email</th>
                  <th className="text-left font-medium px-3 py-2">Created</th>
                  <th className="text-left font-medium px-3 py-2">Sold</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.opportunity_id} className="hover:bg-muted/30">
                    {showProperty && <td className="px-3 py-2">{propertyName(r.property_id)}</td>}
                    <td className="px-3 py-2 font-medium">{r.name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.email ? <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a> : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.won_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.amount == null ? "—" : currency.format(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {total > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/30 font-semibold">
                    <td className="px-3 py-2" colSpan={showProperty ? 6 : 5}>Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{currency.format(total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}