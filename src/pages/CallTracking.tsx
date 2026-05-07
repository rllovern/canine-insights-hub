import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { MultiLineChart, SingleLineChart } from "@/components/dashboard/MultiLineChart";
import { useDashboard } from "@/contexts/DashboardContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  fmtCurrency, fmtNumber, groupByDate, groupByDateAndSource, groupBySource, groupByCampaign, pctChange,
} from "@/lib/metrics";
import { calc } from "@/lib/data-sources";
import { Delta } from "@/components/ui/Delta";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { useClientMetricConfig, type MetricKey } from "@/lib/client-labels";

export function CallTrackingBody() {
  const { current, prior, isLoading } = useDashboard();
  const { effectiveRole } = useAuth();
  const isInternal = effectiveRole === "internal";
  const cfg = useClientMetricConfig();

  const series = useMemo(() => {
    const s = groupByDate(current).map((r) => ({
      ...r,
      cost_per_good_lead: calc.costPerGoodLead(r.cost, r.good_leads),
      cost_per_intake: calc.costPerIntake(r.cost, r.admissions),
    }));
    return s;
  }, [current]);

  const callsBySource = useMemo(() => groupByDateAndSource(current, "record_count"), [current]);
  const goodBySource = useMemo(() => groupByDateAndSource(current, "good_leads"), [current]);
  const admBySource = useMemo(() => groupByDateAndSource(current, "admissions"), [current]);
  const spamBySource = useMemo(() => groupByDateAndSource(current, "spam"), [current]);

  // cpgl by source as a derived series
  const cpglBySource = useMemo(() => {
    const sources = Array.from(new Set(current.map((r) => r.ad_source)));
    const dateMap = new Map<string, any>();
    for (const r of current) {
      const ex = dateMap.get(r.date) ?? { date: r.date };
      const key = r.ad_source + "::cost";
      const key2 = r.ad_source + "::gl";
      ex[key] = (ex[key] || 0) + Number(r.cost);
      ex[key2] = (ex[key2] || 0) + r.good_leads;
      dateMap.set(r.date, ex);
    }
    const rows = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    for (const row of rows) for (const s of sources) row[s] = row[s + "::gl"] ? row[s + "::cost"] / row[s + "::gl"] : 0;
    return { series: rows, sources };
  }, [current]);

  if (isLoading) return <LoadingShell />;

  return (
    <>
      <SectionDivider title="Call Performance" subtitle="Total volume and per-source breakdowns of calls, leads, and conversions" />

      {/* Row 1: Total Calls / by Source */}
      <Row>
        <ChartCard title="Total Calls" subtitle="All sources, daily">
          <SingleLineChart data={series} dataKey="record_count" label="Calls" color="hsl(var(--chart-1))" fmt={fmtNumber} />
        </ChartCard>
        <ChartCard title="Calls by Source" subtitle="Breakdown by ad source">
          <MultiLineChart data={callsBySource.series} sources={callsBySource.sources} fmt={fmtNumber} />
        </ChartCard>
      </Row>

      <SectionDivider title="Lead Quality" subtitle="Cost-per-acquisition trends by source" />

      {/* Row 2: Cost/Good Lead */}
      <Row>
        <ChartCard title="Cost / Good Lead" subtitle="Total trend">
          <SingleLineChart data={series} dataKey="cost_per_good_lead" label="Cost / Good Lead" color="hsl(var(--chart-3))" fmt={(v) => fmtCurrency(v, 0)} />
        </ChartCard>
        <ChartCard title="Cost / Good Lead by Source">
          <MultiLineChart data={cpglBySource.series} sources={cpglBySource.sources} fmt={(v) => fmtCurrency(v, 0)} />
        </ChartCard>
      </Row>

      {/* Row 3: Total Good Leads / by Source */}
      <Row>
        <ChartCard title="Total Good Leads" subtitle="All sources, daily">
          <SingleLineChart data={series} dataKey="good_leads" label="Good Leads" color="hsl(var(--chart-2))" fmt={fmtNumber} />
        </ChartCard>
        <ChartCard title="Good Leads by Source">
          <MultiLineChart data={goodBySource.series} sources={goodBySource.sources} fmt={fmtNumber} />
        </ChartCard>
      </Row>

      {/* Row 4: Admissions/Sales (label customizable; hidden if configured) */}
      {!cfg.isHidden("admissions") && (
        <Row>
          <ChartCard title={`Total ${cfg.label("admissions")}`} subtitle="Cost / Intake context">
            <SingleLineChart data={series} dataKey="admissions" label={cfg.label("admissions")} color="hsl(var(--chart-4))" fmt={fmtNumber} />
          </ChartCard>
          <ChartCard title={`${cfg.label("admissions")} by Source`}>
            <MultiLineChart data={admBySource.series} sources={admBySource.sources} fmt={fmtNumber} />
          </ChartCard>
        </Row>
      )}

      {/* Row 5: SPAM (internal only, and not hidden for this client) */}
      {isInternal && !cfg.isHidden("spam") && (
        <>
          <SectionDivider title="Spam Monitoring" subtitle="Internal view only" />
          <Row>
            <ChartCard title={`Total ${cfg.label("spam").toUpperCase()}`} subtitle="All sources, daily">
              <SingleLineChart data={series} dataKey="spam" label={cfg.label("spam")} color="hsl(var(--chart-6))" fmt={fmtNumber} />
            </ChartCard>
            <ChartCard title={`${cfg.label("spam").toUpperCase()} by Source`}>
              <MultiLineChart data={spamBySource.series} sources={spamBySource.sources} fmt={fmtNumber} />
            </ChartCard>
          </Row>
        </>
      )}

      <SectionDivider title="Source Performance" subtitle="Outcomes vs prior period" />
      <SourceOutcomeTable current={current} prior={prior} isInternal={isInternal} cfg={cfg} />

      <SectionDivider title="Campaign Breakdown" subtitle="Detail by source and campaign" />
      <CampaignTable current={current} prior={prior} isInternal={isInternal} cfg={cfg} />
    </>
  );
}

