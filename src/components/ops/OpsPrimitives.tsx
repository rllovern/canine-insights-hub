// Small, reusable presentational pieces for Marketing Ops. No data fetching.
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { Readiness, SopStatus } from "@/lib/mops/readiness";
import { READINESS_META, STATUS_META, STATUS_ORDER } from "./statusMeta";

export function StatusIcon({ status, className }: { status: SopStatus; className?: string }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return <Icon className={cn("h-4 w-4 shrink-0", m.text, className)} aria-label={m.label} />;
}

export function StatusPill({ status, compact, className }: { status: SopStatus; compact?: boolean; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
      m.text, m.bg, m.ring, m.dashed && "ring-0 outline-dashed outline-1 outline-ops-unknown/60", status === "not_applicable" && "line-through decoration-ops-na/60", className)}>
      <StatusIcon status={status} className="h-3.5 w-3.5" />
      {!compact && m.label}
    </span>
  );
}

export function StatusSelect({ value, onChange, disabled }: { value: SopStatus; onChange: (s: SopStatus) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SopStatus)} disabled={disabled}>
      <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-0 shadow-none focus:ring-0 [&>svg]:opacity-40" aria-label="Change status" onClick={(e) => e.stopPropagation()}>
        <StatusPill status={value} />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}><span className="flex items-center gap-2"><StatusIcon status={s} />{STATUS_META[s].label}</span></SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function ReadinessBadge({ readiness, className }: { readiness: Readiness; className?: string }) {
  const m = READINESS_META[readiness];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", m.text, m.bg, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />{m.label}
    </span>
  );
}

/** Ring showing verified share. `null` = nothing applicable (renders a muted dash, never a full ring). */
export function ProgressRing({ value, size = 56, stroke = 5, tone = "verified", label }: { value: number | null; size?: number; stroke?: number; tone?: "verified" | "blocked" | "access"; label?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value));
  const color = tone === "blocked" ? "stroke-ops-blocked" : tone === "access" ? "stroke-ops-access" : "stroke-ops-verified";
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? (value == null ? "Nothing applicable" : `${Math.round(pct * 100)}% verified`)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-ops-track" />
        {value != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className={cn(color, "transition-[stroke-dashoffset] duration-700")} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />}
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums text-foreground">{value == null ? "—" : `${Math.round(pct * 100)}%`}</span>
    </div>
  );
}

/** Thin segmented bar: verified / in motion / blocked / remaining. */
export function SegmentBar({ counts, total, className }: { counts: Partial<Record<SopStatus, number>>; total: number; className?: string }) {
  if (!total) return <div className={cn("h-1.5 rounded-full bg-ops-track", className)} />;
  const seg = (n: number | undefined) => `${((n ?? 0) / total) * 100}%`;
  const moving = (counts.in_progress ?? 0) + (counts.awaiting_verification ?? 0);
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-ops-track", className)}>
      <div className="bg-ops-verified" style={{ width: seg(counts.verified) }} />
      <div className="bg-ops-progress/70" style={{ width: seg(moving) }} />
      <div className="bg-ops-access/80" style={{ width: seg(counts.awaiting_access) }} />
      <div className="bg-ops-blocked" style={{ width: seg(counts.blocked) }} />
    </div>
  );
}

export function OpsCard({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border/70 bg-card shadow-[var(--ops-shadow)]", className)} {...rest}>{children}</div>;
}
