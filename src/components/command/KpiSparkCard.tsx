import { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { pctChange } from "@/lib/metrics";

export function KpiSparkCard({
  label,
  value,
  current,
  prior,
  series,
  invertDelta,
  compareLabel,
  icon,
}: {
  label: string;
  value: ReactNode;
  current: number;
  prior: number;
  series: { date: string; v: number }[];
  invertDelta?: boolean;
  compareLabel?: string;
  icon?: ReactNode;
}) {
  const delta = pctChange(current, prior);
  const positive = invertDelta ? delta < 0 : delta >= 0;
  const hasData = series.some((p) => p.v > 0);
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</div>
        {prior > 0 || current > 0 ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
              positive
                ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20"
                : "bg-rose-500/10 text-rose-600 ring-rose-500/20",
            )}
          >
            {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : null}
      </div>
      {compareLabel && <div className="mt-0.5 text-[10.5px] text-muted-foreground">{compareLabel}</div>}
      <div className="mt-2 h-12">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`g-${label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                fill={`url(#g-${label.replace(/\s/g, "")})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full rounded-md bg-muted/30" />
        )}
      </div>
    </div>
  );
}