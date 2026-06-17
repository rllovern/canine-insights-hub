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
}: {
  label: string;
  value: ReactNode;
  current: number;
  prior: number;
  series: { date: string; v: number }[];
  invertDelta?: boolean;
  compareLabel?: string;
}) {
  const delta = pctChange(current, prior);
  const positive = invertDelta ? delta < 0 : delta >= 0;
  const hasData = series.some((p) => p.v > 0);
  const gid = `g-${label.replace(/\s/g, "")}`;
  const showDelta = prior > 0 || current > 0;
  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
      <div className="px-5 pt-5 pb-2">
        <div className="text-[12px] font-medium text-slate-500">{label}</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="text-[26px] font-bold tabular-nums tracking-tight text-slate-900 leading-none">{value}</div>
          {showDelta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                positive ? "text-emerald-600" : "text-rose-600",
              )}
            >
              {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
        {compareLabel && <div className="mt-1 text-[11px] text-slate-400">{compareLabel}</div>}
      </div>
      <div className="h-12 mt-1">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="#6366f1"
                strokeWidth={1.5}
                fill={`url(#${gid})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full" />
        )}
      </div>
    </div>
  );
}