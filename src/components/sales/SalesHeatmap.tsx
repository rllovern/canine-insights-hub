import { useMemo, useState, useRef, useEffect, KeyboardEvent, MouseEvent } from "react";
import { motion } from "motion/react";
import {
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  format,
  getDay,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  isSameDay,
  isWithinInterval,
} from "date-fns";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SaleRecord } from "@/lib/verified-sales";
import { SalesDayDrawer } from "./SalesDayDrawer";

export type HeatmapMetric = "wins" | "revenue";

interface Props {
  from: Date;
  to: Date;
  rows: SaleRecord[];
  metric: HeatmapMetric;
  onMetricChange: (m: HeatmapMetric) => void;
}

interface DayStat {
  date: Date;
  key: string;
  count: number;
  revenue: number;
  records: SaleRecord[];
}

// ─── Formatting ───────────────────────────────────────────────────────────
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function compactMoney(n: number): string {
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

function metricLabel(m: HeatmapMetric): string {
  return m === "wins" ? "Won deals" : "Closed revenue";
}

function metricNoun(m: HeatmapMetric, n: number): string {
  if (m === "wins") return n === 1 ? "deal" : "deals";
  return "";
}

function fmtMetric(m: HeatmapMetric, v: number): string {
  return m === "wins" ? String(v) : compactMoney(v);
}

// ─── Intensity ────────────────────────────────────────────────────────────
// Returns bucket 0..4 for a value, given the current thresholds
interface Thresholds { edges: number[]; labels: string[]; description: string }

function buildThresholds(m: HeatmapMetric, stats: DayStat[]): Thresholds {
  if (m === "wins") {
    return {
      edges: [1, 2, 3, 5], // v>=edges[i] → bucket i+1
      labels: ["0", "1", "2", "3–4", "5+"],
      description: "Won deals per day",
    };
  }
  const nonzero = stats.map((s) => s.revenue).filter((v) => v > 0).sort((a, b) => a - b);
  if (nonzero.length < 4) {
    return {
      edges: [1, 5000, 10000, 20000],
      labels: ["$0", "<$5K", "$5–10K", "$10–20K", "$20K+"],
      description: "Closed revenue per day",
    };
  }
  const q = (p: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * p))];
  const p25 = q(0.25), p50 = q(0.5), p75 = q(0.75);
  const edges = [0.01, p25, p50, p75];
  return {
    edges,
    labels: [
      "$0",
      `<${compactMoney(p25)}`,
      `${compactMoney(p25)}–${compactMoney(p50)}`,
      `${compactMoney(p50)}–${compactMoney(p75)}`,
      `>${compactMoney(p75)}`,
    ],
    description: "Closed revenue per day",
  };
}

function bucketOf(value: number, t: Thresholds): number {
  if (value <= 0) return 0;
  let b = 0;
  for (let i = 0; i < t.edges.length; i++) if (value >= t.edges[i]) b = i + 1;
  return b;
}

