import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/metrics";
import type { SpeedData } from "@/components/lead-perf/hooks";
import type { Totals } from "./useCommandData";

function Header({ title, href, tip }: { title: string; href?: string; tip?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {tip && (
          <Tooltip>
            <TooltipTrigger><Info className="size-3.5 text-muted-foreground/60" /></TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {href && <Link to={href} className="text-[11px] text-primary hover:underline">View Details</Link>}
    </div>
  );
}

function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "success" | "warn" | "danger" }) {
  const colorMap = {
    primary: "bg-primary",
    success: "bg-emerald-500",
    warn: "bg-amber-500",
    danger: "bg-rose-500",
  } as const;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full", colorMap[tone])} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Call Handling — we don't have answer/abandon data from CTM yet. */
export function CallHandlingCard() {
  return (
    <Card className="p-5">
      <Header title="Call Handling Performance" href="/calls" tip="Answer rate, response time, abandon rate. Requires CTM agent-level call disposition data." />
      <div className="mt-8 flex flex-col items-center justify-center text-center py-6 gap-2">
        <div className="text-xs text-muted-foreground">Answer rate, average response time, and abandon rate are not yet wired.</div>
        <div className="text-[11px] text-muted-foreground/70">CTM call disposition fields (answered / abandoned / time-to-answer) need to be ingested.</div>
      </div>
    </Card>
  );
}

/** Missed-call follow-up — uses lead_perf_speed where possible. */
export function MissedCallFollowUpCard({ speed, totals }: { speed: SpeedData | null; totals: Totals }) {
  // We don't have a direct "missed call" metric, so use never_responded as proxy.
  const missed = speed?.never_responded ?? 0;
  const total = speed?.total_leads ?? 0;
  const missedPct = total ? (missed / total) * 100 : 0;
  const u5 = speed?.pct_under_5m ?? 0;
  const u15 = speed?.pct_under_15m ?? 0;
  const never = speed?.pct_never_responded ?? 0;
  return (
    <Card className="p-5">
      <Header title="Missed Call Follow-Up" href="/lead-performance" tip="Of leads that didn't get an immediate response, how quickly was a follow-up attempted." />
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 items-center">
        <div>
          <div className="text-[11px] text-muted-foreground">Missed / Never responded</div>
          <div className="text-2xl font-bold tabular-nums">{fmtNumber(missed)}</div>
        </div>
        <div className="text-[11px] text-muted-foreground text-right">
          {total ? `${missedPct.toFixed(1)}% of ${fmtNumber(total)} leads` : "—"}
        </div>
      </div>
      <div className="mt-5 space-y-3">
        <FollowRow label="Responded < 5 min" pct={u5} goal={60} />
        <FollowRow label="Responded < 15 min" pct={u15} goal={80} />
        <FollowRow label="Never responded" pct={never} goal={10} invert />
      </div>
      {!speed && <div className="mt-4 text-[11px] text-muted-foreground/70">No response data in window.</div>}
    </Card>
  );
}

function FollowRow({ label, pct, goal, invert }: { label: string; pct: number; goal: number; invert?: boolean }) {
  const hitting = invert ? pct <= goal : pct >= goal;
  const tone: "success" | "warn" | "danger" = hitting ? "success" : pct === 0 ? "danger" : "warn";
  return (
    <div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">{pct.toFixed(1)}%</span>
      </div>
      <Bar pct={pct} tone={tone} />
      <div className="mt-0.5 text-[10.5px] text-muted-foreground/80">Goal: {invert ? "<" : ">"} {goal}%</div>
    </div>
  );
}

/** Call Quality (AI Score) — we have lead-quality buckets, not AI scores. */
export function CallQualityCard({ buckets }: { buckets: Record<string, number> }) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (!total) {
    return (
      <Card className="p-5">
        <Header title="Call Quality (AI Score)" href="/calls" tip="AI-scored quality across calls. Requires CTM AI Insights." />
        <div className="mt-8 flex flex-col items-center justify-center text-center py-6 gap-2">
          <div className="text-xs text-muted-foreground">No call quality data yet.</div>
          <div className="text-[11px] text-muted-foreground/70">Connect CTM AI Insights to score calls Excellent / Good / Average / Poor.</div>
        </div>
      </Card>
    );
  }
  // Map lead-quality buckets onto excellent/good/average/poor for display.
  const map: Record<string, { label: string; tone: string }> = {
    projected_sale: { label: "Excellent (projected sale)", tone: "bg-emerald-500" },
    good:           { label: "Good (qualified)",            tone: "bg-blue-500" },
    bad:            { label: "Average",                     tone: "bg-amber-500" },
    spam:           { label: "Poor (spam / non-lead)",      tone: "bg-rose-500" },
    no_entry:       { label: "Unscored",                    tone: "bg-muted-foreground/40" },
    unscored:       { label: "Unscored",                    tone: "bg-muted-foreground/40" },
  };
  const rows = Object.entries(buckets)
    .map(([k, n]) => ({ key: k, n, info: map[k] ?? { label: k, tone: "bg-muted-foreground/40" } }))
    .sort((a, b) => b.n - a.n);
  // simple 0-5 "average score": projected_sale=5, good=4, bad=2.5, spam=1
  const wMap: Record<string, number> = { projected_sale: 5, good: 4, bad: 2.5, spam: 1 };
  let num = 0, den = 0;
  for (const r of rows) { if (wMap[r.key] != null) { num += wMap[r.key] * r.n; den += r.n; } }
  const avg = den ? num / den : 0;

  // donut
  const c = 2 * Math.PI * 48;
  let acc = 0;
  const segs = rows.filter(r => r.n > 0).map((r) => {
    const frac = r.n / total;
    const dash = `${frac * c} ${c}`;
    const off  = -acc;
    acc += frac * c;
    return { ...r, dash, off };
  });
  const colorByKey: Record<string, string> = {
    projected_sale: "hsl(142 71% 45%)",
    good: "hsl(217 91% 60%)",
    bad: "hsl(38 92% 50%)",
    spam: "hsl(0 84% 60%)",
    no_entry: "hsl(var(--muted-foreground))",
    unscored: "hsl(var(--muted-foreground))",
  };
  return (
    <Card className="p-5">
      <Header title="Call Quality (AI Score)" href="/calls" tip="Distribution of CTM call-score buckets across the period." />
      <div className="mt-3 flex items-center gap-4">
        <div className="relative size-28 shrink-0">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r="48" stroke="hsl(var(--muted))" strokeWidth="14" fill="none" />
            {segs.map((s) => (
              <circle key={s.key}
                cx="60" cy="60" r="48" fill="none" strokeWidth="14"
                stroke={colorByKey[s.key] ?? "hsl(var(--muted-foreground))"}
                strokeDasharray={s.dash} strokeDashoffset={s.off}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-2xl font-bold tabular-nums">{avg ? avg.toFixed(1) : "—"}</div>
            <div className="text-[10px] text-muted-foreground">/5.0 avg</div>
          </div>
        </div>
        <div className="flex-1 space-y-1 text-[11.5px] min-w-0">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full shrink-0" style={{ background: colorByKey[r.key] ?? "hsl(var(--muted-foreground))" }} />
              <span className="truncate flex-1">{r.info.label}</span>
              <span className="tabular-nums text-muted-foreground">{((r.n / total) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}