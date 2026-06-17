import { Megaphone, PhoneCall, Award, Calendar, DollarSign, ArrowRight, ArrowUp, ArrowDown, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCurrency, fmtNumber, pctChange } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Totals } from "./useCommandData";
import { TIPS } from "./tooltips";

function pct(num: number, den: number) {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

const EMPTY_TOTALS: Totals = { spend: 0, calls: 0, qualifiedCalls: 0, appointments: 0, revenue: 0, totalLeads: 0 };

export function JourneyFunnel({ t, prior }: { t?: Totals; prior?: Totals }) {
  t = t ?? EMPTY_TOTALS;
  prior = prior ?? EMPTY_TOTALS;
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
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-4 h-full flex flex-col">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-slate-900">Customer Journey Funnel</h3>
        <Tooltip>
          <TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.funnel}</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5">From ad spend to revenue</p>

      <div className="mt-2 flex items-start justify-between gap-1">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-start gap-1 flex-1">
            <div className="flex flex-col items-center text-center flex-1">
              <div className={cn("flex size-9 items-center justify-center rounded-full", s.iconBg)}>
                <s.Icon className={cn("size-4", s.iconColor)} />
              </div>
              <div className="mt-1 text-[10px] font-medium text-slate-600 leading-tight">{s.label}</div>
              <div className="text-[13px] font-bold tabular-nums text-slate-900 mt-0.5 leading-tight">{s.value}</div>
              <div className="text-[10px] text-slate-500 tabular-nums">{s.conv}</div>
            </div>
            {i < stages.length - 1 && (
              <ArrowRight className="size-3 text-slate-300 mt-3 shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-slate-200 pt-2">
        <SubKpi tip={TIPS.overallConv} label="Overall Conversion Rate" value={t.calls ? `${overallConv.toFixed(1)}%` : "—"} delta={pctChange(overallConv, priorConv)} />
        <SubKpi tip={TIPS.cpQualified} label="Cost Per Qualified Call" value={cpQualified ? fmtCurrency(cpQualified) : "—"} delta={pctChange(cpQualified, priorCpQ)} invert />
        <SubKpi tip={TIPS.cpAppt} label="Cost Per Appointment" value={cpAppt ? fmtCurrency(cpAppt) : "—"} delta={pctChange(cpAppt, priorCpA)} invert />
        <SubKpi tip={TIPS.cpRev} label="Cost Per Revenue $" value={cpRev ? `$${cpRev.toFixed(2)}` : "—"} delta={pctChange(cpRev, priorCpR)} invert />
      </div>
    </div>
  );
}

function SubKpi({ label, value, delta, invert, tip }: { label: string; value: string; delta: number; invert?: boolean; tip?: string }) {
  const positive = invert ? delta < 0 : delta >= 0;
  const show = Number.isFinite(delta) && delta !== 0;
  return (
    <div>
      <div className="flex items-center gap-1 text-[10.5px] text-slate-500 mb-0.5">
        <span>{label}</span>
        {tip && (
          <Tooltip>
            <TooltipTrigger asChild><button type="button"><Info className="size-3 text-slate-400" /></button></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-snug">{tip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="text-base font-bold tabular-nums text-slate-900">{value}</div>
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