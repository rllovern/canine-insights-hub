// NOTE: This page intentionally locks to a light palette to match the
// approved PerformX Executive Overview spec. Dark-mode parity is a follow-up.
import { format } from "date-fns";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCurrency, fmtNumber } from "@/lib/metrics";
import { useCommandData } from "@/components/command/useCommandData";
import { KpiSparkCard } from "@/components/command/KpiSparkCard";
import { TIPS } from "@/components/command/tooltips";
import { JourneyFunnel } from "@/components/command/JourneyFunnel";
import { RevenueCaptureScore } from "@/components/command/RevenueCaptureScore";
import {
  CallHandlingCard,
  MissedCallFollowUpCard,
  CallQualityCard,
} from "@/components/command/PerformanceCards";
import { TopOpportunities } from "@/components/command/TopOpportunities";
import { useSpeed } from "@/components/lead-perf/hooks";

export default function Command() {
  const { propertyIds, label } = useScope();
  const { range, compareRange, compareMode } = useDateRange();

  const data = useCommandData(propertyIds, range, compareMode !== "off" ? compareRange : null);
  const speed = useSpeed({ propertyIds, from: range.from, to: range.to });

  const cmpLabel = `vs ${format(new Date(data.compareRangeIso.from), "MMM d")} – ${format(new Date(data.compareRangeIso.to), "MMM d")}`;

  const series = (key: "cost" | "calls" | "good_leads" | "projected_sale" | "verified_sale") =>
    data.currentDaily.map((d) => ({ date: d.date, v: d[key] }));

  return (
    <div className="-m-4 md:-m-6 p-4 lg:p-5 bg-[hsl(220_20%_97%)] min-h-[calc(100vh-3rem)] text-slate-900">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold tracking-tight text-slate-900 leading-tight">Executive Overview</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Real-time performance across the customer journey · {label}</p>
        </div>
      </div>

      {/* 5 KPI cards */}
      {data.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-2">
          <KpiSparkCard
            label="Ad Spend"
            value={fmtCurrency(data.current.spend)}
            current={data.current.spend} prior={data.prior.spend}
            series={series("cost")}
            compareLabel={cmpLabel}
            tip={TIPS.spend}
            invertDelta
          />
          <KpiSparkCard
            label="Calls Received"
            value={fmtNumber(data.current.calls)}
            current={data.current.calls} prior={data.prior.calls}
            series={series("calls")}
            compareLabel={cmpLabel}
            tip={TIPS.calls}
          />
          <KpiSparkCard
            label="Qualified Calls"
            value={fmtNumber(data.current.qualifiedCalls)}
            current={data.current.qualifiedCalls} prior={data.prior.qualifiedCalls}
            series={series("good_leads")}
            compareLabel={cmpLabel}
            tip={TIPS.qualifiedCalls}
          />
          <KpiSparkCard
            label="Appointments Set"
            value={fmtNumber(data.current.appointments)}
            current={data.current.appointments} prior={data.prior.appointments}
            series={series("projected_sale")}
            compareLabel={cmpLabel}
            tip={TIPS.appointments}
          />
          <KpiSparkCard
            label="Revenue Generated"
            value={fmtCurrency(data.current.revenue)}
            current={data.current.revenue} prior={data.prior.revenue}
            series={series("verified_sale")}
            compareLabel={cmpLabel}
            tip={TIPS.revenue}
          />
        </div>
      )}

      {/* Funnel + Revenue Capture */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-2">
        <div className="lg:col-span-2">
          {data.isLoading ? <Skeleton className="h-48 rounded-2xl" /> : <JourneyFunnel t={data.current} prior={data.prior} />}
        </div>
        <div>
          {data.isLoading ? <Skeleton className="h-48 rounded-2xl" /> : <RevenueCaptureScore current={data.current} prior={data.prior} />}
        </div>
      </div>

      {/* 3 Performance cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-2">
        <CallHandlingCard totals={data.current} />
        <MissedCallFollowUpCard speed={speed.data ?? null} />
        <CallQualityCard buckets={data.buckets} />
      </div>

      {/* Top Opportunities */}
      <TopOpportunities totals={data.current} speed={speed.data ?? null} />
    </div>
  );
}