const BUCKET_BG = [
  "bg-primary/[0.06]",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

const BUCKET_TEXT = [
  "text-muted-foreground",
  "text-foreground",
  "text-foreground",
  "text-primary-foreground",
  "text-primary-foreground",
] as const;

// ─── Aggregate ────────────────────────────────────────────────────────────
function useAggregate(from: Date, to: Date, rows: SaleRecord[]) {
  return useMemo(() => {
    const map = new Map<string, DayStat>();
    const days = eachDayOfInterval({ start: from, end: to });
    for (const d of days) {
      const key = format(d, "yyyy-MM-dd");
      map.set(key, { date: d, key, count: 0, revenue: 0, records: [] });
    }
    for (const r of rows ?? []) {
      if (!r.won_at) continue;
      const key = r.won_at.slice(0, 10);
      const s = map.get(key);
      if (!s) continue;
      s.count += 1;
      s.revenue += r.amount ?? 0;
      s.records.push(r);
    }
    return { stats: Array.from(map.values()), byKey: map, days };
  }, [from, to, rows]);
}

// ─── Summary + Insight ────────────────────────────────────────────────────
function summarize(stats: DayStat[], metric: HeatmapMetric) {
  const total = stats.reduce((s, d) => s + (metric === "wins" ? d.count : d.revenue), 0);
  const activeCount = stats.filter((d) => (metric === "wins" ? d.count : d.revenue) > 0).length;
  const best = stats.reduce<DayStat | null>((best, d) => {
    const v = metric === "wins" ? d.count : d.revenue;
    if (!best) return v > 0 ? d : null;
    const bv = metric === "wins" ? best.count : best.revenue;
    return v > bv ? d : best;
  }, null);
  const avg = stats.length ? total / stats.length : 0;
  return { total, activeCount, best, avg, days: stats.length };
}

function insightText(stats: DayStat[], metric: HeatmapMetric): string | null {
  if (stats.length === 0) return null;
  const values = stats.map((s) => (metric === "wins" ? s.count : s.revenue));
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return `No ${metric === "wins" ? "won deals" : "revenue"} recorded in this range.`;

  // Concentration: top 20% of days that hold most of total
  const sorted = [...values].sort((a, b) => b - a);
  const topN = Math.max(1, Math.ceil(stats.length * 0.2));
  const topSum = sorted.slice(0, topN).reduce((a, b) => a + b, 0);
  const pct = Math.round((topSum / total) * 100);
  if (pct >= 50 && stats.length >= 5) {
    return `${pct}% of ${metric === "wins" ? "wins" : "revenue"} came from just ${topN} day${topN === 1 ? "" : "s"}.`;
  }

  // Best weekday
  if (stats.length >= 14) {
    const byWd: number[][] = Array.from({ length: 7 }, () => []);
    for (const s of stats) byWd[getDay(s.date)].push(metric === "wins" ? s.count : s.revenue);
    const avgs = byWd.map((arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0));
    const bestIdx = avgs.indexOf(Math.max(...avgs));
    const bestVal = avgs[bestIdx];
    if (bestVal > 0) {
      const name = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][bestIdx];
      return metric === "wins"
        ? `${name} is the strongest closing day, averaging ${bestVal.toFixed(1)} wins.`
        : `${name} is the strongest closing day, averaging ${compactMoney(bestVal)}.`;
    }
  }

  // Drought
  const zeros = stats.filter((s) => (metric === "wins" ? s.count : s.revenue) === 0).length;
  if (zeros / stats.length >= 0.4) {
    return `${zeros} of the last ${stats.length} days produced no ${metric === "wins" ? "won deals" : "revenue"}.`;
  }
  return null;
}

