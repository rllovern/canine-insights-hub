import { useMemo } from "react";
import { motion } from "motion/react";
import {
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  format,
  differenceInCalendarWeeks,
  getDay,
} from "date-fns";

interface DayStat { count: number; revenue: number }

interface Props {
  from: Date;
  to: Date;
  byDay: Record<string, DayStat>;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function bucket(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

// Uses primary token with escalating opacity for a single-hue ramp.
const BUCKET_STYLE = [
  "bg-muted/40",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function SalesHeatmap({ from, to, byDay }: Props) {
  const { weeks, monthLabels } = useMemo(() => {
    const gridStart = startOfWeek(from, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(to, { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const weekCount = differenceInCalendarWeeks(gridEnd, gridStart, { weekStartsOn: 0 }) + 1;

    // weeks[col][row] = date | null
    const weeks: (Date | null)[][] = Array.from({ length: weekCount }, () => Array(7).fill(null));
    for (const d of days) {
      const col = differenceInCalendarWeeks(d, gridStart, { weekStartsOn: 0 });
      const row = getDay(d);
      const inRange = d >= new Date(from.getFullYear(), from.getMonth(), from.getDate()) && d <= to;
      weeks[col][row] = inRange ? d : null;
    }

    // Month labels above the first column of each new month
    const monthLabels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    weeks.forEach((col, i) => {
      const first = col.find((d) => d);
      if (!first) return;
      if (first.getMonth() !== lastMonth) {
        monthLabels.push({ col: i, label: format(first, "MMM") });
        lastMonth = first.getMonth();
      }
    });
    return { weeks, monthLabels };
  }, [from, to]);

  const totalWeeks = weeks.length;
  // Cell + gap sizing tuned to keep it dense but readable
  const CELL = 14;
  const GAP = 3;

  return (
    <div className="w-full">
      <div className="flex gap-2">
        {/* Weekday labels */}
        <div className="flex flex-col justify-between pt-5 text-[10px] text-muted-foreground select-none">
          {WEEKDAYS.map((w, i) => (
            <div key={i} style={{ height: CELL }} className="leading-none">
              {i % 2 === 1 ? w : ""}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-x-auto">
          {/* Month labels row */}
          <div className="relative h-4 mb-1" style={{ width: totalWeeks * (CELL + GAP) }}>
            {monthLabels.map((m) => (
              <div
                key={`${m.col}-${m.label}`}
                className="absolute text-[10px] text-muted-foreground"
                style={{ left: m.col * (CELL + GAP) }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((col, ci) => (
              <div key={ci} className="flex flex-col" style={{ gap: GAP }}>
                {col.map((d, ri) => {
                  if (!d) {
                    return <div key={ri} style={{ width: CELL, height: CELL }} />;
                  }
                  const key = format(d, "yyyy-MM-dd");
                  const stat = byDay[key] ?? { count: 0, revenue: 0 };
                  const b = bucket(stat.count);
                  const label = `${format(d, "MMM d, yyyy")} · ${stat.count} sale${stat.count === 1 ? "" : "s"}${stat.revenue ? ` · ${currency.format(stat.revenue)}` : ""}`;
                  return (
                    <motion.div
                      key={ri}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: (ci + ri) * 0.008, duration: 0.25, ease: "easeOut" }}
                      whileHover={{ scale: 1.18 }}
                      title={label}
                      className={`rounded-[3px] cursor-default ring-0 hover:ring-2 hover:ring-primary/60 ${BUCKET_STYLE[b]}`}
                      style={{ width: CELL, height: CELL }}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Less</span>
            {BUCKET_STYLE.map((cls, i) => (
              <span key={i} className={`rounded-[3px] ${cls}`} style={{ width: 12, height: 12 }} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}