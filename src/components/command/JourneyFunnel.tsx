import { Megaphone, PhoneCall, Award, Calendar, DollarSign, ArrowRight, ArrowUp, ArrowDown, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCurrency, fmtNumber, pctChange } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Totals } from "./useCommandData";

function pct(num: number, den: number) {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

export function JourneyFunnel({ t, prior }: { t: Totals; prior: Totals }) {
  const stages = [
    { label: "Ad Spend", value: fmtCurrency(t.spend), Icon: Megaphone, conv: "100%", iconBg: "bg-blue-100", iconColor: "text-blue-600" },
    { label: "Calls Received", value: fmtNumber(t.calls), Icon: PhoneCall, conv: t.spend ? pct(t.calls, t.spend) : "—", iconBg: "bg-indigo-100", iconColor: "text-indigo-600" },
    { label: "Qualified Calls", value: fmtNumber(t.qualifiedCalls), Icon: Award, conv: pct(t.qualifiedCalls, t.calls), iconBg: "bg-purple-100", iconColor: "text-purple-600" },
    { label: "Appointments Set", value: fmtNumber(t.appointments), Icon: Calendar, conv: pct(t.appointments, t.qualifiedCalls), iconBg: "bg-amber-100", iconColor: "text-amber-600" },
    { label: "Revenue Generated", value: fmtCurrency(t.revenue), Icon: DollarSign, conv: pct(t.revenue, t.appointments), iconBg: "bg-emerald-500", iconColor: "text-white" },
  ];

  const overallConv = t.calls ? (t.appointments / t.calls) * 100 : 0;
  const priorConv = prior.calls ? (prior.appointments / prior.calls) * 100 : 0;
  const cpQualified = t.qualifiedCalls ? t.spend / t.qualifiedCalls : 0;
  const priorCpQ = prior.qualifiedCalls ? prior.spend / prior.qualifiedCalls : 0;
  const cpAppt = t.appointments ? t.spend / t.appointments : 0;
  const priorCpA = prior.appointments ? prior.spend / prior.appointments : 0;
  const cpRev = t.revenue ? t.spend / t.revenue : 0;
  const priorCpR = prior.revenue ? prior.spend / prior.revenue : 0;

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-6 h-full">
      <div className="flex items-center gap-1.5">
        <h3 className="text-base font-semibold text-slate-900">Customer Journey Funnel</h3>
        <Tooltip>
          <TooltipTrigger>
            <Info className="size-3.5 text-slate-400" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            From ad spend → calls → qualified leads → appointments → verified revenue.
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-xs text-slate-500 mt-0.5">From ad spend to revenue</p>

      <div className="mt-7 flex items-start justify-between gap-2 px-2">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-start gap-2 flex-1">
            <div className="flex flex-col items-center text-center flex-1">
              <div className={cn("flex size-16 items-center justify-center rounded-full", s.iconBg)}>
                <s.Icon className={cn("size-7", s.iconColor)} />
              </div>
              <div className="mt-3 text-xs font-medium text-slate-600">{s.label}</div>
              <div className="text-base font-bold tabular-nums text-slate-900 mt-0.5">{s.value}</div>
              <div className="text-[11px] text-slate-500 tabular-nums">{s.conv}</div>
            </div>
            {i < stages.length - 1 && (
              <ArrowRight className="size-4 text-slate-300 mt-6 shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-7 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-slate-200 pt-5">
        <SubKpi label="Overall Conversion Rate" value={t.calls ? `${overallConv.toFixed(1)}%` : "—"} delta={pctChange(overallConv, priorConv)} />
        <SubKpi label="Cost Per Qualified Call" value={cpQualified ? fmtCurrency(cpQualified) : "—"} delta={pctChange(cpQualified, priorCpQ)} invert />
        <SubKpi label="Cost Per Appointment" value={cpAppt ? fmtCurrency(cpAppt) : "—"} delta={pctChange(cpAppt, priorCpA)} invert />
        <SubKpi label="Cost Per Revenue $" value={cpRev ? `$${cpRev.toFixed(2)}` : "—"} delta={pctChange(cpRev, priorCpR)} invert />
      </div>
    </div>
  );
}

function SubKpi({ label, value, delta, invert }: { label: string; value: string; delta: number; invert?: boolean }) {
  const positive = invert ? delta < 0 : delta >= 0;
  const show = Number.isFinite(delta) && delta !== 0;
  return (
    <div>
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
        {show && value !== "—" && (
          <span className={cn("inline-flex items-center text-[11px] font-semibold", positive ? "text-emerald-600" : "text-rose-600")}>
            {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}