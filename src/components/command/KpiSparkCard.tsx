import { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { pctChange } from "@/lib/metrics";
import { format as fmtDate, parseISO } from "date-fns";

export function KpiSparkCard({
  label,
  value,
  current,
  prior,
  series,
  invertDelta,
  compareLabel,
  tip,
  formatValue,
}: {
  label: string;
  value: ReactNode;
  current: number;
  prior: number;
  series: { date: string; v: number }[];
  invertDelta?: boolean;
  compareLabel?: string;
  tip?: string;
  formatValue?: (n: number) => string;
}) {
  const delta = pctChange(current, prior);
  const positive = invertDelta ? delta < 0 : delta >= 0;
  const hasData = series.some((p) => p.v > 0);
  const gid = `g-${label.replace(/\s/g, "")}`;
  const showDelta = prior > 0 || current > 0;
  const fmt = formatValue ?? ((n: number) => n.toLocaleString());
  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <span className="truncate">{label}</span>
          {tip && (
            <Tooltip>
              <TooltipTrigger asChild><button type="button" className="inline-flex"><Info className="size-3 text-slate-400" /></button></TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-snug">{tip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <div className="text-[22px] font-bold tabular-nums tracking-tight text-slate-900 leading-none">{value}</div>
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
        {compareLabel && <div className="mt-0.5 text-[10px] text-slate-400 truncate">{compareLabel}</div>}
      </div>
      <div className="h-12 mt-auto w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <RTooltip
                cursor={{ stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "6px 8px",
                  fontSize: 11,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
                labelFormatter={(d: string) => {
                  try { return fmtDate(parseISO(d), "MMM d, yyyy"); } catch { return d; }
                }}
                formatter={(v: number) => [fmt(Number(v)), label]}
              />
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