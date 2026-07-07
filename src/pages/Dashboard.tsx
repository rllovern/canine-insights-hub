import { useMemo } from "react";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { DualAxisChart } from "@/components/dashboard/DualAxisChart";
import { MultiLineChart, SingleLineChart } from "@/components/dashboard/MultiLineChart";
import { useDashboard } from "@/contexts/DashboardContext";
import { useScope } from "@/contexts/ScopeContext";
import { useProperties } from "@/contexts/PropertyContext";
import { fmtCurrency, fmtNumber, fmtPct, groupByDate, pctChange, sumMetrics, fillDateRange } from "@/lib/metrics";
import { calc } from "@/lib/data-sources";
import { Skeleton } from "@/components/ui/skeleton";
import { usePropertyMetricConfig, type MetricKey } from "@/lib/property-labels";
import { rowTotalLeads } from "@/lib/leadModel";
import { useVerifiedSalesTotal } from "@/lib/verified-sales";

// Cost / Good Lead by-source chart always renders these 4 series so missing
// connectors (Facebook / Direct / Organic) appear as flat $0 lines instead of
// disappearing from the legend.
const REQUIRED_SOURCES = ["Facebook", "Direct", "Google PPC", "Organic"] as const;

export default function Dashboard({ hideAdsOverview = false }: { hideAdsOverview?: boolean } = {}) {
  const { activeProperty: scopeProperty, mode } = useScope();
  const { properties } = useProperties();
  // PPC Overview is single-property today; in agency mode fall back to first.
  const activeProperty = scopeProperty ?? (mode === "agency" ? (properties[0] ?? null) : null);
  const { current, prior, isLoading, range, compareMode, compareRange } = useDashboard();
  const cfg = usePropertyMetricConfig();

  const totals = useMemo(() => sumMetrics(current), [current]);
  const prev = useMemo(() => sumMetrics(prior), [prior]);
  const showCompare = compareMode !== "off";

  // Verified Sale is sourced from Google Sheets (sheet_sales), not
  // daily_metrics.verified_sale. Only Call Tracking still reads the
  // daily_metrics column.
  const sheetIds = activeProperty ? [activeProperty.id] : null;
  const isoFrom = range.from.toISOString().slice(0, 10);
  const isoTo = range.to.toISOString().slice(0, 10);
  const cmpFrom = compareRange.from.toISOString().slice(0, 10);
  const cmpTo = compareRange.to.toISOString().slice(0, 10);
  const vsCur = useVerifiedSalesTotal(sheetIds, isoFrom, isoTo, !!activeProperty);
  const vsPrev = useVerifiedSalesTotal(sheetIds, cmpFrom, cmpTo, !!activeProperty && showCompare);
  const totalsWithSheet = useMemo(
    () => ({ ...totals, verified_sale: vsCur.data ?? 0 }),
    [totals, vsCur.data],
  );
  const prevWithSheet = useMemo(
    () => ({ ...prev, verified_sale: vsPrev.data ?? 0 }),
    [prev, vsPrev.data],
  );
  const series = useMemo(() => {
    const zeros = {
      cost: 0, impressions: 0, clicks: 0, record_count: 0, no_entry: 0,
      leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, spam: 0,
      projected_sale: 0, verified_sale: 0, sessions: 0, users: 0, cpm: 0, ctr: 0, cost_per_good_lead: 0,
    } as any;
    const buildDaily = (rows: typeof current) =>
      groupByDate(rows).map((r) => ({
        ...r,
        cpm: calc.cpm(r.cost, r.impressions),
        ctr: calc.ctr(r.clicks, r.impressions),
        cost_per_good_lead: calc.costPerGoodLead(r.cost, r.good_leads),
      }));
    const cur = fillDateRange(buildDaily(current), range.from, range.to, zeros);
    if (!showCompare) return cur;
    const pri = fillDateRange(buildDaily(prior), compareRange.from, compareRange.to, zeros);
    return cur.map((row, i) => {
      const p: any = pri[i] ?? {};
      return {
        ...row,
        cost_prev: p.cost ?? 0,
        impressions_prev: p.impressions ?? 0,
        clicks_prev: p.clicks ?? 0,
        record_count_prev: p.record_count ?? 0,
        cpm_prev: p.cpm ?? 0,
        ctr_prev: p.ctr ?? 0,
        cost_per_good_lead_prev: p.cost_per_good_lead ?? 0,
      };
    });
  }, [current, prior, range, compareRange, showCompare]);

  const sourceSeries = useMemo(() => {
    const buildSourceDaily = (rows: typeof current) => {
      const byDateSource = new Map<string, Record<string, { cost: number; gl: number }>>();
      for (const r of rows as any[]) {
        const src = (REQUIRED_SOURCES as readonly string[]).includes(r.ad_source) ? r.ad_source : null;
        if (!src) continue;
        const bucket = byDateSource.get(r.date) ?? {};
        const cur = bucket[src] ?? { cost: 0, gl: 0 };
        cur.cost += Number(r.cost ?? 0);
        cur.gl += Number(r.good_leads ?? 0);
        bucket[src] = cur;
        byDateSource.set(r.date, bucket);
      }
      return Array.from(byDateSource.entries()).map(([date, bucket]) => {
        const row: any = { date };
        for (const s of REQUIRED_SOURCES) {
          const b = bucket[s] ?? { cost: 0, gl: 0 };
          row[s] = b.gl ? b.cost / b.gl : 0;
        }
        return row;
      });
    };
    const zeros = REQUIRED_SOURCES.reduce((a, s) => ({ ...a, [s]: 0 }), {} as Record<string, number>);
    const cur = fillDateRange(buildSourceDaily(current), range.from, range.to, zeros as any);
    if (!showCompare) return cur;
    const pri = fillDateRange(buildSourceDaily(prior), compareRange.from, compareRange.to, zeros as any);
    return cur.map((row: any, i: number) => {
      const p: any = pri[i] ?? {};
      const out: any = { ...row };
      for (const s of REQUIRED_SOURCES) out[`${s}_prev`] = p[s] ?? 0;
      return out;
    });
  }, [current, prior, range, compareRange, showCompare]);

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

  if (hideAdsOverview) return null;
  return (
    <>
      <SectionDivider
        title="Ads Overview"
        subtitle="Paid search performance across cost, traffic, and conversions"
      />
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
              leftPrevKey="cost_prev" rightPrevKey="cpm_prev" showCompare={showCompare}
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
              leftPrevKey="clicks_prev" rightPrevKey="ctr_prev" showCompare={showCompare}
            />
          </ChartCard>
        </div>

        <div className="space-y-3">
          <ActionsHeader cfg={cfg} />
          <ActionsKpis totals={totalsWithSheet} prev={prevWithSheet} cfg={cfg} />
          <ChartCard title="Impressions vs Calls" subtitle="Daily trend">
            <DualAxisChart
              data={series}
              leftKey="impressions" leftLabel="Impressions" leftColor="hsl(var(--chart-2))" leftFmt={(v) => fmtNumber(v)}
              rightKey="record_count" rightLabel="Calls" rightColor="hsl(var(--chart-1))" rightFmt={(v) => fmtNumber(v)}
              leftPrevKey="impressions_prev" rightPrevKey="record_count_prev" showCompare={showCompare}
            />
          </ChartCard>
        </div>
      </div>

    </>
  );
}

