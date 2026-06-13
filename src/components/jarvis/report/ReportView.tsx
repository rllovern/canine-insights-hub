import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Check, Copy, Download, AlertTriangle, Info, BellPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type {
  ReportSchema, ChartSpec, TableSpec, SummaryCard, Recommendation,
} from "@/lib/jarvis/reportSchema";

const toneClasses: Record<NonNullable<SummaryCard["tone"]>, string> = {
  neutral: "border-border",
  good: "border-emerald-500/40 bg-emerald-500/5",
  warn: "border-amber-500/40 bg-amber-500/5",
  bad: "border-destructive/40 bg-destructive/5",
};

function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c, i) => (
        <Card key={i} className={cn("p-3 border", toneClasses[c.tone ?? "neutral"])}>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{c.value}</div>
          {c.hint && <div className="mt-0.5 text-xs text-muted-foreground">{c.hint}</div>}
        </Card>
      ))}
    </div>
  );
}

const palette = ["hsl(var(--primary))", "hsl(var(--accent))", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];

function ReportChart({ spec }: { spec: ChartSpec }) {
  const Comp = spec.type === "line" ? LineChart : spec.type === "area" ? AreaChart : BarChart;
  return (
    <Card className="p-4">
      {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
      <div className="h-56">
        <ResponsiveContainer>
          <Comp data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={spec.x} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {spec.y.map((k, i) => {
              const color = palette[i % palette.length];
              if (spec.type === "line") return <Line key={k} type="monotone" dataKey={k} stroke={color} strokeWidth={2} dot={false} />;
              if (spec.type === "area") return <Area key={k} type="monotone" dataKey={k} stroke={color} fill={color} fillOpacity={0.2} />;
              return <Bar key={k} dataKey={k} fill={color} stackId={spec.stacked ? "s" : undefined} />;
            })}
          </Comp>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function ReportTable({ spec }: { spec: TableSpec }) {
  return (
    <Card className="p-4">
      {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
      {spec.rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">{spec.empty ?? "No rows"}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                {spec.columns.map((c) => (
                  <th key={c.key} className={cn("py-2 px-2 font-medium", c.align === "right" ? "text-right" : "text-left")}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spec.rows.slice(0, 50).map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  {spec.columns.map((c) => (
                    <td key={c.key} className={cn("py-1.5 px-2 tabular-nums", c.align === "right" ? "text-right" : "text-left")}>
                      {row[c.key] == null ? "—" : String(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {spec.rows.length > 50 && (
            <div className="text-[11px] text-muted-foreground mt-2">Showing first 50 of {spec.rows.length} rows.</div>
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
  const head = t.columns.map((c) => `"${c.label}"`).join(",");
  const body = t.rows.map((r) => t.columns.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  return `${head}\n${body}`;
}

function summarize(s: ReportSchema): string {
  const cards = (s.summary_cards ?? []).map((c) => `${c.label}: ${c.value}`).join(" · ");
  const recs = (s.recommendations ?? []).map((r) => `• ${r.title}`).join("\n");
  return [s.title, cards, recs].filter(Boolean).join("\n\n");
}

export function ReportView({
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
          <h2 className="text-lg font-semibold mt-0.5">{schema.title}</h2>
          {schema.subtitle && <div className="text-sm text-muted-foreground">{schema.subtitle}</div>}
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
          {schema.scope.sources_used?.length ? (
            <span><b className="text-foreground">Sources:</b> {schema.scope.sources_used.join(", ")}</span>
          ) : null}
          {schema.scope.matching_method && (
            <span><b className="text-foreground">Method:</b> {schema.scope.matching_method}</span>
          )}
        </div>
        {schema.scope.caveats?.length ? (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5 mt-0.5" />
            <div>{schema.scope.caveats.join(" · ")}</div>
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

export default ReportView;