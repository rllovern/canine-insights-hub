import { Megaphone, PhoneCall, Award, Sparkles, CheckCircle2, ArrowRight, ArrowUp, ArrowDown, Info, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCurrency, fmtNumber, safeDelta } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { CommandTargets, Totals } from "./useCommandData";
import { DEFAULT_COMMAND_TARGETS } from "./useCommandData";
import { TIPS } from "./tooltips";
import {
  PROJECTED_LABEL,
  QUALITY_TARGETS,
  WINCHESTER_BENCHMARK,
  qualityTier,
  TIER_TEXT,
  formatQualityRate,
} from "@/lib/leadModel";

function pct(num: number, den: number) {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

const EMPTY_TOTALS: Totals = { spend: 0, calls: 0, qualifiedCalls: 0, appointments: 0, revenue: 0, totalLeads: 0, good: 0, projected: 0, bad: 0, qualityRate: 0 };

export function JourneyFunnel({ t, prior, targets = DEFAULT_COMMAND_TARGETS }: { t?: Totals; prior?: Totals; targets?: CommandTargets }) {
  t = t ?? EMPTY_TOTALS;
  prior = prior ?? EMPTY_TOTALS;
  // Linear stages.
  const linearStages = [
    { label: "Ad Spend",       src: "Google Ads", value: fmtCurrency(t.spend),  Icon: Megaphone, sub: "100%",                          iconBg: "bg-blue-100",   iconColor: "text-blue-600",   pending: false },
    { label: "Calls Received", src: "CTM",        value: fmtNumber(t.calls),    Icon: PhoneCall, sub: t.totalLeads ? `${t.totalLeads} leads` : "—", iconBg: "bg-indigo-100", iconColor: "text-indigo-600", pending: false },
  ];

  // Parallel quality tiers — good and AI-projected are siblings, not a sequence.
  const goodShare = t.totalLeads ? (t.good / t.totalLeads) * 100 : 0;
  const projShare = t.totalLeads ? (t.projected / t.totalLeads) * 100 : 0;

  // CPGL uses the canonical quality numerator (good + projected).
  const qualityCount = t.good + t.projected;
  const priorQualityCount = prior.good + prior.projected;
  const cpgl = qualityCount ? t.spend / qualityCount : 0;
  const priorCpgl = priorQualityCount ? prior.spend / priorQualityCount : 0;
  const cpl = t.totalLeads ? t.spend / t.totalLeads : 0;
  const priorCpl = prior.totalLeads ? prior.spend / prior.totalLeads : 0;
  const qualityRatePct = t.qualityRate * 100;
  const priorQualityRatePct = prior.qualityRate * 100;
  const tier = qualityTier(t.qualityRate, t.totalLeads);

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-3 h-full flex flex-col">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-slate-900">Customer Journey Funnel</h3>
        <Tooltip>
          <TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.funnel}</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5">Ad Spend → Calls → parallel quality tiers (Good · AI-projected) → Verified (pending)</p>

      <div className="mt-2 flex items-start gap-1">
        {linearStages.map((s) => (
          <div key={s.label} className="flex items-start gap-1">
            <Stage s={s} />
            <ArrowRight className="size-3 text-slate-300 mt-3 shrink-0" />
          </div>
        ))}

        {/* Parallel quality tiers — sibling branches, NOT a sub-stage of each other. */}
        <div className="flex flex-col gap-1 flex-1">
          <Stage s={{ label: "Good leads",      src: "CTM scored",     value: fmtNumber(t.good),      Icon: Award,    sub: `${goodShare.toFixed(0)}% of leads`,  iconBg: "bg-purple-100", iconColor: "text-purple-600", pending: false }} />
          <Stage s={{ label: PROJECTED_LABEL,   src: "CTM transcript", value: fmtNumber(t.projected), Icon: Sparkles, sub: `${projShare.toFixed(0)}% of leads`,  iconBg: "bg-amber-100",  iconColor: "text-amber-600",  pending: false }} />
        </div>

        <ArrowRight className="size-3 text-slate-300 mt-3 shrink-0" />
        <Stage s={{ label: "Verified Sale", src: "GHL Won (pending)", value: "—", Icon: CheckCircle2, sub: "not piped", iconBg: "bg-slate-100", iconColor: "text-slate-400", pending: true }} />
      </div>

      <div className="mt-auto grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-slate-200 pt-2">
        <SubKpi tip={TIPS.cpl}         label="CPL (per lead)"     value={cpl  ? fmtCurrency(cpl)  : "—"} delta={safeDelta(cpl, priorCpl)}   target={targets.cpl}  targetText={fmtCurrency(targets.cpl)}  pass={cpl  > 0 && cpl  <= targets.cpl}  invert />
        <SubKpi tip={TIPS.cpQualified} label="CPGL (good + AI-proj)" value={cpgl ? fmtCurrency(cpgl) : "—"} delta={safeDelta(cpgl, priorCpgl)} target={targets.cpgl} targetText={fmtCurrency(targets.cpgl)} pass={cpgl > 0 && cpgl <= targets.cpgl} invert />
        <SubKpi
          tip={TIPS.qualityRate}
          label="Quality Rate"
          value={t.totalLeads ? formatQualityRate(t.qualityRate) : "—"}
          delta={safeDelta(qualityRatePct, priorQualityRatePct)}
          target={QUALITY_TARGETS.green * 100}
          targetText={`${(QUALITY_TARGETS.green * 100).toFixed(0)}%`}
          pass={tier === "green"}
        />
        <div>
          <div className="text-[10.5px] text-slate-500 mb-0.5">Lead Mix</div>
          <div className="text-base font-bold tabular-nums text-slate-900">{t.totalLeads} <span className="text-[10.5px] font-normal text-slate-500">total</span></div>
          <div className="text-[10.5px] text-slate-500 tabular-nums">
            {t.bad} bad · <span className="text-purple-600 font-medium">{t.good} good</span> · <span className="text-amber-600 font-medium">{t.projected} AI-proj</span>
          </div>
          <div className="text-[9.5px] text-slate-400 mt-0.5">Winchester benchmark {(WINCHESTER_BENCHMARK * 100).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}

function Stage({ s }: { s: { label: string; src: string; value: string; Icon: any; sub: string; iconBg: string; iconColor: string; pending: boolean } }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex flex-col items-center text-center flex-1 rounded-md p-0.5", s.pending && "opacity-60 border border-dashed border-slate-300")}>
          <div className={cn("flex size-9 items-center justify-center rounded-full", s.iconBg)}>
            <s.Icon className={cn("size-4", s.iconColor)} />
          </div>
          <div className="mt-1 text-[10px] font-medium text-slate-600 leading-tight">{s.label}</div>
          <div className={cn("text-[13px] font-bold tabular-nums mt-0.5 leading-tight", s.pending ? "text-slate-400" : "text-slate-900")}>{s.value}</div>
          <div className="text-[10px] text-slate-500 tabular-nums">{s.sub}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug">
        <div className="font-semibold">{s.label}</div>
        <div className="text-slate-400 text-[10px] mt-0.5">Source: {s.src}</div>
        {s.pending && <div className="mt-1 text-amber-600">{TIPS.verifiedPending}</div>}
      </TooltipContent>
    </Tooltip>
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