import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { Check, Copy, Download, AlertTriangle, Info, BellPlus, ArrowUp, ArrowDown, Minus, ArrowUpDown, FileText, EyeOff, Eye } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { exportNodeToPdf } from "@/lib/exportPdf";
import type {
  ReportSchema, ChartSpec, TableSpec, TableColumn, SummaryCard, Recommendation, Severity,
} from "@/lib/jarvis/reportSchema";

const toneClasses: Record<NonNullable<SummaryCard["tone"]>, string> = {
  neutral: "border-border",
  good: "border-emerald-500/40 bg-emerald-500/5",
  warn: "border-amber-500/40 bg-amber-500/5",
  bad: "border-destructive/40 bg-destructive/5",
};

const severityToTone: Record<Severity, NonNullable<SummaryCard["tone"]>> = {
  good: "good",
  warning: "warn",
  critical: "bad",
  neutral: "neutral",
};

const severityBadgeClass: Record<Severity, string> = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c, i) => {
        const tone = c.tone ?? (c.status ? severityToTone[c.status] : "neutral");
        const dir = c.delta_direction;
        const DirIcon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : dir === "flat" ? Minus : null;
        const dirClass =
          dir === "up" ? "text-emerald-600 dark:text-emerald-400"
          : dir === "down" ? "text-destructive"
          : "text-muted-foreground";
        return (
          <Card key={i} className={cn("p-3 border", toneClasses[tone])}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{c.value}</div>
            {(c.delta != null || c.hint) && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                {DirIcon && <DirIcon className={cn("size-3", dirClass)} />}
                {c.delta != null && <span className={cn("tabular-nums", dirClass)}>{c.delta}</span>}
                {c.hint && <span>{c.delta != null ? "· " : ""}{c.hint}</span>}
              </div>
            )}
            {c.detail && <div className="mt-0.5 text-[11px] text-muted-foreground">{c.detail}</div>}
          </Card>
        );
      })}
    </div>
  );
}

const palette = ["hsl(var(--primary))", "hsl(var(--accent))", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];

function EmptyReportBlock({ title, message }: { title?: string; message: string }) {
  return (
    <Card className="p-4">
      {title && <div className="text-sm font-medium mb-2">{title}</div>}
      <div className="text-xs text-muted-foreground py-6 text-center">{message}</div>
    </Card>
  );
}

