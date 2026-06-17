import { format } from "date-fns";
import { DollarSign, PhoneCall, Award, Calendar, TrendingUp, Globe2, Building2 } from "lucide-react";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCurrency, fmtNumber } from "@/lib/metrics";
import { useCommandData } from "@/components/command/useCommandData";
import { KpiSparkCard } from "@/components/command/KpiSparkCard";
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
  const { mode, propertyIds, label } = useScope();
  const { range, compareRange, compareMode } = useDateRange();

  const data = useCommandData(propertyIds, range, compareMode !== "off" ? compareRange : null);
  const speed = useSpeed({ propertyIds, from: range.from, to: range.to });

  const cmpLabel = `vs ${format(new Date(data.compareRangeIso.from), "MMM d")} – ${format(new Date(data.compareRangeIso.to), "MMM d, yyyy")}`;

  const series = (key: "cost" | "calls" | "good_leads" | "projected_sale" | "verified_sale") =>
    data.currentDaily.map((d) => ({ date: d.date, v: d[key] }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {mode === "agency" ? <Globe2 className="size-5 text-primary" /> : <Building2 className="size-5 text-primary" />}
            Executive Overview
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time performance across the customer journey · {label} · {format(range.from, "MMM d")} – {format(range.to, "MMM d, yyyy")}
          </p>
        </div>
      </div>

      {/* 5 KPI cards */}
      {data.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiSparkCard
            label="Ad Spend" icon={<DollarSign className="size-4" />}
            value={fmtCurrency(data.current.spend)}
            current={data.current.spend} prior={data.prior.spend}
            series={series("cost")}
            compareLabel={cmpLabel}
          />
          <KpiSparkCard
            label="Calls Received" icon={<PhoneCall className="size-4" />}
            value={fmtNumber(data.current.calls)}
            current={data.current.calls} prior={data.prior.calls}
            series={series("calls")}
            compareLabel={cmpLabel}
          />
          <KpiSparkCard
            label="Qualified Calls" icon={<Award className="size-4" />}
            value={fmtNumber(data.current.qualifiedCalls)}
            current={data.current.qualifiedCalls} prior={data.prior.qualifiedCalls}
            series={series("good_leads")}
            compareLabel={cmpLabel}
          />
          <KpiSparkCard
            label="Appointments Set" icon={<Calendar className="size-4" />}
            value={fmtNumber(data.current.appointments)}
            current={data.current.appointments} prior={data.prior.appointments}
            series={series("projected_sale")}
            compareLabel={cmpLabel}
          />
          <KpiSparkCard
            label="Revenue Generated" icon={<TrendingUp className="size-4" />}
            value={fmtCurrency(data.current.revenue)}
            current={data.current.revenue} prior={data.prior.revenue}
            series={series("verified_sale")}
            compareLabel={cmpLabel}
          />
        </div>
      )}

      {/* Funnel + Revenue Capture */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {data.isLoading ? <Skeleton className="h-72" /> : <JourneyFunnel t={data.current} />}
        </div>
        <div>
          {data.isLoading ? <Skeleton className="h-72" /> : <RevenueCaptureScore current={data.current} prior={data.prior} />}
        </div>
      </div>

      {/* 3 Performance cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CallHandlingCard />
        <MissedCallFollowUpCard speed={speed.data ?? null} totals={data.current} />
        <CallQualityCard buckets={data.buckets} />
      </div>

      {/* Top Opportunities */}
      <TopOpportunities totals={data.current} speed={speed.data ?? null} />
    </div>
  );
}