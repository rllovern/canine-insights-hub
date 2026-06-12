import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { fmtDate } from "@/lib/metrics";

interface DualAxisProps {
  data: any[];
  leftKey: string;
  leftLabel: string;
  leftColor?: string;
  leftFmt?: (n: number) => string;
  rightKey: string;
  rightLabel: string;
  rightColor?: string;
  rightFmt?: (n: number) => string;
  height?: number;
  leftPrevKey?: string;
  rightPrevKey?: string;
  showCompare?: boolean;
}

const tickStyle = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 8px 24px -12px hsl(var(--foreground) / 0.18)",
  padding: "8px 12px",
};
const cursorStyle = { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.6 };

export function DualAxisChart({
  data, leftKey, leftLabel, leftColor = "hsl(var(--chart-2))", leftFmt = (n) => String(n),
  rightKey, rightLabel, rightColor = "hsl(var(--chart-1))", rightFmt = (n) => String(n),
  height = 220, leftPrevKey, rightPrevKey, showCompare = false,
}: DualAxisProps) {
  const showLeftPrev = showCompare && !!leftPrevKey;
  const showRightPrev = showCompare && !!rightPrevKey;
  const leftPrevLabel = `${leftLabel} (prev)`;
  const rightPrevLabel = `${rightLabel} (prev)`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} axisLine={false} tickLine={false} minTickGap={20} padding={{ left: 8, right: 8 }} />
        <YAxis yAxisId="left" tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={(v) => leftFmt(v)} width={56} domain={[0, 'auto']} />
        <YAxis yAxisId="right" orientation="right" tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={(v) => rightFmt(v)} width={56} domain={[0, 'auto']} />
        <Tooltip
          cursor={cursorStyle}
          contentStyle={tooltipStyle}
          labelStyle={{ fontWeight: 600, marginBottom: 2 }}
          labelFormatter={(l) => fmtDate(l as string)}
          formatter={(v: any, name: string) => {
            if (name === leftLabel) return [leftFmt(Number(v)), leftLabel];
            if (name === rightLabel) return [rightFmt(Number(v)), rightLabel];
            if (name === leftPrevLabel) return [leftFmt(Number(v)), leftPrevLabel];
            if (name === rightPrevLabel) return [rightFmt(Number(v)), rightPrevLabel];
            return [v, name];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        {showLeftPrev && (
          <Line yAxisId="left" type="monotone" dataKey={leftPrevKey!} name={leftPrevLabel} stroke={leftColor} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
        )}
        {showRightPrev && (
          <Line yAxisId="right" type="monotone" dataKey={rightPrevKey!} name={rightPrevLabel} stroke={rightColor} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
        )}
        <Line yAxisId="left" type="monotone" dataKey={leftKey} name={leftLabel} stroke={leftColor} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
        <Line yAxisId="right" type="monotone" dataKey={rightKey} name={rightLabel} stroke={rightColor} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
