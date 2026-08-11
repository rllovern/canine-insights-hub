import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct, deltaTone, DELTA_TONE_CLASS } from "@/lib/metrics";

export function Delta({ value, invert = false, className }: { value: number; invert?: boolean; className?: string }) {
  const positive = value > 0.05;
  const negative = value < -0.05;
  const Icon = positive ? ArrowUp : negative ? ArrowDown : Minus;
  const tone = !positive && !negative ? "neutral" : deltaTone(value, { invert });
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
      DELTA_TONE_CLASS[tone],
      className
    )}>
      <Icon className="size-3" />
      {fmtPct(Math.abs(value))}
    </span>
  );
}
