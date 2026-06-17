import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, AlertOctagon, CheckCircle2, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScope } from "@/contexts/ScopeContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { rangeToISO, fmtCurrency } from "@/lib/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { TIPS } from "./tooltips";
import { cn } from "@/lib/utils";
import type { CommandTargets, Totals } from "./useCommandData";
import { DEFAULT_COMMAND_TARGETS } from "./useCommandData";

type Row = {
  property_id: string;
  name: string;
  spend: number;
  good_leads: number;
  calls: number;
  cpgl: number;
  qualRate: number;
  verdict: "critical" | "warning" | "good";
  reason: string;
};

const CPGL_TARGET = 400; // fallback agency benchmark until per-location targets are loaded here
const QUAL_RATE_TARGET = 0.45;

function judge(row: Omit<Row, "verdict" | "reason">): { verdict: Row["verdict"]; reason: string } {
  if (row.cpgl > CPGL_TARGET * 1.5) return { verdict: "critical", reason: `CPGL ${fmtCurrency(row.cpgl)} vs ${fmtCurrency(CPGL_TARGET)} target` };
  if (row.qualRate > 0 && row.qualRate < QUAL_RATE_TARGET * 0.6) return { verdict: "critical", reason: `Only ${(row.qualRate * 100).toFixed(0)}% qualified calls` };
  if (row.cpgl > CPGL_TARGET * 1.15) return { verdict: "warning", reason: `CPGL ${fmtCurrency(row.cpgl)} above target` };
  if (row.qualRate > 0 && row.qualRate < QUAL_RATE_TARGET) return { verdict: "warning", reason: `Qualified-call rate below ${(QUAL_RATE_TARGET * 100).toFixed(0)}%` };
  return { verdict: "good", reason: "On target" };
}

function statusClasses(verdict: "critical" | "warning" | "good") {
  return verdict === "critical" ? "text-rose-600 bg-rose-500"
    : verdict === "warning" ? "text-amber-600 bg-amber-500"
    : "text-emerald-600 bg-emerald-500";
}

function locationVerdict(totals: Totals, targets: CommandTargets) {
  const cpl = totals.calls ? totals.spend / totals.calls : 0;
  const cpgl = totals.qualifiedCalls ? totals.spend / totals.qualifiedCalls : 0;
  const qualRate = totals.calls ? totals.qualifiedCalls / totals.calls : 0;
  const projectionRate = totals.qualifiedCalls ? totals.appointments / totals.qualifiedCalls : 0;
  const pacingHealthy = targets.monthlyBudget == null || totals.spend <= targets.monthlyBudget;
  const issues = [
    cpl > 0 && cpl > targets.cpl ? { key: "CPL", critical: cpl > targets.cpl * 1.5, text: `CPL ${fmtCurrency(cpl)} is over the ${fmtCurrency(targets.cpl)} target` } : null,
    cpgl > 0 && cpgl > targets.cpgl ? { key: "CPGL", critical: cpgl > targets.cpgl * 1.5, text: `CPGL ${fmtCurrency(cpgl)} is over the ${fmtCurrency(targets.cpgl)} target` } : null,
    totals.calls > 0 && qualRate < targets.qualRate ? { key: "qual rate", critical: qualRate < targets.qualRate * 0.6, text: `Qualified call rate ${(qualRate * 100).toFixed(1)}% is below the ${(targets.qualRate * 100).toFixed(0)}% target` } : null,
    totals.qualifiedCalls > 0 && projectionRate < targets.projectionRate ? { key: "projection rate", critical: projectionRate < targets.projectionRate * 0.6, text: `Projection rate ${(projectionRate * 100).toFixed(1)}% is below the ${(targets.projectionRate * 100).toFixed(0)}% target` } : null,
    !pacingHealthy && targets.monthlyBudget ? { key: "pacing", critical: false, text: `Spend ${fmtCurrency(totals.spend)} is over the ${fmtCurrency(targets.monthlyBudget)} monthly pacing target` } : null,
  ].filter(Boolean) as { key: string; critical: boolean; text: string }[];
  const verdict = issues.some((i) => i.critical) ? "critical" : issues.length ? "warning" : "good";
  const healthy = ["CPL", "CPGL", "qual rate", "projection rate", "pacing"].filter((k) => !issues.some((i) => i.key === k));
  const reason = issues.length
    ? `${issues[0].text} — ${healthy.length ? `${healthy.join(", ")} ${healthy.length === 1 ? "is" : "are"} healthy.` : "no other target is offsetting it."}`
    : `CPL, CPGL, qual rate, projection rate, and pacing are healthy.`;
  return { verdict, reason } as const;
}

