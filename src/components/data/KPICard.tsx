import { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: string;
  icon?: ReactNode;
}

export function KPICard({ label, value, delta, hint, icon }: KPICardProps) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-foreground">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta !== undefined && delta !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium ring-1 ring-inset",
              positive
                ? "bg-success/10 text-success ring-success/20"
                : "bg-destructive/10 text-destructive ring-destructive/20",
            )}
          >
            {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}