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
}

const tickStyle = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

export function DualAxisChart({
  data, leftKey, leftLabel, leftColor = "hsl(var(--chart-2))", leftFmt = (n) => String(n),
  rightKey, rightLabel, rightColor = "hsl(var(--chart-1))", rightFmt = (n) => String(n),
  height = 220,
}: DualAxisProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis yAxisId="left" tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={(v) => leftFmt(v)} width={56} />
        <YAxis yAxisId="right" orientation="right" tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={(v) => rightFmt(v)} width={56} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(l) => fmtDate(l as string)}
          formatter={(v: any, name: string) => {
            if (name === leftLabel) return [leftFmt(Number(v)), leftLabel];
            if (name === rightLabel) return [rightFmt(Number(v)), rightLabel];
            return [v, name];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        <Line yAxisId="left" type="monotone" dataKey={leftKey} name={leftLabel} stroke={leftColor} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
        <Line yAxisId="right" type="monotone" dataKey={rightKey} name={rightLabel} stroke={rightColor} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
