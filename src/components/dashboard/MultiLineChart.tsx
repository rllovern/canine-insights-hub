import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { fmtDate, SOURCE_COLORS } from "@/lib/metrics";

interface Props {
  data: any[];
  sources: string[];
  fmt?: (n: number) => string;
  height?: number;
}

const tickStyle = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

export function MultiLineChart({ data, sources, fmt = (n) => String(n), height = 220 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} width={56} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(l) => fmtDate(l as string)}
          formatter={(v: any, name: any) => [fmt(Number(v)), name]}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        {sources.map((s) => (
          <Line key={s} type="monotone" dataKey={s} name={s} stroke={SOURCE_COLORS[s] ?? "hsl(var(--chart-7))"} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SingleLineChart({ data, dataKey, label, color = "hsl(var(--chart-1))", fmt = (n) => String(n), height = 220 }: {
  data: any[]; dataKey: string; label: string; color?: string; fmt?: (n: number) => string; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} width={56} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(l) => fmtDate(l as string)}
          formatter={(v: any) => [fmt(Number(v)), label]}
        />
        <Line type="monotone" dataKey={dataKey} name={label} stroke={color} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
