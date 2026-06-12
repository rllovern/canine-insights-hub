import { cn } from "@/lib/utils";

export type Status = "good" | "neutral" | "warn" | "bad" | "critical";

const LABEL: Record<Status, string> = {
  good: "Good",
  neutral: "Neutral",
  warn: "Warning",
  bad: "Poor",
  critical: "Critical",
};

const TONE: Record<Status, string> = {
  good:     "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  neutral:  "bg-muted text-muted-foreground border-border",
  warn:     "bg-amber-500/10  text-amber-700  dark:text-amber-300  border-amber-500/30",
  bad:      "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  critical: "bg-rose-500/10   text-rose-700   dark:text-rose-300   border-rose-500/40",
};

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-none",
      TONE[status],
    )}>
      <span className={cn("size-1.5 rounded-full",
        status === "good"     && "bg-emerald-500",
        status === "neutral"  && "bg-muted-foreground/50",
        status === "warn"     && "bg-amber-500",
        status === "bad"      && "bg-orange-500",
        status === "critical" && "bg-rose-500",
      )} />
      {label ?? LABEL[status]}
    </span>
  );
}