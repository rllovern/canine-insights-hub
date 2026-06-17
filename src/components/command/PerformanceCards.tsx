import { Link } from "react-router-dom";
import { Info, ArrowUp, ArrowDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Totals } from "./useCommandData";
import { TIPS } from "./tooltips";
import { CARD_CHROME } from "./cardChrome";

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(CARD_CHROME, "p-2.5 h-full flex flex-col", className)}>
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

function PendingBody({ reason }: { reason: string }) {
  return (
    <>
      <div className="mt-2 flex items-center justify-between rounded-md border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">Pending</span>
        <span className="text-[10.5px] text-slate-400">No confident figures</span>
      </div>
      <div className="mt-2 flex-1 flex items-start gap-2 text-[12px] text-slate-500 leading-snug">
        <Info className="size-3.5 text-slate-400 shrink-0 mt-0.5" />
        <span>{reason}</span>
      </div>
    </>
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
  void totals;
  return (
    <CardShell>
      <Header title="Call Handling Performance" href="/calls" tip={TIPS.callHandling} />
      <PendingBody reason="CTM call-disposition feed is not yet ingested, so answer rate, pickup time, and abandon rate can't be shown honestly. This card will populate automatically once the disposition feed lands." />
    </CardShell>
  );
}

/** Missed-call follow-up — pending until the CTM disposition feed is ingested. */
export function MissedCallFollowUpCard() {
  return (
    <CardShell>
      <Header title="Missed Call Follow-Up Performance" href="/lead-performance" tip={TIPS.missedFollowUp} />
      <PendingBody reason="Missed-call counts and return status come from the same un-ingested CTM call-disposition feed as call handling. They will populate together once that feed lands; until then no missed-call numbers render as confident figures." />
    </CardShell>
  );
}

/** Call Quality (AI Score) — pending until the CTM disposition/scoring feed is ingested. */
export function CallQualityCard() {
  return (
    <CardShell>
      <Header title="Call Quality (AI Score)" href="/calls" tip={TIPS.callQuality} />
      <PendingBody reason="AI score, scored-call counts, and score distribution depend on the same un-ingested CTM disposition/scoring feed. This card stays pending until that source is verified, so no proxy bucket is presented as a real score." />
    </CardShell>
  );
}