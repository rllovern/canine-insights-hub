import { ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AreaSummary } from "@/lib/mops/readiness";
import { AREA_META } from "./statusMeta";
import { ProgressRing, SegmentBar } from "./OpsPrimitives";

/** `calm`: existing client not yet assessed — only real "Blocked" statuses are emphasized. */
export function AreaCard({ s, topBlocker, onOpen, active, calm }: { s: AreaSummary; topBlocker?: string; onOpen: () => void; active?: boolean; calm?: boolean }) {
  const m = AREA_META[s.area];
  const Icon = m.icon;
  const hot = calm ? (s.counts.blocked ?? 0) > 0 : s.blockers > 0;
  const n = calm ? (s.counts.blocked ?? 0) : s.blockers;
  const done = s.applicable > 0 && s.verified === s.applicable;
  return (
    <button
      onClick={onOpen}
      className={cn(
        "group relative flex w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-[var(--ops-shadow)] transition-all hover:-translate-y-0.5 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        hot ? "border-ops-blocked/40" : "border-border/70",
        active && "ring-2 ring-primary/40",
      )}
    >
      {hot && <span className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-ops-blocked" />}
      <div className="flex items-start gap-3">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", done ? "bg-ops-verified/10 text-ops-verified" : hot ? "bg-ops-blocked/10 text-ops-blocked" : "bg-muted text-foreground/70")}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">{m.label}</div>
          <div className="text-xs text-muted-foreground">{m.blurb}</div>
        </div>
        <ProgressRing value={s.completion} size={44} stroke={4} />
      </div>
      <SegmentBar counts={s.counts} total={s.applicable} />
      <div className="flex items-center justify-between text-xs">
        <span className="tabular-nums text-muted-foreground">{s.applicable ? `${s.verified} of ${s.applicable} verified` : "Nothing applicable"}{s.unknown ? ` · ${s.unknown} unknown` : ""}</span>
        {hot ? (
          <span className="flex items-center gap-1 font-medium text-ops-blocked"><AlertTriangle className="h-3.5 w-3.5" />{n} blocker{n > 1 ? "s" : ""}</span>
        ) : calm && s.criticalOpen > 0 ? (
          <span className="text-muted-foreground">{s.criticalOpen} critical not tracked</span>
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        )}
      </div>
      {hot && topBlocker && <div className="truncate text-xs text-foreground/80">{topBlocker}</div>}
    </button>
  );
}
