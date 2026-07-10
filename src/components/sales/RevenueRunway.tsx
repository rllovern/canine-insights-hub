import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { format } from "date-fns";

interface Point {
  date: string;
  actual: number;
  target: number | null;
}

interface Props {
  data: Point[];
  actualTotal: number;
  targetTotal: number | null;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function useCountUp(value: number, duration = 700) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const to = value;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return n;
}

export function RevenueRunway({ data, actualTotal, targetTotal }: Props) {
  const animActual = useCountUp(actualTotal);
  const animTarget = useCountUp(targetTotal ?? 0);
  const hasTarget = targetTotal != null && targetTotal > 0;
  const delta = hasTarget ? actualTotal - (targetTotal as number) : 0;
  const pct = hasTarget && (targetTotal as number) > 0 ? (actualTotal / (targetTotal as number)) * 100 : 0;

  const fmt = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : currency.format(v));

  return (
    <div className="w-full">
      <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Actual" value={currency.format(animActual)} tone="primary" />
        <Stat
          label="Target"
          value={hasTarget ? currency.format(animTarget) : "—"}
          tone="muted"
        />
        <Stat
          label="Delta"
          value={hasTarget ? `${delta >= 0 ? "+" : "−"}${currency.format(Math.abs(delta))}` : "—"}
          tone={hasTarget ? (delta >= 0 ? "up" : "down") : "muted"}
        />
        <Stat
          label="% to pace"
          value={hasTarget ? `${pct.toFixed(0)}%` : "—"}
          tone={hasTarget ? (pct >= 100 ? "up" : "down") : "muted"}
        />
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="runway-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
            tickFormatter={(v) => {
              try { return format(new Date(v), "MMM d"); } catch { return v; }
            }}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmt}
            width={56}
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
            labelFormatter={(l) => {
              try { return format(new Date(l as string), "MMM d, yyyy"); } catch { return String(l); }
            }}
            formatter={(v: any, name: any) => [currency.format(Number(v)), name]}
          />
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="hsl(var(--primary))"
            strokeWidth={2.4}
            fill="url(#runway-fill)"
            animationDuration={900}
            isAnimationActive
          />
          {hasTarget && (
            <Line
              type="monotone"
              dataKey="target"
              name="Target pace"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive
              animationDuration={900}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "primary" | "muted" | "up" | "down" }) {
  const color =
    tone === "primary" ? "text-foreground" :
    tone === "up" ? "text-emerald-500" :
    tone === "down" ? "text-rose-500" :
    "text-muted-foreground";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border border-border bg-muted/30 px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </motion.div>
  );
}