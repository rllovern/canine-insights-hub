import { Megaphone, PhoneCall, Award, ArrowRight, ArrowUp, ArrowDown, Info, Minus, ClipboardCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtCurrency, fmtNumber, safeDelta, deltaTone, DELTA_TONE_CLASS } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { CommandMode, CommandTargets, Totals } from "./useCommandData";
import { DEFAULT_COMMAND_TARGETS } from "./useCommandData";
import { TIPS } from "./tooltips";
import { CARD_CHROME } from "./cardChrome";
import {
  QUALITY_TARGETS,
  qualityTier,
  formatQualityRate,
} from "@/lib/leadModel";

/** Quality tier → text color. */
const TIER_TEXT: Record<string, string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-destructive",
  "low-sample": "text-slate-900",
};

function pct(num: number, den: number) {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

const EMPTY_TOTALS: Totals = { spend: 0, calls: 0, qualifiedCalls: 0, appointments: 0, revenue: 0, totalLeads: 0, good: 0, projected: 0, bad: 0, qualityRate: 0, sales: 0 };

export function JourneyFunnel({
  t,
  prior,
  targets = DEFAULT_COMMAND_TARGETS,
  mode = "business",
  blendedTotalLeads,
  benchmarkLabel,
}: {
  t?: Totals;
  prior?: Totals;
  targets?: CommandTargets;
  mode?: CommandMode;
  /** For Media Efficiency Ratio in Ads mode: blended total leads in the same window. */
  blendedTotalLeads?: number;
  benchmarkLabel?: string;
}) {
  t = t ?? EMPTY_TOTALS;
  prior = prior ?? EMPTY_TOTALS;
  const isAds = mode === "ads";
  // The funnel is a CALL-tracking funnel: every stage must come from CTM so the
  // parts sum to the base. CRM wins (t.sales, from ghl_opportunities) are a
  // different population on a different timestamp and are shown separately.
  // Projected-sale is retired: quality is good calls only.
  const qualityCount = t.good;
  const priorQualityCount = prior.good;
  const cpgl = qualityCount ? t.spend / qualityCount : 0;
  const priorCpgl = priorQualityCount ? prior.spend / priorQualityCount : 0;
  const cpl = t.totalLeads ? t.spend / t.totalLeads : 0;
  const priorCpl = prior.totalLeads ? prior.spend / prior.totalLeads : 0;
  const qualityRatePct = t.qualityRate * 100;
  const priorQualityRatePct = prior.qualityRate * 100;
  const tier = qualityTier(t.qualityRate, t.totalLeads);
  const callsConvPct = t.calls ? 100 : 0; // 100% of records enter the funnel
  const scoredPct = t.calls ? (t.totalLeads / t.calls) * 100 : 0;
  const unscored = Math.max(0, t.calls - t.totalLeads);
  const mer = isAds && t.totalLeads && blendedTotalLeads ? blendedTotalLeads / t.totalLeads : null;
  const benchmarkName = benchmarkLabel ?? "Current scope";
  const cpglBenchmark = cpgl ? `${fmtCurrency(cpgl)}/good lead` : "unavailable";
  const qualityBenchmark = t.totalLeads ? formatQualityRate(t.qualityRate) : "unavailable";

  return (
    <div className={cn(CARD_CHROME, "p-3 h-full flex flex-col")}>
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-slate-900">
          {isAds ? "Customer Journey Funnel · Ads (Google PPC)" : "Customer Journey Funnel"}
        </h3>
        <Tooltip>
          <TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.funnel}</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5">
        {isAds
          ? "PPC Spend → PPC Records → Scored calls → Good Calls"
          : "Ad Spend → Records → Scored calls → Good Calls"}
      </p>

      {/* Single horizontal row: three stages on one baseline, long connector arrows. */}
      <div className="mt-3 flex items-start gap-2">
        <Stage s={{ label: isAds ? "PPC Spend" : "Ad Spend", src: isAds ? "daily_metrics.cost · Google PPC" : "Google Ads", value: fmtCurrency(t.spend), Icon: Megaphone, sub: "100%", iconBg: "bg-blue-100", iconColor: "text-blue-600" }} />
        <Connector />
        <Stage s={{ label: isAds ? "PPC Records" : "Records", src: isAds ? "daily_metrics.record_count · Google PPC" : "CTM + Forms (calls + forms)", value: fmtNumber(t.calls), Icon: PhoneCall, sub: t.calls ? `${callsConvPct.toFixed(0)}%` : "—", iconBg: "bg-indigo-100", iconColor: "text-indigo-600" }} />
        <Connector />
        <ScoredStage scored={t.totalLeads} records={t.calls} unscored={unscored} scoredPct={scoredPct} />
        <Connector />
        <GoodStage good={t.good} bad={t.bad} qualityRate={t.qualityRate} base={t.totalLeads} qualityRatePct={qualityRatePct} hasBase={t.totalLeads > 0} />
      </div>

      <div className="mt-auto grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-slate-200 pt-2">
        {isAds ? (
          <SubKpi tip={TIPS.adCpl} label="Ad CPL" value={cpl ? fmtCurrency(cpl) : "—"} numericValue={cpl} delta={safeDelta(cpl, priorCpl)} invert
            footnote="No absolute target — compare locations." />
        ) : (
          <SubKpi tip={TIPS.cpl} label="Blended CPL" value={cpl ? fmtCurrency(cpl) : "—"} numericValue={cpl} delta={safeDelta(cpl, priorCpl)} target={targets.cpl} targetText={fmtCurrency(targets.cpl)} invert />
        )}
        {isAds ? (
          <SubKpi tip={TIPS.adCpgl} label="Ad CPGL" value={cpgl ? fmtCurrency(cpgl) : "—"} numericValue={cpgl} delta={safeDelta(cpgl, priorCpgl)} invert
            footnote={`${benchmarkName} benchmark ${cpglBenchmark}`} />
        ) : (
          <SubKpi tip={TIPS.cpQualified} label="Blended CPGL" value={cpgl ? fmtCurrency(cpgl) : "—"} numericValue={cpgl} delta={safeDelta(cpgl, priorCpgl)} target={targets.cpgl} targetText={fmtCurrency(targets.cpgl)} invert />
        )}
        <SubKpi
          tip={TIPS.qualityRate}
          label="Quality Rate"
          value={t.totalLeads ? formatQualityRate(t.qualityRate) : "—"}
          delta={safeDelta(qualityRatePct, priorQualityRatePct)}
          target={QUALITY_TARGETS.green * 100}
          targetText={`${(QUALITY_TARGETS.green * 100).toFixed(0)}%`}
          tier={tier === "low-sample" ? null : tier}
          footnote={t.totalLeads ? `${t.good} of ${t.totalLeads} scored calls` : undefined}
        />
        <LeadMix bad={t.bad} good={t.good} other={t.projected} crmWins={t.sales} total={t.totalLeads} records={t.calls} benchmarkLabel={benchmarkName} benchmarkRate={qualityBenchmark} />
      </div>

      {isAds && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-slate-500 border-t border-slate-100 pt-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">
                Media Efficiency Ratio:{" "}
                <span className="font-semibold text-slate-700 tabular-nums">
                  {mer ? `${mer.toFixed(1)}x` : "—"}
                </span>
                <span className="text-slate-400"> (blended ÷ PPC leads)</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.mediaEfficiency}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/** Long thin connector arrow between funnel stages, matching the reference layout. */
function Connector() {
  return (
    <div className="flex items-center justify-center flex-1 min-w-[40px] mt-5">
      <div className="h-px flex-1 bg-slate-200" />
      <ArrowRight className="size-3.5 text-slate-300 shrink-0 -ml-0.5" />
    </div>
  );
}

/** Lead Mix tile — total only by default, full breakdown on hover. */
function LeadMix({
  bad,
  good,
  other,
  crmWins,
  total,
  records,
  benchmarkLabel,
  benchmarkRate,
}: {
  bad: number;
  good: number;
  other: number;
  crmWins: number;
  total: number;
  records: number;
  benchmarkLabel: string;
  benchmarkRate: string;
}) {
  // Benchmark: share of good leads against the shared quality targets.
  const goodShare = total > 0 ? good / total : 0;
  const judged = total > 0;
  const tier = qualityTier(goodShare, total);
  const pass = goodShare >= QUALITY_TARGETS.green;
  const numCls = !judged ? "text-slate-900" : TIER_TEXT[tier];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">
          <div className="text-[10.5px] text-slate-500 mb-0.5">Scored mix</div>
          <div className={cn("text-base font-bold tabular-nums", numCls)}>
            {total} <span className="text-[10.5px] font-normal text-slate-500">scored calls</span>
          </div>
          <div className="text-[10px] text-slate-400 tabular-nums">of {records} records</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="text-xs leading-snug">
        <div className="font-semibold mb-1">Scored mix · {total} of {records} records</div>
        <div className="tabular-nums">
          <span className="text-rose-600">{bad} bad</span> ·{" "}
          <span className="text-purple-600">{good} good</span>
          {other > 0 && (
            <>
              {" "}·{" "}
              <span className="text-slate-500">{other} other scored</span>
            </>
          )}
        </div>
        <div className="text-[10px] text-slate-400 mt-1">
          These are call-scoring outcomes and sum to {total} scored calls. Spam and un-scored
          records are not in this base. CRM wins ({crmWins}) are counted separately by Date marked
          Won and are not part of this mix.
        </div>
        {judged && (
          <div className={cn("mt-1 font-semibold tabular-nums", TIER_TEXT[tier])}>
            Good share {(goodShare * 100).toFixed(1)}% · target ≥ {(QUALITY_TARGETS.green * 100).toFixed(0)}% {pass ? "✓" : "✕"}
          </div>
        )}
        <div className="text-[10px] text-slate-400 mt-1">{benchmarkLabel} benchmark {benchmarkRate}</div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Records → Scored calls. Makes the drop visible instead of implicit. */
function ScoredStage({ scored, records, unscored, scoredPct }: { scored: number; records: number; unscored: number; scoredPct: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col items-center text-center flex-1 rounded-md p-0.5 cursor-help">
          <div className="flex size-9 items-center justify-center rounded-full bg-sky-100">
            <ClipboardCheck className="size-4 text-sky-600" />
          </div>
          <div className="mt-1 text-[10px] font-medium text-slate-600 leading-tight">Scored calls</div>
          <div className="text-[13px] font-bold tabular-nums mt-0.5 leading-tight text-slate-900">{fmtNumber(scored)}</div>
          <div className="text-[10px] text-slate-500 tabular-nums mt-0.5">
            {records ? `${scored} of ${records} scored` : "—"}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug">
        <div className="font-semibold">Scored calls</div>
        <div className="mt-1">
          The records call tracking gave a quality outcome. {fmtNumber(unscored)} of {fmtNumber(records)} records
          are not in this base — spam, or not scored yet.
        </div>
        <div className="text-slate-400 text-[10px] mt-1 tabular-nums">
          {scoredPct.toFixed(0)}% of records scored
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function GoodStage({ good, bad, qualityRate, base, qualityRatePct, hasBase }: { good: number; bad: number; qualityRate: number; base: number; qualityRatePct: number; hasBase: boolean }) {
  // Grade against the shared quality target (green >= 30%, amber >= 25%),
  // not a good-vs-bad head count.
  const numCls = !hasBase ? "text-slate-900" : TIER_TEXT[qualityTier(qualityRate, base)];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col items-center text-center flex-1 rounded-md p-0.5 cursor-help">
          <div className="flex size-9 items-center justify-center rounded-full bg-emerald-100">
            <Award className="size-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-[10px] font-medium text-slate-600 leading-tight">Good Calls</div>
          <div className={cn("text-[13px] font-bold tabular-nums mt-0.5 leading-tight", numCls)}>{fmtNumber(good)}</div>
          <div className="text-[10px] text-slate-500 tabular-nums mt-0.5">
            {hasBase ? `${good} of ${base} scored` : "—"}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug">
        <div className="font-semibold">Good calls</div>
        <div className="mt-1 tabular-nums">
          <span className="text-purple-600 font-medium">{good} good</span>
          <span className="text-slate-400"> · </span>
          <span className="text-rose-600 font-medium">{bad} bad</span>
        </div>
        <div className="text-slate-400 text-[10px] mt-0.5">Source: call scoring (daily_metrics.good_leads)</div>
        {hasBase && (
          <div className="mt-1 tabular-nums">Quality rate {qualityRatePct.toFixed(1)}% — good ÷ {base} scored calls.</div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function Stage({ s }: { s: { label: string; src: string; value: string; Icon: any; sub: string; iconBg: string; iconColor: string; pending?: boolean } }) {
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

function SubKpi({ label, value, numericValue, delta, invert, tip, target, targetText, pass, tier: tierProp, footnote }: {
  label: string; value: string; numericValue?: number;
  delta: import("@/lib/metrics").SafeDelta;
  invert?: boolean; tip?: string;
  target?: number; targetText?: string; pass?: boolean;
  tier?: "green" | "amber" | "red" | null;
  footnote?: string;
}) {
  // Three-tier color for cost-style (invert) metrics: green ≤ target,
  // amber within 35% over, red > 35% over. Quality-rate-style metrics
  // keep the binary pass coloring passed in by the caller.
  let tier: "green" | "amber" | "red" | null = null;
  let judged = false;
  let passResolved = pass;
  if (tierProp && value !== "—") {
    tier = tierProp;
    judged = true;
  } else if (target != null && value !== "—") {
    if (invert && numericValue != null && numericValue > 0) {
      const ratio = numericValue / target;
      tier = ratio <= 1 ? "green" : ratio <= 1.35 ? "amber" : "red";
      passResolved = tier === "green";
      judged = true;
    } else if (pass != null) {
      tier = pass ? "green" : "red";
      judged = true;
    }
  }
  const tierColor =
    tier === "green" ? "text-emerald-600"
    : tier === "amber" ? "text-amber-600"
    : tier === "red" ? "text-rose-600"
    : "text-slate-900";
  const tierLabel =
    tier === "green" ? "On target ✓"
    : tier === "amber" ? (invert ? "Slightly over target" : "Slightly under target")
    : tier === "red" ? (invert ? "Over target ✕" : "Under target ✕")
    : "";
  return (
    <div>
      <div className="text-[10.5px] text-slate-500 mb-0.5">{label}</div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("text-base font-bold tabular-nums cursor-help inline-block", judged ? tierColor : "text-slate-900")}>
            {value}
          </div>
        </TooltipTrigger>
        <TooltipContent className="text-xs leading-snug">
          {tip && <div className="mb-1.5 max-w-xs">{tip}</div>}
          {judged && (
            <div className={cn("font-semibold tabular-nums", tierColor)}>
              Target {targetText} · {tierLabel}
            </div>
          )}
          {value !== "—" && (
            <div className="mt-1 flex items-center gap-1">
              <span className="text-slate-400">vs prior period:</span>
              <DeltaBadge d={delta} invert={invert} />
            </div>
          )}
        </TooltipContent>
      </Tooltip>
      {footnote && (
        <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{footnote}</div>
      )}
    </div>
  );
}

function DeltaBadge({ d, invert }: { d: import("@/lib/metrics").SafeDelta; invert?: boolean }) {
  if (d.kind === "no-prior") {
    return <span className="inline-flex items-center text-[10.5px] text-slate-400 gap-0.5"><Minus className="h-3 w-3" />no prior</span>;
  }
  if (d.kind === "low-sample") {
    const tone = deltaTone(null, { invert, direction: d.abs });
    return (
      <span className={cn("inline-flex items-center text-[10.5px] font-semibold gap-0.5", DELTA_TONE_CLASS[tone])}>
        {d.abs >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {d.abs >= 0 ? "+" : ""}{d.abs.toFixed(1)}
      </span>
    );
  }
  const tone = deltaTone(d.value, { invert });
  return (
    <span className={cn("inline-flex items-center text-[11px] font-semibold", DELTA_TONE_CLASS[tone])}>
      {d.value >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(d.value).toFixed(1)}%
    </span>
  );
}