import { KPICard } from "./KPICard";
import { fmtCurrency, fmtNumber, fmtPercent, costPerLead, ctr } from "@/lib/metrics";
import { DollarSign, PhoneCall, MousePointerClick, Users } from "lucide-react";

/**
 * Mock-data overview that mirrors the production layout. Real data wires
 * up in subsequent prompts. We use mock numbers to verify spacing/typography.
 */
export function PropertyOverview({ readOnly = false }: { readOnly?: boolean }) {
  const spend = 4280;
  const clicks = 1432;
  const impressions = 89230;
  const calls = 67;
  const leads = 41;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Headline metrics
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPICard label="Ad spend" value={fmtCurrency(spend)} delta={4.2} hint="vs prev. period" icon={<DollarSign className="h-4 w-4" />} />
          <KPICard label="Calls" value={fmtNumber(calls)} delta={-2.1} hint="vs prev. period" icon={<PhoneCall className="h-4 w-4" />} />
          <KPICard label="Leads" value={fmtNumber(leads)} delta={6.8} hint="vs prev. period" icon={<Users className="h-4 w-4" />} />
          <KPICard label="CPL" value={fmtCurrency(costPerLead(spend, leads))} delta={-3.4} hint="lower is better" icon={<DollarSign className="h-4 w-4" />} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Engagement
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPICard label="Impressions" value={fmtNumber(impressions)} icon={<MousePointerClick className="h-4 w-4" />} />
          <KPICard label="Clicks" value={fmtNumber(clicks)} />
          <KPICard label="CTR" value={fmtPercent(ctr(clicks, impressions))} />
          <KPICard label="Sessions" value="—" hint="GA4 not connected" />
        </div>
      </section>

      <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
        <h3 className="text-sm font-semibold">Charts arrive in the next phase</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {readOnly
            ? "This report will fill in automatically once data sources are connected."
            : "Once Google Ads, CTM, and GA4 are wired in (next prompt), this view will populate with real time-series charts and breakdowns."}
        </p>
      </div>
    </div>
  );
}