function ActionsHeader({ cfg }: { cfg: ReturnType<typeof usePropertyMetricConfig> }) {
  const order: MetricKey[] = ["leads", "good_leads", "verified_sale"];
  const visibleLabels = order.filter((k) => !cfg.isHidden(k)).map((k) => cfg.label(k));
  return <Header title="Actions" subtitle={`By ${visibleLabels.join(", ")}`} />;
}

function ActionsKpis({ totals, prev, cfg }: { totals: any; prev: any; cfg: ReturnType<typeof usePropertyMetricConfig> }) {
  const order: MetricKey[] = ["leads", "good_leads", "verified_sale"];
  const visible = order.filter((k) => !cfg.isHidden(k));
  const gridCls =
    visible.length >= 3 ? "grid grid-cols-1 sm:grid-cols-3 gap-2" :
    visible.length === 2 ? "grid grid-cols-1 sm:grid-cols-2 gap-2" :
    "grid grid-cols-1 gap-2";
  // Canonical Lead Model: "leads" displays as Total Leads = bad + good + AI-projected.
  // Never read the legacy `leads` column for the total — always derive via leadModel.
  const valueFor = (k: MetricKey, src: any) =>
    k === "leads" ? rowTotalLeads(src) : Number((src as any)[k] ?? 0);
  return (
    <div className={gridCls}>
      {visible.map((k) => (
        <KpiCard
          key={k}
          label={cfg.label(k)}
          value={fmtNumber(valueFor(k, totals))}
          delta={pctChange(valueFor(k, totals), valueFor(k, prev))}
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
