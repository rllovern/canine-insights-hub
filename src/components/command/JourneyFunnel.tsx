import { Megaphone, PhoneCall, Award, Calendar, CheckCircle2, ArrowRight, ArrowUp, ArrowDown, Info, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCurrency, fmtNumber, safeDelta } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { CommandTargets, Totals } from "./useCommandData";
import { DEFAULT_COMMAND_TARGETS } from "./useCommandData";
import { TIPS } from "./tooltips";

function pct(num: number, den: number) {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

const EMPTY_TOTALS: Totals = { spend: 0, calls: 0, qualifiedCalls: 0, appointments: 0, revenue: 0, totalLeads: 0 };

export function JourneyFunnel({ t, prior, targets = DEFAULT_COMMAND_TARGETS }: { t?: Totals; prior?: Totals; targets?: CommandTargets }) {
  t = t ?? EMPTY_TOTALS;
  prior = prior ?? EMPTY_TOTALS;
  const stages = [
    { label: "Ad Spend",          src: "Google Ads",        value: fmtCurrency(t.spend),               Icon: Megaphone,    conv: "100%",                                iconBg: "bg-blue-100",   iconColor: "text-blue-600",   pending: false },
    { label: "Calls Received",    src: "CTM",               value: fmtNumber(t.calls),                 Icon: PhoneCall,    conv: "—",                                   iconBg: "bg-indigo-100", iconColor: "text-indigo-600", pending: false },
    { label: "Qualified Calls",   src: "CTM scored",        value: fmtNumber(t.qualifiedCalls),        Icon: Award,        conv: pct(t.qualifiedCalls, t.calls),        iconBg: "bg-purple-100", iconColor: "text-purple-600", pending: false },
    { label: "AI-Projected Sale", src: "CTM transcript",    value: fmtNumber(t.appointments),          Icon: Calendar,     conv: pct(t.appointments, t.qualifiedCalls), iconBg: "bg-amber-100",  iconColor: "text-amber-600",  pending: false, sub: "count" },
    { label: "Verified Sale",     src: "GHL Won (pending)", value: "—",                                Icon: CheckCircle2, conv: "—",                                   iconBg: "bg-slate-100",  iconColor: "text-slate-400",  pending: true,  sub: "not piped" },
  ];

  const cpQualified = t.qualifiedCalls ? t.spend / t.qualifiedCalls : 0;
  const priorCpQ = prior.qualifiedCalls ? prior.spend / prior.qualifiedCalls : 0;
  const cpAppt = t.appointments ? t.spend / t.appointments : 0;
  const priorCpA = prior.appointments ? prior.spend / prior.appointments : 0;
  const qualRate = t.calls ? (t.qualifiedCalls / t.calls) * 100 : 0;
  const priorQualRate = prior.calls ? (prior.qualifiedCalls / prior.calls) * 100 : 0;
  const apptRate = t.qualifiedCalls ? (t.appointments / t.qualifiedCalls) * 100 : 0;
  const priorApptRate = prior.qualifiedCalls ? (prior.appointments / prior.qualifiedCalls) * 100 : 0;
  const cpl = t.calls ? t.spend / t.calls : 0;
  const priorCpl = prior.calls ? prior.spend / prior.calls : 0;

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-3 h-full flex flex-col">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-slate-900">Customer Journey Funnel</h3>
        <Tooltip>
          <TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.funnel}</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5">Attributable click → captured → scored → projected → verified (pending)</p>

      <div className="mt-2 flex items-start justify-between gap-1">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-start gap-1 flex-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={cn("flex flex-col items-center text-center flex-1 rounded-md p-0.5", s.pending && "opacity-60 border border-dashed border-slate-300")}>
                  <div className={cn("flex size-9 items-center justify-center rounded-full", s.iconBg)}>
                    <s.Icon className={cn("size-4", s.iconColor)} />
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-slate-600 leading-tight">{s.label}</div>
                  <div className={cn("text-[13px] font-bold tabular-nums mt-0.5 leading-tight", s.pending ? "text-slate-400" : "text-slate-900")}>{s.value}</div>
                  <div className="text-[10px] text-slate-500 tabular-nums">{(s as any).sub ?? s.conv}</div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-snug">
                <div className="font-semibold">{s.label}</div>
                <div className="text-slate-400 text-[10px] mt-0.5">Source: {s.src}</div>
                {s.pending && <div className="mt-1 text-amber-600">{TIPS.verifiedPending}</div>}
              </TooltipContent>
            </Tooltip>
            {i < stages.length - 1 && (
              <ArrowRight className="size-3 text-slate-300 mt-3 shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-slate-200 pt-2">
        <SubKpi tip={TIPS.cpl}         label="CPL"                   value={cpl ? fmtCurrency(cpl) : "—"}                       delta={safeDelta(cpl, priorCpl)} target={targets.cpl} targetText={fmtCurrency(targets.cpl)} pass={cpl > 0 && cpl <= targets.cpl} invert />
        <SubKpi tip={TIPS.cpQualified} label="CPGL"                  value={cpQualified ? fmtCurrency(cpQualified) : "—"}       delta={safeDelta(cpQualified, priorCpQ)} target={targets.cpgl} targetText={fmtCurrency(targets.cpgl)} pass={cpQualified > 0 && cpQualified <= targets.cpgl} invert />
        <SubKpi tip={TIPS.cpAppt}      label="Cost / Projected Sale" value={cpAppt ? fmtCurrency(cpAppt) : "—"}                 delta={safeDelta(cpAppt, priorCpA)} target={targets.costPerProjected} targetText={fmtCurrency(targets.costPerProjected)} pass={cpAppt > 0 && cpAppt <= targets.costPerProjected} invert />
        <SubKpi                       label="Qualified Call Rate"   value={t.calls ? `${qualRate.toFixed(1)}%` : "—"}           delta={safeDelta(qualRate, priorQualRate)} target={targets.qualRate * 100} targetText={`${(targets.qualRate * 100).toFixed(0)}%`} pass={t.calls > 0 && qualRate >= targets.qualRate * 100} />
      </div>
    </div>
  );
}

function SubKpi({ label, value, delta, invert, tip, target, targetText, pass }: {
  label: string; value: string;
  delta: import("@/lib/metrics").SafeDelta;
  invert?: boolean; tip?: string;
  target?: number; targetText?: string; pass?: boolean;
}) {
  const judged = target != null && value !== "—" && pass != null;
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
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className={cn("text-base font-bold tabular-nums", judged ? (pass ? "text-emerald-600" : "text-rose-600") : "text-slate-900")}>{value}</div>
        {judged && (
          <span className={cn("text-[10.5px] font-semibold tabular-nums", pass ? "text-emerald-600" : "text-rose-600")}>
            · target {targetText} {pass ? "✓" : "✕"}
          </span>
        )}
        {value !== "—" && <DeltaBadge d={delta} invert={invert} />}
      </div>
    </div>
  );
}

function DeltaBadge({ d, invert }: { d: import("@/lib/metrics").SafeDelta; invert?: boolean }) {
  if (d.kind === "no-prior") {
    return <span className="inline-flex items-center text-[10.5px] text-slate-400 gap-0.5"><Minus className="h-3 w-3" />no prior</span>;
  }
  if (d.kind === "low-sample") {
    const positive = invert ? d.abs < 0 : d.abs >= 0;
    return (
      <span className={cn("inline-flex items-center text-[10.5px] font-semibold gap-0.5", positive ? "text-emerald-600" : "text-rose-600")}>
        {d.abs >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {d.abs >= 0 ? "+" : ""}{d.abs.toFixed(1)} <span className="text-slate-400 font-normal">low n</span>
      </span>
    );
  }
  const positive = invert ? d.value < 0 : d.value >= 0;
  return (
    <span className={cn("inline-flex items-center text-[11px] font-semibold", positive ? "text-emerald-600" : "text-rose-600")}>
      {d.value >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(d.value).toFixed(1)}%
    </span>
  );
}