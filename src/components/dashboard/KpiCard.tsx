import { ReactNode } from "react";
import { Delta } from "@/components/ui/Delta";
import { cn } from "@/lib/utils";

interface KpiProps {
  label: string;
  value: ReactNode;
  delta?: number;
  invertDelta?: boolean;
  hint?: string;
  className?: string;
}

export function KpiCard({ label, value, delta, invertDelta, hint, className }: KpiProps) {
  return (
    <div className={cn("kpi-card overflow-hidden", className)}>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2 min-w-0">
        <div className="text-2xl font-bold tracking-tight tabular-nums truncate min-w-0">{value}</div>
        {typeof delta === "number" && (
          <div className="shrink-0"><Delta value={delta} invert={invertDelta} /></div>
        )}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
