import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, AlertOctagon, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { rangeToISO } from "@/lib/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TIPS } from "./tooltips";
import { cn } from "@/lib/utils";
import type { CommandTargets, Totals } from "./useCommandData";
import { DEFAULT_COMMAND_TARGETS } from "./useCommandData";
import { CARD_CHROME } from "./cardChrome";
import {
  qualityRate as canonicalQualityRate,
  totalLeads as canonicalTotalLeads,
  QUALITY_TARGETS,
  LOW_SAMPLE_BASE,
  LOW_SAMPLE_CAVEAT,
  formatQualityRate,
} from "@/lib/leadModel";
import { gradeQuality, formatRange, confidenceLabel, type QualityGrade } from "@/lib/leadModel";

type Row = {
  property_id: string;
  name: string;
  total: number;
  good: number;
  projected: number;
  bad: number;
  rate: number;
  tier: "green" | "amber" | "red" | "low-sample";
  verdict: "critical" | "warning" | "good";
  reason: string;
};

const tierToVerdict = (t: Row["tier"]): Row["verdict"] =>
  t === "red" ? "critical" : t === "amber" ? "warning" : "good";

function statusClasses(verdict: "critical" | "warning" | "good") {
  return verdict === "critical" ? "text-rose-600 bg-rose-500"
    : verdict === "warning" ? "text-amber-600 bg-amber-500"
    : "text-emerald-600 bg-emerald-500";
}

function locationVerdict(totals: Totals, grade: QualityGrade) {
  const verdict: "critical" | "warning" | "good" =
    grade.tier === "red" ? "critical" : grade.tier === "amber" ? "warning" : "good";
  if (grade.tier === "low-sample") {
    return {
      verdict: "good" as const,
      reason: `Low sample (${grade.n} scored calls in window) — quality rate not yet meaningful. Need ${LOW_SAMPLE_BASE}+ scored calls.`,
    };
  }
  const rateText = formatQualityRate(grade.rate);
  const mix = `${totals.bad} bad · ${totals.good} good of ${grade.n} scored calls`;
  const rangeText = grade.showInterval
    ? ` (range ${formatRange(grade)} on ${grade.n} scored calls)`
    : "";
  const head =
    grade.tier === "green"
      ? `Quality ${rateText}${rangeText} clears the ${(QUALITY_TARGETS.green * 100).toFixed(0)}% target.`
      : grade.tier === "red"
        ? `Quality ${rateText}${rangeText} is below the ${(QUALITY_TARGETS.amber * 100).toFixed(0)}% floor even allowing for volume.`
        : `Quality ${rateText}${rangeText} sits between the ${(QUALITY_TARGETS.amber * 100).toFixed(0)}% floor and the ${(QUALITY_TARGETS.green * 100).toFixed(0)}% target.`;
  const tail =
    grade.tier !== "red" && grade.rate < QUALITY_TARGETS.amber
      ? " Volume is too thin to call this critical yet."
      : "";
  return { verdict, reason: `${head} Mix: ${mix}.${tail}` };
}