// ─── Legend + Header ──────────────────────────────────────────────────────
function Legend({ thresholds }: { thresholds: Thresholds }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{thresholds.description}:</span>
      {thresholds.labels.map((lab, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-[3px] border border-border ${BUCKET_BG[i]}`} />
          <span>{lab}</span>
        </span>
      ))}
    </div>
  );
}

function SummaryRow({ stats, metric }: { stats: DayStat[]; metric: HeatmapMetric }) {
  const s = summarize(stats, metric);
  const totalStr = metric === "wins" ? `${s.total} won deals` : `${currency.format(s.total)} closed`;
  const activeStr = `Active days: ${s.activeCount} of ${s.days}`;
  const bestStr = s.best
    ? (metric === "wins"
        ? `Best day: ${format(s.best.date, "MMM d")} · ${s.best.count} ${s.best.count === 1 ? "win" : "wins"}`
        : `Best day: ${format(s.best.date, "MMM d")} · ${compactMoney(s.best.revenue)}`)
    : "Best day: —";
  const avgStr = metric === "wins"
    ? `Avg: ${s.avg.toFixed(1)}/day`
    : `Avg: ${compactMoney(s.avg)}/day`;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="text-sm font-semibold text-foreground tabular-nums">{totalStr}</span>
      <span className="tabular-nums">{activeStr}</span>
      <span className="tabular-nums">{bestStr}</span>
      <span className="tabular-nums">{avgStr}</span>
    </div>
  );
}

// ─── Shared cell wrapper (tooltip + interaction) ──────────────────────────
interface CellShellProps {
  stat: DayStat;
  metric: HeatmapMetric;
  onOpen: (d: Date) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

function CellShell({ stat, metric, onOpen, children, className, style }: CellShellProps) {
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(stat.date);
    }
  };
  const primaryText = metric === "wins"
    ? `${stat.count} won deal${stat.count === 1 ? "" : "s"}`
    : currency.format(stat.revenue);
  const label = `${format(stat.date, "EEEE, MMMM d, yyyy")}. ${primaryText}. ${
    metric === "wins" ? currency.format(stat.revenue) + " in closed revenue" : `${stat.count} won deal${stat.count === 1 ? "" : "s"}`
  }.`;
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-label={label}
          onClick={() => onOpen(stat.date)}
          onKeyDown={handleKey}
          className={`outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background hover:ring-2 hover:ring-primary/60 cursor-pointer ${className ?? ""}`}
          style={style}
        >
          {children}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-64 p-3 text-sm">
        <div className="font-semibold">{format(stat.date, "EEEE, MMM d")}</div>
        <div className="mt-2 space-y-1 text-xs">
          <Row label={metricLabel(metric)} value={metric === "wins" ? String(stat.count) : currency.format(stat.revenue)} emphasized />
          <Row label={metric === "wins" ? "Closed revenue" : "Won deals"} value={metric === "wins" ? currency.format(stat.revenue) : String(stat.count)} />
          <Row label="Average deal" value={stat.count > 0 ? currency.format(stat.revenue / stat.count) : "—"} />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function Row({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${emphasized ? "font-semibold text-foreground" : ""}`}>{value}</span>
    </div>
  );
}

// ─── Month view (7–31 days) ───────────────────────────────────────────────
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function MonthView({ from, to, byKey, metric, onOpen, thresholds }: {
  from: Date; to: Date; byKey: Map<string, DayStat>; metric: HeatmapMetric;
  onOpen: (d: Date) => void; thresholds: Thresholds;
}) {
  // Build a single-month calendar. If range spans multiple months, show a
  // stacked list of month calendars.
  const months = useMemo(() => {
    const list: Date[] = [];
    let cursor = startOfMonth(from);
    const last = startOfMonth(to);
    while (cursor <= last) {
      list.push(cursor);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return list;
  }, [from, to]);

  return (
    <div className="space-y-6">
      {months.map((m) => (
        <MonthGrid
          key={m.toISOString()}
          month={m}
          from={from}
          to={to}
          byKey={byKey}
          metric={metric}
          onOpen={onOpen}
          thresholds={thresholds}
          showTitle={months.length > 1}
        />
      ))}
    </div>
  );
}

function MonthGrid({ month, from, to, byKey, metric, onOpen, thresholds, showTitle }: {
  month: Date; from: Date; to: Date; byKey: Map<string, DayStat>; metric: HeatmapMetric;
  onOpen: (d: Date) => void; thresholds: Thresholds; showTitle: boolean;
}) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const monthNum = month.getMonth();

  return (
    <div>
      {showTitle && (
        <div className="mb-2 text-sm font-semibold text-foreground">{format(month, "MMMM yyyy")}</div>
      )}
      <div className="grid grid-cols-7 gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {WEEKDAY_LABELS.map((w) => <div key={w} className="px-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === monthNum;
          const inRange = isWithinInterval(d, { start: from, end: to });
          const key = format(d, "yyyy-MM-dd");
          const stat = byKey.get(key);

          if (!inMonth || !inRange || !stat) {
            return (
              <div
                key={i}
                className="min-h-[64px] rounded-md border border-dashed border-border/50 bg-muted/10 text-muted-foreground/40 p-1.5 text-[11px]"
              >
                {inMonth ? format(d, "d") : ""}
              </div>
            );
          }

          const value = metric === "wins" ? stat.count : stat.revenue;
          const b = bucketOf(value, thresholds);
          const isZero = value === 0;

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.01, duration: 0.25 }}
            >
              <CellShell
                stat={stat}
                metric={metric}
                onOpen={onOpen}
                className={`min-h-[64px] rounded-md p-1.5 flex flex-col justify-between ${
                  isZero
                    ? "border border-border bg-muted/20"
                    : `${BUCKET_BG[b]} ${b >= 3 ? "" : "border border-border/40"}`
                }`}
              >
                <div className={`text-sm font-medium leading-none ${b >= 3 && !isZero ? BUCKET_TEXT[b] : "text-muted-foreground"}`}>
                  {format(d, "d")}
                </div>
                <div className={`text-right font-semibold tabular-nums leading-tight ${
                  isZero ? "text-muted-foreground/60 text-[11px]" : `${BUCKET_TEXT[b]} text-xs`
                }`}>
                  {isZero ? "0" : (
                    <>
                      <div>{fmtMetric(metric, value)}</div>
                      {metric === "wins" && (
                        <div className={`text-[10px] font-normal ${b >= 3 ? "opacity-80" : "text-muted-foreground"}`}>
                          {metricNoun(metric, value)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CellShell>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Contribution grid (weeks × weekdays) ─────────────────────────────────
function ContributionGrid({ from, to, stats, byKey, metric, onOpen, thresholds, cellClamp }: {
  from: Date; to: Date; stats: DayStat[]; byKey: Map<string, DayStat>; metric: HeatmapMetric;
  onOpen: (d: Date) => void; thresholds: Thresholds; cellClamp: [number, number];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(cellClamp[1]);

  const gridStart = startOfWeek(from, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(to, { weekStartsOn: 0 });
  const weekCount = differenceInCalendarWeeks(gridEnd, gridStart, { weekStartsOn: 0 }) + 1;

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const compute = () => {
      const w = el.clientWidth;
      const leftLabels = 28;
      const gap = 3;
      const avail = w - leftLabels - 8;
      const size = Math.floor((avail - (weekCount - 1) * gap) / weekCount);
      setCellSize(Math.max(cellClamp[0], Math.min(cellClamp[1], size)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weekCount, cellClamp]);

  const GAP = 3;
  const weeks: (DayStat | null)[][] = Array.from({ length: weekCount }, () => Array(7).fill(null));
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let ci = 0; ci < weekCount; ci++) {
    for (let ri = 0; ri < 7; ri++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + ci * 7 + ri);
      if (d < from || d > to) continue;
      const key = format(d, "yyyy-MM-dd");
      const stat = byKey.get(key);
      if (!stat) continue;
      weeks[ci][ri] = stat;
      if (ri === 0 && d.getMonth() !== lastMonth) {
        monthLabels.push({ col: ci, label: format(d, "MMM") });
        lastMonth = d.getMonth();
      }
    }
  }

  return (
    <div ref={containerRef} className="w-full flex justify-center">
      <div>
        {/* Month labels */}
        <div className="relative mb-1 h-4" style={{ marginLeft: 28, width: weekCount * (cellSize + GAP) }}>
          {monthLabels.map((m) => (
            <div key={`${m.col}-${m.label}`} className="absolute text-[10px] text-muted-foreground" style={{ left: m.col * (cellSize + GAP) }}>
              {m.label}
            </div>
          ))}
        </div>
        <div className="flex gap-1">
          {/* Weekday labels */}
          <div className="flex flex-col text-[10px] text-muted-foreground" style={{ gap: GAP, width: 24 }}>
            {["", "Mon", "", "Wed", "", "Fri", ""].map((w, i) => (
              <div key={i} style={{ height: cellSize, lineHeight: `${cellSize}px` }}>{w}</div>
            ))}
          </div>
          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((col, ci) => (
              <div key={ci} className="flex flex-col" style={{ gap: GAP }}>
                {col.map((stat, ri) => {
                  if (!stat) {
                    return <div key={ri} style={{ width: cellSize, height: cellSize }} />;
                  }
                  const value = metric === "wins" ? stat.count : stat.revenue;
                  const b = bucketOf(value, thresholds);
                  const isZero = value === 0;
                  return (
                    <motion.div
                      key={ri}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: (ci + ri) * 0.006, duration: 0.2 }}
                    >
                      <CellShell
                        stat={stat}
                        metric={metric}
                        onOpen={onOpen}
                        className={`rounded-[3px] ${isZero ? "bg-muted/40 border border-border/40" : BUCKET_BG[b]}`}
                        style={{ width: cellSize, height: cellSize }}
                      >
                        <span className="sr-only">{format(stat.date, "MMM d")}</span>
                      </CellShell>
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────
export function SalesHeatmap({ from, to, rows, metric, onMetricChange }: Props) {
  const { stats, byKey } = useAggregate(from, to, rows);
  const thresholds = useMemo(() => buildThresholds(metric, stats), [metric, stats]);
  const insight = useMemo(() => insightText(stats, metric), [stats, metric]);
  const dayCount = differenceInCalendarDays(to, from) + 1;

  const mode: "month" | "weeks" | "annual" =
    dayCount <= 31 ? "month" : dayCount <= 120 ? "weeks" : "annual";

  // Drawer state + weekday averages for context
  const [openDate, setOpenDate] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const openDay = (d: Date) => { setOpenDate(d); setOpen(true); };

  const weekdayAverages = useMemo(() => {
    const wins = Array.from({ length: 7 }, () => ({ sum: 0, rev: 0, n: 0 }));
    for (const s of stats) {
      const w = getDay(s.date);
      wins[w].sum += s.count;
      wins[w].rev += s.revenue;
      wins[w].n += 1;
    }
    return wins.map((w) => ({
      wins: w.n ? w.sum / w.n : 0,
      revenue: w.n ? w.rev / w.n : 0,
    }));
  }, [stats]);

  const openStat = openDate ? stats.find((s) => isSameDay(s.date, openDate)) : null;
  const openAvg = openDate ? weekdayAverages[getDay(openDate)] : { wins: 0, revenue: 0 };

  return (
    <div className="space-y-4">
      {/* Header: metric switcher + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SummaryRow stats={stats} metric={metric} />
        <ToggleGroup
          type="single"
          size="sm"
          value={metric}
          onValueChange={(v) => v && onMetricChange(v as HeatmapMetric)}
          className="border border-border rounded-md"
        >
          <ToggleGroupItem value="wins" className="text-xs px-3">Won deals</ToggleGroupItem>
          <ToggleGroupItem value="revenue" className="text-xs px-3">Revenue</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Body */}
      <div className="min-h-[240px]">
        {mode === "month" && (
          <MonthView from={from} to={to} byKey={byKey} metric={metric} onOpen={openDay} thresholds={thresholds} />
        )}
        {mode === "weeks" && (
          <ContributionGrid from={from} to={to} stats={stats} byKey={byKey} metric={metric} onOpen={openDay} thresholds={thresholds} cellClamp={[12, 24]} />
        )}
        {mode === "annual" && (
          <ContributionGrid from={from} to={to} stats={stats} byKey={byKey} metric={metric} onOpen={openDay} thresholds={thresholds} cellClamp={[10, 14]} />
        )}
      </div>

      {/* Legend + insight */}
      <div className="space-y-2 border-t border-border pt-3">
        <Legend thresholds={thresholds} />
        {insight && <div className="text-xs text-foreground/80">{insight}</div>}
      </div>

      <SalesDayDrawer
        open={open}
        onOpenChange={setOpen}
        date={openDate}
        records={openStat?.records ?? []}
        weekdayAverage={openAvg.wins}
        weekdayAverageRevenue={openAvg.revenue}
      />
    </div>
  );
}