function ReportChart({ spec }: { spec: ChartSpec }) {
  const data = Array.isArray(spec?.data) ? spec.data : [];
  const yKeys = Array.isArray(spec?.y) ? spec.y : [];
  const xKey = typeof spec?.x === "string" ? spec.x : undefined;

  if (!data.length || !yKeys.length || !xKey) {
    if (typeof console !== "undefined") {
      console.warn("[Jarvis ReportChart Invalid Payload]", spec);
    }
    return <EmptyReportBlock title={spec?.title} message="No chart data available for this report." />;
  }

  // Donut chart
  if (spec.type === "donut") {
    const valueKey = yKeys[0];
    return (
      <Card className="p-4">
        {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
        <div className="h-56">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey={valueKey} nameKey={xKey} innerRadius={45} outerRadius={80} paddingAngle={2}>
                {data.map((_, i) => (
                  <Cell key={i} fill={palette[i % palette.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 12, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
    );
  }

  // Funnel chart (rendered as horizontal bar by stage)
  if (spec.type === "funnel") {
    const valueKey = yKeys[0];
    const max = Math.max(...data.map((d) => Number(d[valueKey] ?? 0) || 0), 1);
    return (
      <Card className="p-4">
        {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
        <div className="space-y-1.5">
          {data.map((row, i) => {
            const v = Number(row[valueKey] ?? 0) || 0;
            const pct = (v / max) * 100;
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <div className="w-32 truncate text-muted-foreground">{String(row[xKey])}</div>
                <div className="flex-1 h-6 rounded bg-muted/50 overflow-hidden relative">
                  <div className="h-full" style={{ width: `${pct}%`, background: palette[i % palette.length] }} />
                  <div className="absolute inset-0 flex items-center px-2 text-[11px] font-medium tabular-nums">
                    {v.toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  const isStacked = spec.type === "stacked_bar" || spec.stacked;
  const isTimeline = spec.type === "timeline";
  const Comp =
    spec.type === "line" || isTimeline ? LineChart
    : spec.type === "area" ? AreaChart
    : BarChart;
  return (
    <Card className="p-4">
      {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
      <div className="h-56">
        <ResponsiveContainer>
          <Comp data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {yKeys.map((k, i) => {
              const color = palette[i % palette.length];
              if (spec.type === "line" || isTimeline) return <Line key={k} type="monotone" dataKey={k} stroke={color} strokeWidth={2} dot={false} />;
              if (spec.type === "area") return <Area key={k} type="monotone" dataKey={k} stroke={color} fill={color} fillOpacity={0.2} />;
              return <Bar key={k} dataKey={k} fill={color} stackId={isStacked ? "s" : undefined} />;
            })}
          </Comp>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function formatCell(value: unknown, col: TableColumn): React.ReactNode {
  if (value == null || value === "") return "—";
  const t = col.type;
  if (t === "currency") {
    const n = Number(value);
    if (Number.isFinite(n)) return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  }
  if (t === "percent") {
    const n = Number(value);
    if (Number.isFinite(n)) return `${(n * (Math.abs(n) <= 1 ? 100 : 1)).toFixed(1)}%`;
  }
  if (t === "number") {
    const n = Number(value);
    if (Number.isFinite(n)) return n.toLocaleString();
  }
  if (t === "date") {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) return d.toLocaleDateString();
  }
  if (t === "badge") {
    const s = String(value).toLowerCase();
    const sev: Severity =
      s === "good" || s === "ok" || s === "healthy" || s === "active" ? "good"
      : s === "warn" || s === "warning" || s === "stale" ? "warning"
      : s === "critical" || s === "error" || s === "fail" || s === "failed" ? "critical"
      : "neutral";
    return (
      <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide", severityBadgeClass[sev])}>
        {String(value)}
      </span>
    );
  }
  if (t === "link") {
    const s = String(value);
    if (/^https?:\/\//.test(s)) return <a href={s} target="_blank" rel="noreferrer" className="text-primary underline">link</a>;
  }
  return String(value);
}

function ReportTable({ spec }: { spec: TableSpec }) {
  const columns = Array.isArray(spec?.columns) ? spec.columns : [];
  const rows = Array.isArray(spec?.rows) ? spec.rows : [];
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    spec.default_sort ? { key: spec.default_sort.key, dir: spec.default_sort.direction } : null
  );
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const k = sort.key;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[k]; const bv = b[k];
      const an = Number(av); const bn = Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * mul;
      return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
    });
  }, [rows, sort]);
  const toggleSort = (k: string) =>
    setSort((s) => s?.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" });
  return (
    <Card className="p-4">
      {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
      {rows.length === 0 || columns.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">{spec.empty ?? "No rows"}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                {columns.map((c) => (
                  <th key={c.key} className={cn("py-2 px-2 font-medium select-none", c.align === "right" ? "text-right" : "text-left")}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.label}
                      <ArrowUpDown className={cn("size-3 opacity-50", sort?.key === c.key && "opacity-100")} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 50).map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  {columns.map((c) => (
                    <td key={c.key} className={cn("py-1.5 px-2 tabular-nums", c.align === "right" ? "text-right" : "text-left")}>
                      {formatCell(row[c.key], c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > 50 && (
            <div className="text-[11px] text-muted-foreground mt-2">Showing first 50 of {sorted.length} rows.</div>
          )}
        </div>
      )}
    </Card>
  );
}

const sevIcon = { info: Info, warn: AlertTriangle, critical: AlertTriangle };
const sevClass = {
  info: "text-muted-foreground",
  warn: "text-amber-500",
  critical: "text-destructive",
};

function Recommendations({ items }: { items: Recommendation[] }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-2">Recommendations</div>
      <ul className="space-y-2">
        {items.map((r, i) => {
          const Icon = sevIcon[r.severity ?? "info"];
          return (
            <li key={i} className="flex gap-2 text-sm">
              <Icon className={cn("size-4 mt-0.5 shrink-0", sevClass[r.severity ?? "info"])} />
              <div>
                <div className="font-medium">{r.title}</div>
                {r.detail && <div className="text-xs text-muted-foreground mt-0.5">{r.detail}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function csvFromTable(t: TableSpec): string {
  const columns = Array.isArray(t?.columns) ? t.columns : [];
  const rows = Array.isArray(t?.rows) ? t.rows : [];
  const head = columns.map((c) => `"${c.label}"`).join(",");
  const body = rows.map((r) => columns.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  return `${head}\n${body}`;
}

export function normalizeReportSchema(report: ReportSchema): ReportSchema {
  const safe = (report ?? {}) as ReportSchema;
  const charts = (Array.isArray(safe.charts) ? safe.charts : []).map((raw) => {
    const c = (raw ?? {}) as Record<string, unknown> & Partial<ChartSpec>;
    // Accept alternate LLM shapes: x_key/xKey for x, series:[{key,label}] for y.
    const x =
      (typeof c.x === "string" && c.x) ||
      (typeof (c as { x_key?: unknown }).x_key === "string" && (c as { x_key: string }).x_key) ||
      (typeof (c as { xKey?: unknown }).xKey === "string" && (c as { xKey: string }).xKey) ||
      undefined;
    let y: string[] = Array.isArray(c.y)
      ? (c.y as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const series = (c as { series?: unknown }).series;
    if (y.length === 0 && Array.isArray(series)) {
      y = series
        .map((s) => {
          if (typeof s === "string") return s;
          if (s && typeof s === "object") {
            const k = (s as { key?: unknown; dataKey?: unknown }).key ?? (s as { dataKey?: unknown }).dataKey;
            return typeof k === "string" ? k : null;
          }
          return null;
        })
        .filter((v): v is string => !!v);
    }
    const data = Array.isArray(c.data) ? (c.data as ChartSpec["data"]) : [];
    // Last resort: infer y from first data row keys (excluding x)
    if (y.length === 0 && data.length > 0 && x) {
      y = Object.keys(data[0] ?? {}).filter((k) => k !== x);
    }
    return { ...(c as object), x, y, data } as ChartSpec;
  }) as ChartSpec[];
  const tables = (Array.isArray(safe.tables) ? safe.tables : []).map((t) => ({
    ...t,
    columns: Array.isArray((t as TableSpec)?.columns) ? (t as TableSpec).columns : [],
    rows: Array.isArray((t as TableSpec)?.rows) ? (t as TableSpec).rows : [],
  })) as TableSpec[];
  return {
    ...safe,
    type: "report",
    title: safe.title ?? "Report",
    scope: (safe.scope ?? {}) as ReportSchema["scope"],
    summary_cards: Array.isArray(safe.summary_cards) ? safe.summary_cards : [],
    charts,
    tables,
    recommendations: Array.isArray(safe.recommendations) ? safe.recommendations : [],
  };
}

class ReportErrorBoundary extends React.Component<
  { schema: ReportSchema; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[Jarvis ReportView Error]", error, info, this.props.schema);
  }
  render() {
    if (this.state.error) {
      return (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-destructive mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium">This report could not be rendered.</div>
              <div className="text-xs text-muted-foreground mt-1">{this.state.error.message}</div>
              <details className="mt-3">
                <summary className="text-xs cursor-pointer text-muted-foreground">View raw report data</summary>
                <pre className="mt-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-2 rounded max-h-80">
                  {JSON.stringify(this.props.schema, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        </Card>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

function summarize(s: ReportSchema): string {
  const cards = (s.summary_cards ?? []).map((c) => `${c.label}: ${c.value}`).join(" · ");
  const recs = (s.recommendations ?? []).map((r) => `• ${r.title}`).join("\n");
  return [s.title, cards, recs].filter(Boolean).join("\n\n");
}

function ReportViewInner({
  schema,
  reportId,
  onSave,
}: {
  schema: ReportSchema;
  reportId?: string;
  onSave?: (id: string) => Promise<void> | void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const copySummary = async () => {
    await navigator.clipboard.writeText(summarize(schema));
    toast({ title: "Summary copied" });
  };
  const exportCsv = () => {
    const t = schema.tables?.[0];
    if (!t) { toast({ title: "No table to export" }); return; }
    const blob = new Blob([csvFromTable(t)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${schema.title.replace(/\W+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const save = async () => {
    if (!reportId || !onSave) return;
    setSaving(true);
    try { await onSave(reportId); toast({ title: "Report saved" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Jarvis report</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <h2 className="text-lg font-semibold">{schema.title}</h2>
            {schema.status && (
              <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", severityBadgeClass[schema.status.severity])}>
                {schema.status.label}
              </Badge>
            )}
            {schema.confidence && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {schema.confidence.level} confidence
              </Badge>
            )}
          </div>
          {schema.subtitle && <div className="text-sm text-muted-foreground">{schema.subtitle}</div>}
          {schema.status?.explanation && (
            <div className="text-xs text-muted-foreground mt-1">{schema.status.explanation}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button size="sm" variant="outline" onClick={save} disabled={!reportId || saving}>
            <Check className="size-3.5" /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={copySummary}>
            <Copy className="size-3.5" /> Copy summary
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEvidenceOpen((v) => !v)}>
            <Info className="size-3.5" /> Evidence
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!schema.tables?.length}>
            <Download className="size-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" disabled title="Alerts coming in Phase 2">
            <BellPlus className="size-3.5" /> Create alert
          </Button>
        </div>
      </div>

      {/* Scope strip */}
      <Card className="p-3 bg-muted/30 border-dashed">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {schema.scope.property_name && <span><b className="text-foreground">Property:</b> {schema.scope.property_name}</span>}
          {schema.scope.date_range && (
            <span><b className="text-foreground">Range:</b> {schema.scope.date_range.from.slice(0,10)} → {schema.scope.date_range.to.slice(0,10)}</span>
          )}
          {schema.comparison_range && (
            <span><b className="text-foreground">vs:</b> {schema.comparison_range.from.slice(0,10)} → {schema.comparison_range.to.slice(0,10)}</span>
          )}
          {schema.scope.sources_used?.length ? (
            <span><b className="text-foreground">Sources:</b> {schema.scope.sources_used.join(", ")}</span>
          ) : null}
          {schema.scope.matching_method && (
            <span><b className="text-foreground">Method:</b> {schema.scope.matching_method}</span>
          )}
        </div>
        {(schema.scope.caveats?.length || schema.caveats?.length) ? (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5 mt-0.5" />
            <div>{[...(schema.scope.caveats ?? []), ...(schema.caveats ?? [])].join(" · ")}</div>
          </div>
        ) : null}
      </Card>

      {schema.summary_cards?.length ? <SummaryCards cards={schema.summary_cards} /> : null}
      {schema.charts?.map((c, i) => <ReportChart key={i} spec={c} />)}
      {schema.tables?.map((t, i) => <ReportTable key={i} spec={t} />)}
      {schema.recommendations?.length ? <Recommendations items={schema.recommendations} /> : null}

      {evidenceOpen && (
        <Card className="p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Evidence</div>
          <pre className="text-[11px] overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-2 rounded max-h-80">
            {JSON.stringify({ scope: schema.scope, freshness: schema.scope.sync_freshness, evidence: schema.evidence ?? {} }, null, 2)}
          </pre>
        </Card>
      )}

      {schema.scope.sync_freshness && (
        <div className="text-[11px] text-muted-foreground">
          Data freshness ·{" "}
          {Object.entries(schema.scope.sync_freshness).map(([k, v]) => (
            <span key={k} className="mr-3">{k}: {v ? new Date(v).toLocaleString() : "never"}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportView(props: { schema: ReportSchema; reportId?: string; onSave?: (id: string) => Promise<void> | void }) {
  const normalized = normalizeReportSchema(props.schema);
  return (
    <ReportErrorBoundary schema={normalized}>
      <ReportViewInner {...props} schema={normalized} />
    </ReportErrorBoundary>
  );
}

export default ReportView;