export function PortfolioVerdict({
  totals,
  targets = DEFAULT_COMMAND_TARGETS,
  viewMode = "business",
}: {
  totals?: Totals;
  targets?: CommandTargets;
  viewMode?: "business" | "ads";
}) {
  const { propertyIds, mode, label, setScope } = useScope();
  const navigate = useNavigate();
  const { range } = useDateRange();
  const iso = rangeToISO(range);

  // Portfolio benchmark for the active mode (PPC in Ads, blended in Business).
  // Always defined, moves with data, never benchmarks a location against
  // itself, and carries no enshrined single location. Scope-matched: PPC-to-
  // PPC or blended-to-blended — never crossed.
  const benchmark = useQuery({
    queryKey: ["portfolio-benchmark", viewMode, iso.from, iso.to],
    enabled: mode !== "agency",
    queryFn: async (): Promise<number | null> => {
      if (viewMode === "ads") {
        const { data, error } = await supabase
          .from("daily_metrics")
          .select("good_leads, bad_leads, projected_sale")
          .eq("ad_source", "Google PPC")
          .gte("date", iso.from)
          .lte("date", iso.to);
        if (error) throw error;
        let good = 0, bad = 0, proj = 0;
        for (const r of (data ?? []) as any[]) {
          good += Number(r.good_leads ?? 0);
          bad += Number(r.bad_leads ?? 0);
          proj += Number(r.projected_sale ?? 0);
        }
        const total = good + bad + proj;
        return total ? (good + proj) / total : null;
      }
      const { data, error } = await supabase
        .from("v_lead_counts_property_daily")
        .select("bad_leads, good_leads, projected_sales, properties:properties!inner(is_active)")
        .gte("date", iso.from)
        .lte("date", iso.to);
      if (error) throw error;
      let good = 0, bad = 0, proj = 0;
      for (const r of (data ?? []) as any[]) {
        if (r.properties && r.properties.is_active === false) continue;
        good += Number(r.good_leads ?? 0);
        bad += Number(r.bad_leads ?? 0);
        proj += Number(r.projected_sales ?? 0);
      }
      const total = good + bad + proj;
      return total ? (good + proj) / total : null;
    },
  });

  const q = useQuery({
    queryKey: ["portfolio-verdict", propertyIds?.join(",") ?? "all", iso.from, iso.to],
    enabled: mode === "agency",
    queryFn: async (): Promise<Row[]> => {
      // Canonical lead model from the shared SQL view — no local recomputation.
      let q = supabase
        .from("v_lead_counts_property_daily")
        .select("property_id, bad_leads, good_leads, projected_sales, total_leads, properties:properties!inner(name, is_active)")
        .gte("date", iso.from)
        .lte("date", iso.to);
      if (propertyIds) q = q.in("property_id", propertyIds);
      const { data, error } = await q;
      if (error) throw error;

      const agg = new Map<string, { name: string; bad: number; good: number; projected: number }>();
      for (const r of (data ?? []) as any[]) {
        const id = r.property_id as string;
        const cur = agg.get(id) ?? { name: r.properties?.name ?? id, bad: 0, good: 0, projected: 0 };
        cur.bad += Number(r.bad_leads ?? 0);
        cur.good += Number(r.good_leads ?? 0);
        cur.projected += Number(r.projected_sales ?? 0);
        agg.set(id, cur);
      }

      const rows: Row[] = [];
      for (const [property_id, v] of agg.entries()) {
        const total = canonicalTotalLeads(v);
        if (total === 0) continue;
        const rate = canonicalQualityRate(v);
        const grade = gradeQuality(v);
        const tier = grade.tier;
        const verdict = tierToVerdict(tier);
        const reason =
          tier === "low-sample"
            ? `Low sample · ${total} scored calls (need ${LOW_SAMPLE_BASE}+)`
            : `Quality ${formatQualityRate(rate)}${grade.showInterval ? ` (range ${formatRange(grade)}, ${total} scored calls)` : ""} · ${v.bad} bad / ${v.good} good of ${total} scored`;
        rows.push({ property_id, name: v.name, total, bad: v.bad, good: v.good, projected: v.projected, rate, tier, verdict, reason });
      }
      const order = { critical: 0, warning: 1, good: 2 } as const;
      // Worst quality first; low-sample sinks to the bottom.
      rows.sort((a, b) => {
        if (a.tier === "low-sample" && b.tier !== "low-sample") return 1;
        if (b.tier === "low-sample" && a.tier !== "low-sample") return -1;
        return order[a.verdict] - order[b.verdict] || a.rate - b.rate;
      });
      return rows;
    },
  });

  if (mode !== "agency") {
    const t = totals ?? { spend: 0, calls: 0, qualifiedCalls: 0, appointments: 0, revenue: 0, totalLeads: 0, good: 0, projected: 0, bad: 0, qualityRate: 0, sales: 0 };
    const grade = gradeQuality({ bad: t.bad, good: t.good, projected: t.projected });
    const tier = grade.tier;
    const lowSample = tier === "low-sample"; // < LOW_SAMPLE_BASE (8) — suppress
    const judged = locationVerdict(t, grade);
    // Grade already accounts for volume (Wilson interval), so the ring color
    // always agrees with the reason text.
    const ringTone =
      tier === "red" ? { stroke: "#f43f5e", text: "text-rose-600", word: "Critical" }
      : tier === "amber" ? { stroke: "#f59e0b", text: "text-amber-600", word: "Warning" }
      : { stroke: "#10b981", text: "text-emerald-600", word: "Good" };
    const score = Math.round((t.qualityRate || 0) * 100);
    const bench = benchmark.data;
    const scopeLabel = viewMode === "ads" ? "PPC" : "blended";
    const benchText = bench == null
      ? `Portfolio avg unavailable (${scopeLabel})`
      : `Portfolio avg ${(bench * 100).toFixed(0)}% (${scopeLabel})`;
    const windowDays = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000) + 1);
    const showWindowHint = windowDays < 30;
    return (
      <div className={cn(CARD_CHROME, "p-3 h-full flex flex-col")}>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-900">Location Verdict</h3>
          <Tooltip><TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-snug space-y-1.5">
              <p>{TIPS.portfolioVerdict}</p>
              <p>{judged.reason}</p>
              <p>{benchText}</p>
              {showWindowHint && (
                <p>
                  Use a 30-day window for the most reliable verdict. Shorter ranges have
                  fewer leads, which can make the quality rate look unusually high or low.
                </p>
              )}
            </TooltipContent></Tooltip>
          {!lowSample && grade.confidence !== "high" && (
            <span className="ml-auto inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500">
              {confidenceLabel(grade.n)}
            </span>
          )}
        </div>
        {showWindowHint && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-blue-50 px-2 py-1.5 text-[11px] leading-snug text-blue-700">
            <Info className="size-3.5 shrink-0 mt-0.5 text-blue-500" />
            <span>
              Use a <strong>30-day window</strong> for the most reliable Location Verdict.
            </span>
          </div>
        )}
        <div className={cn("flex items-center gap-4 flex-1", showWindowHint ? "mt-2" : "mt-3")}>
          <ScoreGauge score={lowSample ? null : score} stroke={ringTone.stroke} word={lowSample ? "Low sample" : ringTone.word} wordCls={lowSample ? "text-slate-400" : ringTone.text} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-slate-900 truncate">{label}</div>
            <p className="mt-1.5 text-[12px] text-slate-600 leading-snug">
              {lowSample ? (
                <>Quality not yet meaningful · {grade.n} leads</>
              ) : (
                <>
                  <span className="font-semibold text-slate-900">Quality {formatQualityRate(grade.rate)}</span>
                  {grade.showInterval ? ` (${formatRange(grade)})` : ""}
                  {" · "}Target ≥{(QUALITY_TARGETS.green * 100).toFixed(0)}%
                </>
              )}
            </p>
            <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
              {grade.n} leads · {t.qualifiedCalls} qualified · {t.sales} verified sales
            </p>
          </div>
        </div>
      </div>
    );
  }

  const rows = q.data ?? [];
  const counts = rows.reduce((acc, r) => { acc[r.verdict]++; return acc; }, { critical: 0, warning: 0, good: 0 });
  const portfolioStatus: "critical" | "warning" | "good" = counts.critical ? "critical" : counts.warning ? "warning" : "good";
  const [portfolioTextCls, portfolioDotCls] = statusClasses(portfolioStatus).split(" ");

  return (
    <div className={cn(CARD_CHROME, "p-3 h-full flex flex-col")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-900">Portfolio Verdict</h3>
          <Tooltip><TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.portfolioVerdict}</TooltipContent></Tooltip>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <Pill icon={<AlertOctagon className="size-3" />} tone="critical" count={counts.critical} label="critical" />
          <Pill icon={<AlertTriangle className="size-3" />} tone="warning"  count={counts.warning}  label="warning" />
          <Pill icon={<CheckCircle2 className="size-3" />}  tone="good"     count={counts.good}     label="good" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className={cn("size-2.5 rounded-full", portfolioDotCls)} />
        <div className={cn("text-[30px] font-medium leading-none capitalize", portfolioTextCls)}>{portfolioStatus}</div>
      </div>
      <p className="mt-1 text-[12px] text-slate-600 leading-snug">
        {counts.critical} critical · {counts.warning} warning · {counts.good} good — judged on quality rate (target ≥{(QUALITY_TARGETS.green * 100).toFixed(0)}% green · ≥{(QUALITY_TARGETS.amber * 100).toFixed(0)}% amber).
      </p>
      <div className="mt-2 flex-1 overflow-y-auto -mr-1 pr-1">
        {q.isLoading ? (
          <div className="text-[11px] text-slate-400 py-2">Computing rollup…</div>
        ) : rows.length === 0 ? (
          <div className="text-[11px] text-slate-400 py-2">No location-level metrics in this window.</div>
        ) : (
          <ul className="space-y-1">
            {rows.slice(0, 6).map((r) => (
              <li key={r.property_id}>
                <button
                  type="button"
                  onClick={() => {
                    setScope({ mode: "property", propertyId: r.property_id });
                    navigate("/command");
                  }}
                  className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Dot tone={r.verdict} />
                    <span className="text-[12px] font-semibold text-slate-900 truncate">{r.name}</span>
                    <span className="text-[11px] text-slate-500 truncate">· {r.reason}</span>
                  </div>
                  <ChevronRight className="size-3.5 text-slate-300 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Pill({ icon, tone, count, label }: { icon: React.ReactNode; tone: "critical" | "warning" | "good"; count: number; label: string }) {
  const cls = tone === "critical" ? "text-rose-600 bg-rose-50"
    : tone === "warning" ? "text-amber-600 bg-amber-50"
    : "text-emerald-600 bg-emerald-50";
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold", cls)}>
      {icon}{count} <span className="font-normal opacity-70">{label}</span>
    </span>
  );
}
function Dot({ tone }: { tone: "critical" | "warning" | "good" }) {
  const cls = tone === "critical" ? "bg-rose-500" : tone === "warning" ? "bg-amber-500" : "bg-emerald-500";
  return <span className={cn("inline-block size-2 rounded-full shrink-0", cls)} />;
}

function ScoreGauge({ score, stroke, word, wordCls }: { score: number | null; stroke: string; word: string; wordCls: string }) {
  const size = 120;
  const r = 48;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const dash = c * pct;
  return (
    <div className="shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={12} strokeDasharray={score == null ? "4 4" : undefined} />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-slate-900" style={{ fontSize: 30, fontWeight: 500 }}>
          {score == null ? "—" : score}
        </text>
        <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle" className="fill-slate-400" style={{ fontSize: 10 }}>
          /100
        </text>
      </svg>
      <div className={cn("-mt-2 text-center text-[11px] font-semibold uppercase tracking-wide", wordCls)}>{word}</div>
    </div>
  );
}