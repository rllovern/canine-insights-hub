import { useMemo } from "react";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { DualAxisChart } from "@/components/dashboard/DualAxisChart";
import { useDashboard } from "@/contexts/DashboardContext";
import { useProperties } from "@/contexts/PropertyContext";
import { fmtCurrency, fmtNumber, fmtPct, groupByDate, pctChange, sumMetrics } from "@/lib/metrics";
import { calc } from "@/lib/data-sources";
import { Skeleton } from "@/components/ui/skeleton";
import { usePropertyMetricConfig, type MetricKey } from "@/lib/property-labels";

export default function Dashboard() {
  const { activeProperty } = useProperties();
  const { current, prior, isLoading } = useDashboard();
  const cfg = usePropertyMetricConfig();

  const totals = useMemo(() => sumMetrics(current), [current]);
  const prev = useMemo(() => sumMetrics(prior), [prior]);
  const series = useMemo(
    () => groupByDate(current).map((r) => ({
      ...r,
      cpm: calc.cpm(r.cost, r.impressions),
      ctr: calc.ctr(r.clicks, r.impressions),
    })),
    [current]
  );

  if (!activeProperty) {
    return <div className="text-sm text-muted-foreground">Select a client to view performance.</div>;
  }
  if (isLoading) return <LoadingGrid />;

  const cpm = calc.cpm(totals.cost, totals.impressions);
  const cpmPrev = calc.cpm(prev.cost, prev.impressions);
  const ctr = calc.ctr(totals.clicks, totals.impressions);
  const ctrPrev = calc.ctr(prev.clicks, prev.impressions);
  const cpc = calc.cpc(totals.cost, totals.clicks);
  const cpcPrev = calc.cpc(prev.cost, prev.clicks);

  return (
    <>
      <SectionDivider title="Ads Overview" subtitle="Paid search performance across cost, traffic, and conversions" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-3">
          <Header title="Cost & Impressions" subtitle="By Cost, CPM, and Impressions" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <KpiCard label="Cost" value={fmtCurrency(totals.cost)} delta={pctChange(totals.cost, prev.cost)} invertDelta />
            <KpiCard label="Avg. CPM" value={fmtCurrency(cpm, 2)} delta={pctChange(cpm, cpmPrev)} invertDelta />
            <KpiCard label="Impressions" value={fmtNumber(totals.impressions)} delta={pctChange(totals.impressions, prev.impressions)} />
          </div>
          <ChartCard title="Cost vs CPM" subtitle="Daily trend">
            <DualAxisChart
              data={series}
              leftKey="cost" leftLabel="Cost" leftColor="hsl(var(--chart-2))" leftFmt={(v) => fmtCurrency(v)}
              rightKey="cpm" rightLabel="CPM" rightColor="hsl(var(--chart-1))" rightFmt={(v) => fmtCurrency(v, 2)}
            />
          </ChartCard>
        </div>

        <div className="space-y-3">
          <Header title="Clicks" subtitle="By Clicks, CTR, and Avg. CPC" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <KpiCard label="Clicks" value={fmtNumber(totals.clicks)} delta={pctChange(totals.clicks, prev.clicks)} />
            <KpiCard label="CTR" value={fmtPct(ctr)} delta={pctChange(ctr, ctrPrev)} />
            <KpiCard label="Avg. CPC" value={fmtCurrency(cpc, 2)} delta={pctChange(cpc, cpcPrev)} invertDelta />
          </div>
          <ChartCard title="Clicks vs CTR" subtitle="Daily trend">
            <DualAxisChart
              data={series}
              leftKey="clicks" leftLabel="Clicks" leftColor="hsl(var(--chart-2))" leftFmt={(v) => fmtNumber(v)}
              rightKey="ctr" rightLabel="CTR %" rightColor="hsl(var(--chart-1))" rightFmt={(v) => `${v.toFixed(1)}%`}
            />
          </ChartCard>
        </div>

        <div className="space-y-3">
          <ActionsHeader cfg={cfg} />
          <ActionsKpis totals={totals} prev={prev} cfg={cfg} />
          <ChartCard title="Impressions vs Calls" subtitle="Daily trend">
            <DualAxisChart
              data={series}
              leftKey="impressions" leftLabel="Impressions" leftColor="hsl(var(--chart-2))" leftFmt={(v) => fmtNumber(v)}
              rightKey="record_count" rightLabel="Calls" rightColor="hsl(var(--chart-1))" rightFmt={(v) => fmtNumber(v)}
            />
          </ChartCard>
        </div>
      </div>
    </>
  );
}

function ActionsHeader({ cfg }: { cfg: ReturnType<typeof usePropertyMetricConfig> }) {
  const order: MetricKey[] = ["leads", "good_leads", "admissions"];
  const visibleLabels = order.filter((k) => !cfg.isHidden(k)).map((k) => cfg.label(k));
  return <Header title="Actions" subtitle={`By ${visibleLabels.join(", ")}`} />;
}

function ActionsKpis({ totals, prev, cfg }: { totals: any; prev: any; cfg: ReturnType<typeof usePropertyMetricConfig> }) {
  const order: MetricKey[] = ["leads", "good_leads", "admissions"];
  const visible = order.filter((k) => !cfg.isHidden(k));
  const gridCls =
    visible.length >= 3 ? "grid grid-cols-1 sm:grid-cols-3 gap-2" :
    visible.length === 2 ? "grid grid-cols-1 sm:grid-cols-2 gap-2" :
    "grid grid-cols-1 gap-2";
  return (
    <div className={gridCls}>
      {visible.map((k) => (
        <KpiCard
          key={k}
          label={cfg.label(k)}
          value={fmtNumber((totals as any)[k] ?? 0)}
          delta={pctChange((totals as any)[k] ?? 0, (prev as any)[k] ?? 0)}
        />
      ))}
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-1">
      <div className="text-sm font-bold tracking-tight">{title}</div>
      <div className="text-[11px] text-muted-foreground">{subtitle}</div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((__, j) => <Skeleton key={j} className="h-20" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      ))}
    </div>
  );
}
