// NOTE: This page intentionally locks to a light palette to match the
// approved PerformX Executive Overview spec. Dark-mode parity is a follow-up.
import { format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCurrency, fmtNumber } from "@/lib/metrics";
import { useCommandData, type CommandMode } from "@/components/command/useCommandData";
import { KpiSparkCard } from "@/components/command/KpiSparkCard";
import { TIPS } from "@/components/command/tooltips";
import { JourneyFunnel } from "@/components/command/JourneyFunnel";
import { PortfolioVerdict } from "@/components/command/PortfolioVerdict";
import { cn } from "@/lib/utils";
import Dashboard from "@/pages/Dashboard";
import CallTracking from "@/pages/CallTracking";

export default function Command() {
  const { propertyIds, label } = useScope();
  const { range, compareRange, compareMode } = useDateRange();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: CommandMode = searchParams.get("mode") === "ads" ? "ads" : "business";
  const setMode = (m: CommandMode) => {
    const next = new URLSearchParams(searchParams);
    if (m === "ads") next.set("mode", "ads"); else next.delete("mode");
    setSearchParams(next, { replace: true });
  };
  const isAds = mode === "ads";

  const data = useCommandData(propertyIds, range, compareMode !== "off" ? compareRange : null);

  const cmpLabel = `vs ${format(new Date(data.compareRangeIso.from), "MMM d")} – ${format(new Date(data.compareRangeIso.to), "MMM d")}`;

  // Active slice for the KPI tiles + funnel (Business = blended, Ads = PPC-only).
  const active = isAds ? data.adsCurrent : data.current;
  const activePrior = isAds ? data.adsPrior : data.prior;
  const activeDaily = isAds ? data.adsCurrentDaily : data.currentDaily;
  const loading = isAds ? data.adsLoading : data.isLoading;

  const series = (key: "cost" | "calls" | "good_leads" | "projected_sale" | "verified_sale") =>
    activeDaily.map((d) => ({ date: d.date, v: d[key] }));

  return (
      <div className="-m-4 md:-m-6 p-3 lg:p-4 bg-[hsl(220_20%_97%)] min-h-[calc(100vh-3rem)] text-slate-900">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold tracking-tight text-slate-900 leading-tight">Executive Overview</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Real-time performance across the customer journey · {label}
            {isAds && <span className="ml-1 text-amber-700">· Ads view (Google PPC only)</span>}
          </p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] shadow-sm shrink-0">
          <button
            type="button"
            onClick={() => setMode("business")}
            className={cn("px-2.5 py-1 rounded-md font-semibold transition-colors", !isAds ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900")}
          >
            Business
          </button>
          <button
            type="button"
            onClick={() => setMode("ads")}
            className={cn("px-2.5 py-1 rounded-md font-semibold transition-colors", isAds ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900")}
          >
            Ads
          </button>
        </div>
      </div>

      {/* 5 KPI cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
          <KpiSparkCard
            label={isAds ? "Ad Spend (Google PPC)" : "Ad Spend"}
            value={fmtCurrency(active.spend)}
            current={active.spend} prior={activePrior.spend}
            series={series("cost")}
            compareLabel={cmpLabel}
            tip={isAds ? TIPS.adSpend : TIPS.spend}
            invertDelta
            formatValue={fmtCurrency}
            sourceTable={isAds ? "daily_metrics.cost where ad_source = 'Google PPC' AND campaign labeled for this location" : "daily_metrics.cost"}
          />
          <KpiSparkCard
            label={isAds ? "PPC Records" : "Records"}
            value={fmtNumber(active.calls)}
            current={active.calls} prior={activePrior.calls}
            series={series("calls")}
            compareLabel={cmpLabel}
            tip={TIPS.calls}
            formatValue={fmtNumber}
            sourceTable={isAds ? "daily_metrics.record_count where ad_source = 'Google PPC'" : "v_lead_counts_daily.records (calls + forms)"}
          />
          <KpiSparkCard
            label={isAds ? "PPC Qualified" : "Qualified Calls"}
            value={fmtNumber(active.qualifiedCalls)}
            current={active.qualifiedCalls} prior={activePrior.qualifiedCalls}
            series={series("good_leads")}
            compareLabel={cmpLabel}
            tip={TIPS.qualifiedCalls}
            formatValue={fmtNumber}
            sourceTable={isAds ? "daily_metrics.good_leads where ad_source = 'Google PPC'" : "daily_metrics.good_leads"}
          />
          <KpiSparkCard
            label={isAds ? "PPC AI-Projected" : "AI-Projected Sale (count)"}
            value={fmtNumber(active.appointments)}
            current={active.appointments} prior={activePrior.appointments}
            series={series("projected_sale")}
            compareLabel={cmpLabel}
            tip={TIPS.appointments}
            formatValue={fmtNumber}
            sourceTable={isAds ? "daily_metrics.projected_sale where ad_source = 'Google PPC'" : "daily_metrics.projected_sale"}
          />
        </div>
      )}

      {/* Funnel + Portfolio Verdict */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-2 lg:min-h-[260px]">
        <div className="lg:col-span-2">
          {loading ? <Skeleton className="h-full min-h-[240px] rounded-2xl" /> : (
            <JourneyFunnel
              t={active}
              prior={activePrior}
              targets={data.targets}
              mode={mode}
              blendedTotalLeads={data.current.totalLeads}
              benchmarkLabel={label}
            />
          )}
        </div>
        <div>
          <PortfolioVerdict totals={active} targets={data.targets} viewMode={mode} />
        </div>
      </div>

      {/* Performance Report — PPC overview + call tracking, stacked below the hero. */}
      <div className="mt-4 bg-white rounded-2xl border border-slate-200 p-4 space-y-6">
        <Dashboard />
        <CallTracking />
      </div>
    </div>
  );
}