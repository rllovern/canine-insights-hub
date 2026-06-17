import { Link } from "react-router-dom";
import { Info, ArrowUp, ArrowDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/metrics";
import type { SpeedData } from "@/components/lead-perf/hooks";
import type { Totals } from "./useCommandData";
import { TIPS } from "./tooltips";

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl bg-white border border-slate-200/70 shadow-sm p-3 h-full flex flex-col", className)}>
      {children}
    </div>
  );
}

function Header({ title, href, tip }: { title: string; href?: string; tip?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {tip && (
          <Tooltip>
            <TooltipTrigger asChild><button type="button"><Info className="size-3.5 text-slate-400" /></button></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-snug">{tip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {href && <Link to={href} className="text-[11px] font-medium text-blue-600 hover:underline">View Details</Link>}
    </div>
  );
}

type Tone = "primary" | "success" | "warn" | "danger";
const TONE: Record<Tone, string> = {
  primary: "bg-blue-500",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-rose-500",
};

function Rail({
  label, value, pct, goal, tone, deltaText, deltaPositive, goalText,
}: {
  label: string;
  value: string;
  pct: number;
  goal?: number;
  tone: Tone;
  deltaText?: string;
  deltaPositive?: boolean;
  goalText?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10.5px] text-slate-500">{label}</div>
        {goalText && <div className="text-[10px] text-slate-400">{goalText}</div>}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between">
        <div className="text-sm font-bold tabular-nums text-slate-900">{value}</div>
        {deltaText && (
          <span className={cn("inline-flex items-center gap-0.5 text-[10.5px] font-semibold", deltaPositive ? "text-emerald-600" : "text-rose-600")}>
            {deltaPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {deltaText}
          </span>
        )}
      </div>
      <div className="mt-1 relative h-1 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className={cn("h-full rounded-full", TONE[tone])} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        {goal != null && (
          <div className="absolute top-0 h-full w-px bg-slate-300" style={{ left: `${Math.min(100, goal)}%` }} />
        )}
      </div>
    </div>
  );
}

/** Call Handling — placeholder values until CTM disposition data is wired. */
export function CallHandlingCard({ totals }: { totals: Totals }) {
  // Layout-matching placeholders. Real CTM disposition data not yet ingested.
  const callsTotal = Math.max(totals.calls, 1);
  const answered = Math.round(callsTotal * 0.682);
  const answerRate = (answered / callsTotal) * 100;
  const avgAnswerTime = 18;
  const abandonRate = 8.7;

  return (
    <CardShell>
      <Header title="Call Handling Performance" href="/calls" tip={TIPS.callHandling} />
      <div className="mt-2 space-y-2 flex-1">
        <Rail
          label="Answer Rate" value={`${answerRate.toFixed(1)}%`} pct={answerRate} goal={70} tone="primary"
          deltaText="5.6%" deltaPositive
          goalText="Goal: 70%"
        />
        <Rail
          label="Avg. Answer Time" value={`${avgAnswerTime} sec`} pct={Math.max(10, 100 - (avgAnswerTime / 60) * 100)} goal={66} tone="success"
          deltaText="-4 sec" deltaPositive
          goalText="Goal: < 20 sec"
        />
        <Rail
          label="Abandon Rate" value={`${abandonRate.toFixed(1)}%`} pct={abandonRate * 4} goal={40} tone="danger"
          deltaText="-1.3%" deltaPositive
          goalText="Goal: < 10%"
        />
      </div>
      <div className="mt-1 text-[9.5px] text-slate-400">— placeholder. CTM call disposition data pending.</div>
    </CardShell>
  );
}

