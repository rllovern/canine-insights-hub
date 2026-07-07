import { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Info, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { safeDelta } from "@/lib/metrics";
import { format as fmtDate, parseISO } from "date-fns";
import { CARD_CHROME } from "./cardChrome";

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
  sourceTable,
  estimated,
  methodNote,
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
  /** e.g. "daily_metrics.cost" — surfaced in the info tooltip so every tile declares its attribution. */
  sourceTable?: string;
  /** When true, render a small "est." chip next to the label. */
  estimated?: boolean;
  /** Method-of-calculation note appended to the tooltip when estimated. */
  methodNote?: string;
}) {
  const d = safeDelta(current, prior);
  const hasData = series.some((p) => p.v > 0);
  const gid = `g-${label.replace(/\s/g, "")}`;
  const fmt = formatValue ?? ((n: number) => n.toLocaleString());

  let deltaNode: ReactNode = null;
  if (d.kind === "pct") {
    const positive = invertDelta ? d.value < 0 : d.value >= 0;
    deltaNode = (
      <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", positive ? "text-emerald-600" : "text-rose-600")}>
        {d.value >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {Math.abs(d.value).toFixed(1)}%
      </span>
    );
  } else if (d.kind === "low-sample") {
    const positive = invertDelta ? d.abs < 0 : d.abs >= 0;
    deltaNode = (
      <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", positive ? "text-emerald-600" : "text-rose-600")}>
        {d.abs >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {d.abs >= 0 ? "+" : ""}{fmt(Math.abs(d.abs))}
      </span>
    );
  } else {
    deltaNode = (
      <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-400">
        <Minus className="h-3 w-3" /> no prior data
      </span>
    );
  }

  const parts: string[] = [];
  if (tip) parts.push(tip);
  if (methodNote) parts.push(`Method: ${methodNote}`);
  if (sourceTable) parts.push(`Source: ${sourceTable}`);
  const tipContent = parts.length ? parts.join("\n\n") : undefined;

  return (
    <div className={cn(CARD_CHROME, "hover:shadow-md transition-shadow overflow-hidden flex flex-col min-h-[112px]")}>
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <span className="truncate">{label}</span>
          {estimated && (
            <span className="inline-flex items-center rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">est.</span>
          )}
          {tipContent && (
            <Tooltip>
              <TooltipTrigger asChild><button type="button" className="inline-flex"><Info className="size-3 text-slate-400" /></button></TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-snug whitespace-pre-line">{tipContent}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <div className="text-[22px] font-bold tabular-nums tracking-tight text-slate-900 leading-none">{value}</div>
          {deltaNode}
        </div>
        {compareLabel && <div className="mt-0.5 text-[10px] text-slate-400 truncate">{compareLabel}</div>}
      </div>
      <div className="h-12 mt-auto w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={[0, "auto"]} />
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
                fill="transparent"
                isAnimationActive={false}
                connectNulls
                dot={false}
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