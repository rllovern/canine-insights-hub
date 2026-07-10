import { motion } from "motion/react";
import {
  ResponsiveContainer,
  Line,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Label,
  LabelList,
} from "recharts";
import { format } from "date-fns";
import { Info } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type {
  RunwaySeriesPoint,
  RevenueTargetResult,
  RevenueForecastResult,
} from "@/lib/verified-sales";

interface Props {
  data: RunwaySeriesPoint[];
  actualTotal: number;
  target: RevenueTargetResult;
  forecast: RevenueForecastResult;
  asOfDate: Date | null;
  isCustomRange: boolean;
  targetPeriodDays: number;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmt = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : currency.format(v));

export function RevenueRunway({ data, actualTotal, target, forecast, asOfDate, isCustomRange, targetPeriodDays }: Props) {
  const t = target.target;
  const hasTarget = t != null;
  const targetIsZero = t === 0;

  // Safeguard 1 — % to target never divides by zero, N/A on confirmed zero.
  const percentToTarget: number | null =
    t == null || t === 0 ? null : actualTotal / t;
  const percentDisplay: string =
    t == null ? "—" : t === 0 ? "N/A" : `${Math.round((percentToTarget as number) * 100)}%`;

  const showProjection =
    forecast.forecastMethod === "ctm_future_good_lead_pace" &&
    forecast.projectedFinish != null;

  // Day X of Y + calendar pace comparison
  const elapsed = forecast.remainingDays >= 0 ? targetPeriodDays - forecast.remainingDays : 0;
  const dayOfPeriod = asOfDate ? Math.max(1, Math.min(targetPeriodDays, elapsed)) : 0;
  const calendarPacePct = asOfDate && targetPeriodDays > 0 ? dayOfPeriod / targetPeriodDays : null;
  const paceDeltaPts =
    percentToTarget != null && calendarPacePct != null
      ? Math.round((percentToTarget - calendarPacePct) * 100)
      : null;
  const percentCaption = targetIsZero
    ? "No prior-period Good Leads"
    : asOfDate && dayOfPeriod > 0
      ? `Day ${dayOfPeriod} of ${targetPeriodDays}`
      : undefined;
  const paceLine =
    paceDeltaPts == null
      ? undefined
      : paceDeltaPts === 0
        ? "on calendar pace"
        : paceDeltaPts > 0
          ? `${paceDeltaPts} pts ahead of pace`
          : `${Math.abs(paceDeltaPts)} pts behind pace`;

  // Shortfall / surplus vs target for the projected-finish tile
  const shortfallCaption: string | undefined = (() => {
    if (!showProjection || t == null || t === 0) return forecastCaption(forecast);
    const gap = (forecast.projectedFinish as number) - t;
    if (Math.abs(gap) < 1) return "on target";
    return gap >= 0
      ? `${currency.format(gap)} above target`
      : `${currency.format(Math.abs(gap))} below target`;
  })();

  // Endpoint labels
  const lastActualPoint = [...data].reverse().find((d) => d.actual != null);
  const lastTargetPoint = hasTarget ? data[data.length - 1] : null;
  const lastProjectionPoint = showProjection
    ? [...data].reverse().find((d) => d.projection != null)
    : null;

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <MethodChip label={
          forecast.forecastMethod === "ctm_future_good_lead_pace"
            ? "Forecast based on Good Lead pace"
            : "Forecast unavailable"
        } />
        <TargetInfo target={target} />
        <ForecastInfo forecast={forecast} />
        {isCustomRange && (
          <span className="text-muted-foreground">Custom {targetPeriodDays}-day target period</span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Actual" value={currency.format(actualTotal)} tone="primary" />
        <Stat
          label={isCustomRange ? "Revenue Target" : "Monthly Target"}
          value={t == null ? "—" : currency.format(t)}
          tone="muted"
          caption={targetCaption(target)}
        />
        <Stat
          label="Projected finish"
          value={showProjection ? currency.format(forecast.projectedFinish as number) : "—"}
          tone={
            showProjection && t != null && t > 0
              ? (forecast.projectedFinish as number) >= t ? "up" : "down"
              : "muted"
          }
          caption={shortfallCaption}
        />
        <Stat
          label="% of target"
          value={percentDisplay}
          tone={
            t == null || t === 0
              ? "muted"
              : (percentToTarget as number) >= 1
                ? "up"
                : "down"
          }
          caption={percentCaption}
          subCaption={paceLine}
        />
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 16, right: 96, left: 0, bottom: 0 }}>
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
            formatter={(v: any, name: any) => (v == null ? ["—", name] : [currency.format(Number(v)), name])}
          />
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="hsl(var(--primary))"
            strokeWidth={2.4}
            fill="url(#runway-fill)"
            connectNulls={false}
            animationDuration={900}
            isAnimationActive
          >
            {lastActualPoint && (
              <LabelList
                dataKey="actual"
                position="top"
                content={(props: any) => {
                  const { x, y, value, index } = props;
                  if (value == null) return null;
                  const actualIdx = data.findIndex((d) => d === lastActualPoint);
                  if (index !== actualIdx) return null;
                  return (
                    <g>
                      <circle cx={x} cy={y} r={3.5} fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth={1.5} />
                      <text x={x + 6} y={y - 8} fill="hsl(var(--primary))" fontSize={11} fontWeight={600}>
                        Actual {fmt(Number(value))}
                      </text>
                    </g>
                  );
                }}
              />
            )}
          </Area>
          {hasTarget && (
            <Line
              type="monotone"
              dataKey="target"
              name="Target pace"
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity={0.45}
              strokeDasharray="6 6"
              strokeWidth={1.25}
              dot={false}
              isAnimationActive
              animationDuration={900}
            >
              {lastTargetPoint && t != null && (
                <LabelList
                  dataKey="target"
                  content={(props: any) => {
                    const { x, y, value, index } = props;
                    if (value == null || index !== data.length - 1) return null;
                    return (
                      <text x={x + 6} y={y + 4} fill="hsl(var(--muted-foreground))" fontSize={11} fontWeight={500}>
                        Target {fmt(Number(value))}
                      </text>
                    );
                  }}
                />
              )}
            </Line>
          )}
          {showProjection && (
            <Line
              type="monotone"
              dataKey="projection"
              name="Projected finish"
              stroke="hsl(var(--primary))"
              strokeOpacity={0.9}
              strokeDasharray="2 6"
              strokeWidth={2.25}
              dot={false}
              connectNulls={false}
              isAnimationActive
              animationDuration={900}
            >
              {lastProjectionPoint && (
                <LabelList
                  dataKey="projection"
                  content={(props: any) => {
                    const { x, y, value, index } = props;
                    if (value == null) return null;
                    const projIdx = data.lastIndexOf(lastProjectionPoint);
                    if (index !== projIdx) return null;
                    return (
                      <g>
                        <circle cx={x} cy={y} r={3.5} fill="hsl(var(--primary))" fillOpacity={0.9} stroke="hsl(var(--card))" strokeWidth={1.5} />
                        <text x={x + 6} y={y - 6} fill="hsl(var(--primary))" fontSize={11} fontWeight={600} opacity={0.9}>
                          Projected {fmt(Number(value))}
                        </text>
                      </g>
                    );
                  }}
                />
              )}
            </Line>
          )}
          {asOfDate && forecast.remainingDays > 0 && (
            <ReferenceLine
              x={format(asOfDate, "yyyy-MM-dd")}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="2 3"
              strokeOpacity={0.7}
            >
              <Label
                value="Today"
                position="top"
                fill="hsl(var(--muted-foreground))"
                fontSize={10}
                offset={6}
              />
            </ReferenceLine>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, tone, caption, subCaption }: { label: string; value: string; tone: "primary" | "muted" | "up" | "down"; caption?: string; subCaption?: string }) {
  const color =
    tone === "primary" ? "text-foreground" :
    tone === "up" ? "text-emerald-500" :
    tone === "down" ? "text-rose-500" :
    "text-muted-foreground";
  const subColor =
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
      {caption && <div className="text-[10px] text-muted-foreground mt-0.5">{caption}</div>}
      {subCaption && <div className={`text-[10px] mt-0.5 font-medium ${subColor}`}>{subCaption}</div>}
    </motion.div>
  );
}

function MethodChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}

function InfoPop({ children }: { children: React.ReactNode }) {
  return (
    <HoverCard openDelay={80} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Methodology"
        >
          <Info className="size-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80 p-3 text-xs leading-relaxed">
        {children}
      </HoverCardContent>
    </HoverCard>
  );
}

function TargetInfo({ target }: { target: RevenueTargetResult }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      Target
      <InfoPop>
        <p className="font-medium text-foreground mb-1">How the target is calculated</p>
        <p>The revenue goal is based on CTM calls classified as Good Leads during the previous 30 completed days, a 30% benchmark close rate, and the historical average won-deal value.</p>
        <div className="mt-2 space-y-0.5 text-muted-foreground">
          <div>Prior-30d Good Leads: <span className="text-foreground">{target.baselineCtmGoodLeads30d.toFixed(0)}</span></div>
          <div>Daily baseline: <span className="text-foreground">{target.baselineDailyCtmGoodLeads.toFixed(2)}</span></div>
          <div>Expected for period: <span className="text-foreground">{target.expectedCtmGoodLeadsForPeriod.toFixed(1)}</span> × 30%</div>
          <div>Avg deal value: <span className="text-foreground">{target.avgDealValue == null ? "—" : currency.format(target.avgDealValue)}</span> (n={target.avgDealSampleSize}, {target.targetDataStatus.replace(/_/g, " ")})</div>
        </div>
      </InfoPop>
    </span>
  );
}

