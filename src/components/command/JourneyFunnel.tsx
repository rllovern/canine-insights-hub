import { Megaphone, PhoneCall, Award, Calendar, DollarSign, ChevronRight, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCurrency, fmtNumber } from "@/lib/metrics";
import type { Totals } from "./useCommandData";

function pct(num: number, den: number) {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

export function JourneyFunnel({ t }: { t: Totals }) {
  const stages = [
    { label: "Ad Spend", value: fmtCurrency(t.spend), Icon: Megaphone, conv: "100%", tone: "muted" as const },
    { label: "Calls Received", value: fmtNumber(t.calls), Icon: PhoneCall, conv: t.spend ? pct(t.calls, t.spend) : "—" },
    { label: "Qualified Calls", value: fmtNumber(t.qualifiedCalls), Icon: Award, conv: pct(t.qualifiedCalls, t.calls) },
    { label: "Appointments Set", value: fmtNumber(t.appointments), Icon: Calendar, conv: pct(t.appointments, t.qualifiedCalls) },
    { label: "Revenue Generated", value: fmtCurrency(t.revenue), Icon: DollarSign, conv: pct(t.revenue, t.appointments), highlight: true },
  ];

  const overallConv = t.calls ? (t.appointments / t.calls) * 100 : 0;
  const cpQualified = t.qualifiedCalls ? t.spend / t.qualifiedCalls : 0;
  const cpAppt = t.appointments ? t.spend / t.appointments : 0;
  const cpRev = t.revenue ? t.spend / t.revenue : 0;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">Customer Journey Funnel</h3>
        <Tooltip>
          <TooltipTrigger>
            <Info className="size-3.5 text-muted-foreground/60" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            From ad spend → calls → qualified leads → appointments → verified revenue. Conversion shown between adjacent stages.
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">From ad spend to revenue</p>

      <div className="mt-6 grid grid-cols-5 gap-2">
        {stages.map((s, i) => (
          <div key={s.label} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <ChevronRight className="absolute -left-3 top-5 size-5 text-muted-foreground/40" />
            )}
            <div
              className={
                "flex size-14 items-center justify-center rounded-full " +
                (s.highlight ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")
              }
            >
              <s.Icon className="size-6" />
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className="text-base font-semibold tabular-nums">{s.value}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">{s.conv}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-border pt-4">
        <SubKpi label="Overall Conversion Rate" value={t.calls ? `${overallConv.toFixed(1)}%` : "—"} />
        <SubKpi label="Cost Per Qualified Call" value={cpQualified ? fmtCurrency(cpQualified) : "—"} />
        <SubKpi label="Cost Per Appointment" value={cpAppt ? fmtCurrency(cpAppt) : "—"} />
        <SubKpi label="Cost Per Revenue $" value={cpRev ? `$${cpRev.toFixed(2)}` : "—"} />
      </div>
    </Card>
  );
}

function SubKpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}