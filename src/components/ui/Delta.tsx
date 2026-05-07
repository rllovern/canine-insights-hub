import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/lib/metrics";

export function Delta({ value, invert = false, className }: { value: number; invert?: boolean; className?: string }) {
  const positive = value > 0.05;
  const negative = value < -0.05;
  const good = invert ? negative : positive;
  const bad = invert ? positive : negative;
  const Icon = positive ? ArrowUp : negative ? ArrowDown : Minus;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
      good && "text-success",
      bad && "text-destructive",
      !good && !bad && "text-muted-foreground",
      className
    )}>
      <Icon className="size-3" />
      {fmtPct(Math.abs(value))}
    </span>
  );
}
