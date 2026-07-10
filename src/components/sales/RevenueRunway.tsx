import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  LabelList,
} from "recharts";
import { eachDayOfInterval, format, differenceInCalendarDays } from "date-fns";
import { Info } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface RunwayMetrics {
  fullPeriodTarget: number;
  actualToDate: number;
  targetPaceToDate: number;
  variance: number;
  currentDailyPace: number;
  requiredDailyPace: number;
  projectedFinish: number;
  remainingRevenue: number;
  elapsedDays: number;
  remainingDays: number;
  periodDays: number;
  isPast: boolean;
  availableGoodLeads: number;
  projectedAdditionalWins: number;
  expectedAdditionalRevenue: number;
  avgDealValue: number;
  closeRate: number;
}

interface Props {
  periodStart: Date;
  periodEnd: Date;
  byDayRevenue: Record<string, number>;
  fullPeriodTarget: number | null;
  availableGoodLeads: number;
  avgDealValue: number;
  closeRate: number;
  onMetrics?: (m: RunwayMetrics) => void;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
function compactMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n))}`;
}

function useCountUp(value: number, duration = 600) {
  const [n, setN] = useState(value);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return n;
}

export function RevenueRunway({ periodStart, periodEnd, byDayRevenue, fullPeriodTarget, availableGoodLeads, avgDealValue, closeRate, onMetrics }: Props) {
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const currentDate = today < periodEnd ? today : periodEnd;
  const todayKey = iso(currentDate);

  const days = useMemo(() => eachDayOfInterval({ start: periodStart, end: periodEnd }), [periodStart, periodEnd]);
  const periodDays = days.length;
  const elapsedDays = Math.max(1, differenceInCalendarDays(currentDate, periodStart) + 1);
  const remainingDays = Math.max(0, differenceInCalendarDays(periodEnd, currentDate));
  const isPast = currentDate >= periodEnd;

  const expectedAdditionalRevenue = Math.max(0, availableGoodLeads * closeRate * avgDealValue);
  const projectedAdditionalWins = Math.max(0, availableGoodLeads * closeRate);

  const { chartData, actualToDate } = useMemo(() => {
    let cum = 0;
    let actualToDate = 0;
    const rows: Array<{ date: string; actual: number | null; target: number; projected: number | null }> = [];
    const targetPerDay = fullPeriodTarget != null ? fullPeriodTarget / periodDays : 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const key = iso(d);
      const isFuture = d > currentDate;
      if (!isFuture) {
        cum += byDayRevenue[key] ?? 0;
        actualToDate = cum;
      }
      rows.push({
        date: key,
        actual: isFuture ? null : cum,
        target: fullPeriodTarget != null ? targetPerDay * (i + 1) : 0,
        projected: null,
      });
    }
    // Projected series: starts at the last actual point and ends exactly at the
    // pipeline-backed projected finish, distributed evenly across remaining
    // days. This is a visual shape; the endpoint is what matters.
    if (!isPast && remainingDays > 0) {
      const startIdx = rows.findIndex((r) => r.date === todayKey);
      if (startIdx >= 0) {
        const perDay = expectedAdditionalRevenue / remainingDays;
        for (let i = startIdx; i < rows.length; i++) {
          const step = i - startIdx;
          rows[i].projected = actualToDate + perDay * step;
        }
      }
    }
    return { chartData: rows, actualToDate };
  }, [days, byDayRevenue, fullPeriodTarget, currentDate, periodDays, remainingDays, isPast, todayKey, expectedAdditionalRevenue]);

  const metrics: RunwayMetrics = useMemo(() => {
    const target = fullPeriodTarget ?? 0;
    const targetPaceToDate = target * (elapsedDays / periodDays);
    const currentDailyPace = actualToDate / elapsedDays;
    const projectedFinish = actualToDate + expectedAdditionalRevenue;
    const remainingRevenue = Math.max(0, target - actualToDate);
    const requiredDailyPace = remainingDays > 0 ? remainingRevenue / remainingDays : 0;
    return {
      fullPeriodTarget: target,
      actualToDate,
      targetPaceToDate,
      variance: actualToDate - targetPaceToDate,
      currentDailyPace,
      requiredDailyPace,
      projectedFinish,
      remainingRevenue,
      elapsedDays,
      remainingDays,
      periodDays,
      isPast,
      availableGoodLeads,
      projectedAdditionalWins,
      expectedAdditionalRevenue,
      avgDealValue,
      closeRate,
    };
  }, [actualToDate, elapsedDays, remainingDays, periodDays, isPast, fullPeriodTarget, availableGoodLeads, projectedAdditionalWins, expectedAdditionalRevenue, avgDealValue, closeRate]);

  useEffect(() => { onMetrics?.(metrics); }, [metrics, onMetrics]);

  const animActual = useCountUp(metrics.actualToDate);
  const animPace = useCountUp(metrics.targetPaceToDate);
  const animVar = useCountUp(metrics.variance);
  const animProj = useCountUp(metrics.projectedFinish);

  const hasTarget = fullPeriodTarget != null && fullPeriodTarget > 0;
  const pctToPace = hasTarget && metrics.targetPaceToDate > 0 ? (metrics.actualToDate / metrics.targetPaceToDate) * 100 : 0;

  // Endpoint label renderer (only on last point of the series)
  const endpointLabel = (fill: string, prefix: string, dataKey: "actual" | "target" | "projected") => (props: any) => {
    const { x, y, index, value } = props;
    if (value == null) return null;
    // Only render on the last point for that dataKey
    let lastIdx = -1;
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i][dataKey] != null) { lastIdx = i; break; }
    }
    if (index !== lastIdx) return null;
    return (
      <g>
        <rect x={x + 6} y={y - 9} rx={4} ry={4} height={18} width={compactMoney(Number(value)).length * 7 + prefix.length * 6 + 12} fill="hsl(var(--card))" stroke={fill} opacity={0.95} />
        <text x={x + 12} y={y + 4} fontSize={11} fill={fill} fontWeight={600}>
          {prefix} {compactMoney(Number(value))}
        </text>
      </g>
    );
  };

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi label="Closed revenue" value={currency.format(animActual)} tone="primary" />
        <Kpi label="Target pace today" value={hasTarget ? currency.format(animPace) : "—"} />
        <Kpi
          label={metrics.variance >= 0 ? "Ahead of pace" : "Behind pace"}
          value={hasTarget ? `${metrics.variance >= 0 ? "+" : "−"}${currency.format(Math.abs(animVar))}` : "—"}
          tone={hasTarget ? (metrics.variance >= 0 ? "up" : "down") : "muted"}
        />
        <Kpi
          label="Projected finish"
          value={!isPast ? currency.format(animProj) : currency.format(metrics.actualToDate)}
          info={
            <>
              <div className="font-medium mb-1">Projected finish</div>
              <div>Closed revenue plus the probability-weighted value of currently available good leads. Good leads use a {(closeRate * 100).toFixed(0)}% default close rate (configurable per organization). Closed, lost, disqualified, duplicate, spam, and inactive leads are excluded.</div>
              <div className="mt-2 tabular-nums">
                {currency.format(actualToDate)} closed<br />
                + {currency.format(expectedAdditionalRevenue)} expected from {availableGoodLeads} good leads at {(closeRate * 100).toFixed(0)}%
              </div>
            </>
          }
        />
      </div>
      {hasTarget && (
        <div className="-mt-2 text-[11px] text-muted-foreground tabular-nums">
          {pctToPace.toFixed(0)}% of target pace · 90-day pace target: {currency.format(metrics.fullPeriodTarget)} · Day {elapsedDays} of {periodDays}
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 12, right: 84, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="runway-actual-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tickFormatter={(v) => { try { return format(new Date(v), "MMM d"); } catch { return v; } }}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => compactMoney(Number(v))}
            width={64}
          />
          <Tooltip
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3", opacity: 0.5 }}
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 10,
              fontSize: 12,
              boxShadow: "0 8px 24px -12px hsl(var(--foreground) / 0.18)",
              padding: "8px 12px",
            }}
            labelFormatter={(l) => { try { return format(new Date(l as string), "EEE, MMM d, yyyy"); } catch { return String(l); } }}
            formatter={(v: any, name: any) => {
              if (v == null) return ["—", name];
              return [currency.format(Number(v)), name];
            }}
          />

          {/* Reference lines */}
          {!isPast && (
            <ReferenceLine
              x={todayKey}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              label={{ value: "Today", position: "top", fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            />
          )}

          {/* Actual area + line */}
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="hsl(var(--primary))"
            strokeWidth={2.4}
            fill="url(#runway-actual-fill)"
            connectNulls={false}
            animationDuration={800}
            isAnimationActive
          >
            <LabelList dataKey="actual" content={endpointLabel("hsl(var(--primary))", "Actual", "actual") as any} />
          </Area>

          {/* Target pace */}
          {hasTarget && (
            <Line
              type="linear"
              dataKey="target"
              name="Target pace"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive
              animationDuration={800}
            >
              <LabelList dataKey="target" content={endpointLabel("hsl(var(--muted-foreground))", "Target", "target") as any} />
            </Line>
          )}

          {/* Projected */}
          {!isPast && (
            <Line
              type="linear"
              dataKey="projected"
              name="Projected"
              stroke="hsl(var(--primary))"
              strokeOpacity={0.6}
              strokeDasharray="2 4"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive
              animationDuration={800}
            >
              <LabelList dataKey="projected" content={endpointLabel("hsl(var(--primary))", "Projected", "projected") as any} />
            </Line>
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Forecast inputs */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums border-t border-border pt-3">
        <span><span className="text-foreground font-medium">{availableGoodLeads}</span> available good leads</span>
        <span aria-hidden>·</span>
        <span><span className="text-foreground font-medium">{(closeRate * 100).toFixed(0)}%</span> assumed close rate</span>
        <span aria-hidden>·</span>
        <span><span className="text-foreground font-medium">{Math.round(projectedAdditionalWins)}</span> projected wins</span>
        <span aria-hidden>·</span>
        <span><span className="text-foreground font-medium">{currency.format(avgDealValue)}</span> average deal value</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone = "muted", info }: { label: string; value: string; tone?: "primary" | "muted" | "up" | "down"; info?: React.ReactNode }) {
  const color =
    tone === "primary" ? "text-foreground" :
    tone === "up" ? "text-emerald-500" :
    tone === "down" ? "text-rose-500" :
    "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {label}
        {info && (
          <TooltipProvider delayDuration={100}>
            <UITooltip>
              <TooltipTrigger asChild>
                <button type="button" className="inline-flex text-muted-foreground/70 hover:text-foreground" aria-label="More info">
                  <Info className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">{info}</TooltipContent>
            </UITooltip>
          </TooltipProvider>
        )}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}