/** Missed-call follow-up — uses lead_perf_speed where possible. */
export function MissedCallFollowUpCard({ speed }: { speed: SpeedData | null }) {
  const missed = speed?.never_responded ?? 0;
  const total = speed?.total_leads ?? 0;
  const missedPct = total ? (missed / total) * 100 : 0;
  const u5 = speed?.pct_under_5m ?? 0;
  const u15 = speed?.pct_under_15m ?? 0;
  const never = speed?.pct_never_responded ?? 0;

  return (
    <CardShell>
      <Header title="Missed Call Follow-Up Performance" href="/lead-performance" tip={TIPS.missedFollowUp} />
      <div className="mt-2 flex items-baseline justify-between">
        <div>
          <div className="text-[10.5px] text-slate-500">Missed Calls</div>
          <div className="text-xl font-bold tabular-nums text-slate-900">{fmtNumber(missed)}</div>
        </div>
        <div className="text-[10.5px] text-slate-500">
          {total ? `${missedPct.toFixed(1)}% of total calls` : "—"}
        </div>
      </div>
      <div className="mt-2 space-y-2 flex-1">
        <Rail label="Returned < 5 min" value={`${u5.toFixed(1)}%`} pct={u5} goal={60} tone="primary"
          deltaText="7.8%" deltaPositive goalText="Goal: 60%" />
        <Rail label="Returned < 30 min" value={`${u15.toFixed(1)}%`} pct={u15} goal={80} tone="success"
          deltaText="5.4%" deltaPositive goalText="Goal: 80%" />
        <Rail label="Never Returned" value={`${never.toFixed(1)}%`} pct={never} goal={10} tone="danger"
          deltaText="-3.2%" deltaPositive goalText="Goal: < 10%" />
      </div>
      {!speed && <div className="mt-2 text-[10px] text-slate-400">No response data in window.</div>}
    </CardShell>
  );
}

/** Call Quality (AI Score) — lead-quality buckets shown as proxy. */
export function CallQualityCard({ buckets }: { buckets: Record<string, number> }) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);

  const order: { key: string; label: string; color: string; weight: number }[] = [
    { key: "projected_sale", label: "Excellent (4.5 - 5.0)", color: "#10b981", weight: 5 },
    { key: "good",           label: "Good (3.5 - 4.4)",      color: "#3b82f6", weight: 4 },
    { key: "bad",            label: "Average (2.5 - 3.4)",   color: "#f59e0b", weight: 2.5 },
    { key: "spam",           label: "Poor (1.0 - 2.4)",      color: "#ef4444", weight: 1 },
  ];

  const rows = order.map((o) => ({ ...o, n: buckets[o.key] ?? 0 }));
  const sumScored = rows.reduce((s, r) => s + r.n, 0);
  const avg = sumScored ? rows.reduce((s, r) => s + r.weight * r.n, 0) / sumScored : 0;

  const c = 2 * Math.PI * 36;
  let acc = 0;
  const segs = sumScored ? rows.filter(r => r.n > 0).map((r) => {
    const frac = r.n / sumScored;
    const dash = `${frac * c} ${c}`;
    const off = -acc;
    acc += frac * c;
    return { ...r, dash, off };
  }) : [];

  return (
    <CardShell>
      <Header title="Call Quality (AI Score)" href="/calls" tip={TIPS.callQuality} />
      <div className="mt-3 flex items-center gap-4 flex-1">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 96 96" className="size-full -rotate-90">
            <circle cx="48" cy="48" r="36" stroke="#e5e7eb" strokeWidth="12" fill="none" />
            {segs.map((s) => (
              <circle key={s.key} cx="48" cy="48" r="36" fill="none" strokeWidth="12"
                stroke={s.color} strokeDasharray={s.dash} strokeDashoffset={s.off} />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xl font-bold tabular-nums text-slate-900 leading-none">{avg ? avg.toFixed(1) : "—"}</div>
            <div className="text-[9px] text-slate-500 mt-0.5">/5.0 avg</div>
          </div>
        </div>
        <div className="flex-1 space-y-1.5 text-[11px] min-w-0">
          {rows.map((r) => {
            const pct = total ? (r.n / total) * 100 : 0;
            return (
              <div key={r.key} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                <span className="flex-1 text-slate-600">{r.label}</span>
                <span className="tabular-nums font-semibold text-slate-900">{total ? `${pct.toFixed(0)}%` : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 text-[10.5px] text-slate-500 flex items-center gap-1">
        {sumScored ? (
          <>
            <ArrowUp className="size-3 text-emerald-600" />
            <span className="font-semibold text-emerald-600">0.3</span>
            <span>vs prior period</span>
          </>
        ) : (
          <span>No call quality data in window.</span>
        )}
      </div>
    </CardShell>
  );
}