function ForecastInfo({ forecast }: { forecast: RevenueForecastResult }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      Forecast
      <InfoPop>
        <p className="font-medium text-foreground mb-1">How the forecast is calculated</p>
        <p>Projected finish equals verified closed revenue plus the expected revenue from future CTM Good Leads, based on the current Good Lead pace, a 30% benchmark close rate, and historical average won-deal value.</p>
        {forecast.forecastMethod === "ctm_future_good_lead_pace" && (
          <div className="mt-2 space-y-0.5 text-muted-foreground">
            <div>{currency.format(forecast.closedRevenueToDate)} closed revenue</div>
            <div>+ {forecast.projectedFutureGoodLeads.toFixed(1)} projected future Good Leads</div>
            <div>× 30% benchmark close rate</div>
            <div>× {forecast.avgDealValue == null ? "—" : currency.format(forecast.avgDealValue)} average deal value</div>
            <div className="pt-1 border-t border-border text-foreground">= {forecast.projectedFinish == null ? "—" : currency.format(forecast.projectedFinish)} projected finish</div>
          </div>
        )}
        <p className="mt-2 text-muted-foreground">Because CTM Good Leads are currently stored as aggregate counts rather than individually linked to sales, the forecast does not assign additional value to existing unclosed Good Leads. It estimates revenue from future Good Lead volume and adds that estimate to verified closed revenue.</p>
      </InfoPop>
    </span>
  );
}

function targetCaption(t: RevenueTargetResult): string | undefined {
  if (t.target === 0) return "No CTM Good Leads in prior 30 days";
  if (t.targetDataStatus === "no_good_lead_baseline") {
    const cov = t.baselineCoverage;
    if (cov?.status === "partial_coverage")
      return `Prior-period CTM coverage incomplete (${cov.coveredPropertyDays}/${cov.expectedPropertyDays})`;
    return "Baseline unavailable";
  }
  if (t.targetDataStatus === "no_deal_value") return "No avg deal value";
  if (t.targetDataStatus === "expanded_180d") return `Avg deal from 180d (n=${t.avgDealSampleSize})`;
  return undefined;
}

function forecastCaption(f: RevenueForecastResult): string | undefined {
  switch (f.forecastDataStatus) {
    case "no_elapsed_period": return "Period hasn't started";
    case "no_deal_value": return "No avg deal value";
    case "missing_current_ctm": return "Current CTM data incomplete";
    case "unavailable": return "Forecast unavailable";
    case "expanded_180d": return `Avg deal from 180d (n=${f.avgDealValue ? "" : ""})`;
    default: return undefined;
  }
}