export default function CallTracking() {
  return (
    <AppShell title="Call Tracking Performance">
      <CallTrackingBody />
    </AppShell>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>;
}

function SourceOutcomeTable({ current, prior, isInternal, cfg }: any) {
  const cur = useMemo(() => groupBySource(current), [current]);
  const pre = useMemo(() => groupBySource(prior), [prior]);
  
  const [sortKey, setSortKey] = useState<string>("good_leads");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const withTotals = (rows: any[]) => rows.map((r: any) => ({ ...r, total_leads: (r.good_leads ?? 0) + (r.bad_leads ?? 0) }));
  const curT = withTotals(cur);
  const preT = withTotals(pre);
  const preMapT = new Map(preT.map((r: any) => [r.ad_source, r]));

  const sorted = [...curT].sort((a: any, b: any) => {
    const av = a[sortKey] ?? 0; const bv = b[sortKey] ?? 0;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  // Build column list, filtering out metrics hidden for this client
  const allCols: { key: string; label: string }[] = [
    { key: "record_count", label: "Records" },
    { key: "no_entry", label: "No Entry" },
    ...(cfg?.isHidden("spam") ? [] : [{ key: "spam", label: cfg?.label("spam") ?? "Spam" }]),
    { key: "total_leads", label: "Total Leads" },
    ...(cfg?.isHidden("bad_leads") ? [] : [{ key: "bad_leads", label: cfg?.label("bad_leads") ?? "Bad Leads" }]),
    ...(cfg?.isHidden("good_leads") ? [] : [{ key: "good_leads", label: cfg?.label("good_leads") ?? "Good Leads" }]),
    ...(cfg?.isHidden("admissions") ? [] : [{ key: "admissions", label: cfg?.label("admissions") ?? "Admissions" }]),
  ];
  const cols = allCols;

  const totals = curT.reduce((acc: any, r: any) => {
    for (const c of cols) acc[c.key] = (acc[c.key] || 0) + (r[c.key] ?? 0);
    return acc;
  }, {} as any);
  const ptotals = preT.reduce((acc: any, r: any) => {
    for (const c of cols) acc[c.key] = (acc[c.key] || 0) + (r[c.key] ?? 0);
    return acc;
  }, {} as any);

  const sortBtn = (key: string, label: string) => (
    <button onClick={() => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("desc"); } }}
      className="inline-flex items-center gap-1 hover:text-foreground transition">
      {label} <ArrowUpDown className="size-3 opacity-50" />
    </button>
  );

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="w-44">Ad Source</TableHead>
            {cols.map((c) => <TableHead key={c.key} className="text-right">{sortBtn(c.key, c.label)}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r: any) => {
            const p = preMapT.get(r.ad_source) as any;
            return (
              <TableRow key={r.ad_source}>
                <TableCell className="font-medium">{r.ad_source}</TableCell>
                {cols.map((c) => (
                  <TableCell key={c.key} className="text-right tabular-nums">
                    <div>{fmtNumber(r[c.key])}</div>
                    {p && <Delta value={pctChange(r[c.key], p[c.key] ?? 0)} invert={c.key === "bad_leads" || c.key === "no_entry" || c.key === "spam"} />}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/30 font-semibold">
            <TableCell>Grand Total</TableCell>
            {cols.map((c) => (
              <TableCell key={c.key} className="text-right tabular-nums">
                <div>{fmtNumber(totals[c.key])}</div>
                <Delta value={pctChange(totals[c.key], ptotals[c.key] ?? 0)} invert={c.key === "bad_leads" || c.key === "no_entry" || c.key === "spam"} />
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function CampaignTable({ current, prior, isInternal, cfg }: any) {
  const withTotals = (rows: any[]) => rows.map((r: any) => ({ ...r, total_leads: (r.good_leads ?? 0) + (r.bad_leads ?? 0) }));
  const cur = useMemo(() => withTotals(groupByCampaign(current)), [current]);
  const pre = useMemo(() => withTotals(groupByCampaign(prior)), [prior]);
  const preMap = new Map(pre.map((r: any) => [`${r.ad_source}::${r.campaign}`, r]));
  const [page, setPage] = useState(0);
  const PAGE = 100;
  const [sortKey, setSortKey] = useState<string>("good_leads");
  const sorted = [...cur].sort((a: any, b: any) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  const slice = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));

  const allCols = ["record_count", "no_entry", "spam", "total_leads", "bad_leads", "good_leads", "admissions"];
  const cols = allCols.filter((c) => {
    if (c === "spam" && cfg?.isHidden("spam")) return false;
    if (c === "bad_leads" && cfg?.isHidden("bad_leads")) return false;
    if (c === "good_leads" && cfg?.isHidden("good_leads")) return false;
    if (c === "admissions" && cfg?.isHidden("admissions")) return false;
    return true;
  });
  const labels: Record<string, string> = {
    record_count: "Records",
    no_entry: "No Entry",
    spam: cfg?.label("spam") ?? "Spam",
    total_leads: "Total Leads",
    bad_leads: cfg?.label("bad_leads") ?? "Bad Leads",
    good_leads: cfg?.label("good_leads") ?? "Good Leads",
    admissions: cfg?.label("admissions") ?? "Admissions",
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="w-40">Ad Source</TableHead>
            <TableHead>Campaign</TableHead>
            {cols.map((c) => (
              <TableHead key={c} className="text-right">
                <button onClick={() => setSortKey(c)} className="inline-flex items-center gap-1 hover:text-foreground transition">
                  {labels[c]} <ArrowUpDown className="size-3 opacity-50" />
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((r: any) => {
            const p = preMap.get(`${r.ad_source}::${r.campaign}`) as any;
            return (
              <TableRow key={`${r.ad_source}-${r.campaign}`}>
                <TableCell className="text-xs text-muted-foreground">{r.ad_source}</TableCell>
                <TableCell className="font-medium">{r.campaign}</TableCell>
                {cols.map((c) => (
                  <TableCell key={c} className="text-right tabular-nums">
                    <div>{fmtNumber(r[c])}</div>
                    {p && <Delta value={pctChange(r[c], p[c] ?? 0)} invert={c === "bad_leads" || c === "no_entry" || c === "spam"} />}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20 text-xs text-muted-foreground">
        <div>{sorted.length} campaigns · Page {page + 1} of {pages}</div>
        <div className="flex gap-1">
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="size-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}

function LoadingShell() {
  return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>;
}