export function PortfolioVerdict({ totals, targets = DEFAULT_COMMAND_TARGETS }: { totals?: Totals; targets?: CommandTargets }) {
  const { propertyIds, mode, label } = useScope();
  const { range } = useDateRange();
  const iso = rangeToISO(range);

  const q = useQuery({
    queryKey: ["portfolio-verdict", propertyIds?.join(",") ?? "all", iso.from, iso.to],
    enabled: mode === "agency",
    queryFn: async (): Promise<Row[]> => {
      let dm = supabase
        .from("daily_metrics")
        .select("property_id, cost, good_leads, properties:properties!inner(name, is_active)")
        .gte("date", iso.from)
        .lte("date", iso.to);
      if (propertyIds) dm = dm.in("property_id", propertyIds);
      const { data, error } = await dm;
      if (error) throw error;

      const agg = new Map<string, { name: string; spend: number; good_leads: number; calls: number }>();
      for (const r of (data ?? []) as any[]) {
        const id = r.property_id as string;
        const cur = agg.get(id) ?? { name: r.properties?.name ?? id, spend: 0, good_leads: 0, calls: 0 };
        cur.spend += Number(r.cost ?? 0);
        cur.good_leads += Number(r.good_leads ?? 0);
        agg.set(id, cur);
      }

      // Calls per property (CTM)
      let cc = supabase.from("ctm_calls").select("property_id")
        .gte("called_at", `${iso.from}T00:00:00.000Z`)
        .lte("called_at", `${iso.to}T23:59:59.999Z`);
      if (propertyIds) cc = cc.in("property_id", propertyIds);
      const ccRes = await cc;
      if (!ccRes.error) {
        for (const c of (ccRes.data ?? []) as any[]) {
          const cur = agg.get(c.property_id);
          if (cur) cur.calls += 1;
        }
      }

      const rows: Row[] = [];
      for (const [property_id, v] of agg.entries()) {
        if (!v.spend && !v.good_leads && !v.calls) continue;
        const cpgl = v.good_leads ? v.spend / v.good_leads : Infinity;
        const qualRate = v.calls ? v.good_leads / v.calls : 0;
        const base = { property_id, name: v.name, spend: v.spend, good_leads: v.good_leads, calls: v.calls, cpgl, qualRate };
        const { verdict, reason } = judge(base);
        rows.push({ ...base, verdict, reason });
      }
      const order = { critical: 0, warning: 1, good: 2 } as const;
      rows.sort((a, b) => order[a.verdict] - order[b.verdict] || b.cpgl - a.cpgl);
      return rows;
    },
  });

  if (mode !== "agency") {
    const judged = locationVerdict(totals ?? { spend: 0, calls: 0, qualifiedCalls: 0, appointments: 0, revenue: 0, totalLeads: 0, good: 0, projected: 0, bad: 0, qualityRate: 0 }, targets);
    const [textCls, dotCls] = statusClasses(judged.verdict).split(" ");
    return (
      <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-3 h-full flex flex-col">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-900">Location Verdict</h3>
          <Tooltip><TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-snug">{TIPS.portfolioVerdict}</TooltipContent></Tooltip>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={cn("size-2.5 rounded-full", dotCls)} />
          <div className={cn("text-[30px] font-medium leading-none capitalize", textCls)}>{judged.verdict}</div>
        </div>
        <p className="mt-2 text-[12px] text-slate-600 leading-snug">
          <span className="font-semibold text-slate-900">{label}</span>: {judged.reason}
        </p>
      </div>
    );
  }

  const rows = q.data ?? [];
  const counts = rows.reduce((acc, r) => { acc[r.verdict]++; return acc; }, { critical: 0, warning: 0, good: 0 });
  const portfolioStatus: "critical" | "warning" | "good" = counts.critical ? "critical" : counts.warning ? "warning" : "good";
  const [portfolioTextCls, portfolioDotCls] = statusClasses(portfolioStatus).split(" ");

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-3 h-full flex flex-col">
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
        {counts.critical} critical · {counts.warning} warning · {counts.good} good — worst location decides the portfolio state.
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
                <Link to={`/property/${r.property_id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Dot tone={r.verdict} />
                    <span className="text-[12px] font-semibold text-slate-900 truncate">{r.name}</span>
                    <span className="text-[11px] text-slate-500 truncate">· {r.reason}</span>
                  </div>
                  <ChevronRight className="size-3.5 text-slate-300 shrink-0" />
                </Link>
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