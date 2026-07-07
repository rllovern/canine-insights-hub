import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { MultiLineChart, SingleLineChart } from "@/components/dashboard/MultiLineChart";
import { useDashboard } from "@/contexts/DashboardContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { useProperties } from "@/contexts/PropertyContext";
import { useScope } from "@/contexts/ScopeContext";
import {
  fmtCurrency, fmtNumber, groupByDate, groupByDateAndSource, groupBySource, groupByCampaign, pctChange, fillDateRange,
} from "@/lib/metrics";
import { calc } from "@/lib/data-sources";
import { Delta } from "@/components/ui/Delta";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { usePropertyMetricConfig } from "@/lib/property-labels";
import { AskJarvisButton } from "@/components/jarvis/AskJarvisButton";
import {
  rowTotalLeads,
} from "@/lib/leadModel";

const PPC_SOURCE = "Google PPC";

/**
 * Label rule: for properties that have any campaign_labels rows, only PPC
 * rows whose (property_id, campaign) is labeled for that property count.
 * Properties with zero labels are unaffected. Non-PPC rows are always kept.
 */
function useLabelRuleFilter(rows: any[]) {
  const propertyIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.property_id).filter(Boolean))),
    [rows],
  );
  const key = propertyIds.slice().sort().join(",");
  const { data } = useQuery({
    queryKey: ["campaign-labels", key],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_labels")
        .select("property_id, campaign")
        .in("property_id", propertyIds);
      if (error) throw error;
      return (data ?? []) as { property_id: string; campaign: string }[];
    },
  });

  return useMemo(() => {
    if (!data || data.length === 0) return rows;
    const allowed = new Map<string, Set<string>>();
    for (const l of data) {
      if (!allowed.has(l.property_id)) allowed.set(l.property_id, new Set());
      allowed.get(l.property_id)!.add(l.campaign);
    }
    return rows.filter((r) => {
      if (r.ad_source !== PPC_SOURCE) return true;
      const set = allowed.get(r.property_id);
      if (!set) return true; // property has no labels -> unfiltered
      return set.has(r.campaign);
    });
  }, [rows, data]);
}

export default function CallTracking() {
  const { current: rawCurrent, prior: rawPrior, isLoading, range, compareMode, compareRange } = useDashboard();
  // GHL Won is a sales-disposition feed, not a media source — never render it
  // as a source on charts, tables, or breakdowns on this report.
  const current = useMemo(() => rawCurrent.filter((r: any) => r.ad_source !== "GHL Won"), [rawCurrent]);
  const prior = useMemo(() => rawPrior.filter((r: any) => r.ad_source !== "GHL Won"), [rawPrior]);
  const { activeProperty: scopeProperty, mode } = useScope();
  const { properties } = useProperties();
  const activeProperty = scopeProperty ?? (mode === "agency" ? (properties[0] ?? null) : null);
  const { effectiveRole } = usePreviewMode();
  const isInternal = effectiveRole === "internal";
  const cfg = usePropertyMetricConfig();
  const showCompare = compareMode !== "off";

  const series = useMemo(() => {
    const zeros = {
      cost: 0, impressions: 0, clicks: 0, record_count: 0, no_entry: 0,
      leads: 0, good_leads: 0, bad_leads: 0, medicaid: 0, spam: 0,
      projected_sale: 0, verified_sale: 0, sessions: 0, users: 0,
      cost_per_good_lead: 0,
    } as any;
    const buildDaily = (rows: typeof current) =>
      groupByDate(rows).map((r) => ({
        ...r,
        cost_per_good_lead: calc.costPerGoodLead(r.cost, r.good_leads),
      }));
    const cur = fillDateRange(buildDaily(current), range.from, range.to, zeros);
    if (!showCompare) return cur;
    const pri = fillDateRange(buildDaily(prior), compareRange.from, compareRange.to, zeros);
    return cur.map((row: any, i: number) => {
      const p: any = pri[i] ?? {};
      return {
        ...row,
        record_count_prev: p.record_count ?? 0,
        good_leads_prev: p.good_leads ?? 0,
        spam_prev: p.spam ?? 0,
      };
    });
  }, [current, prior, range, compareRange, showCompare]);

  const buildSourceSeries = (metric: "record_count" | "good_leads" | "spam") => {
    const curG = groupByDateAndSource(current, metric);
    const priG = groupByDateAndSource(prior, metric);
    const sources = Array.from(new Set([...curG.sources, ...priG.sources]));
    const zeros = Object.fromEntries(sources.map((s) => [s, 0])) as any;
    const cur = fillDateRange(curG.series, range.from, range.to, zeros);
    if (!showCompare) return { sources, series: cur };
    const pri = fillDateRange(priG.series, compareRange.from, compareRange.to, zeros);
    const merged = cur.map((row: any, i: number) => {
      const p: any = pri[i] ?? {};
      const out: any = { ...row };
      for (const s of sources) out[`${s}_prev`] = p[s] ?? 0;
      return out;
    });
    return { sources, series: merged };
  };

  const callsBySource = useMemo(() => buildSourceSeries("record_count"), [current, prior, range, compareRange, showCompare]);
  const goodBySource = useMemo(() => buildSourceSeries("good_leads"), [current, prior, range, compareRange, showCompare]);
  const spamBySource = useMemo(() => buildSourceSeries("spam"), [current, prior, range, compareRange, showCompare]);

  const cpglBySource = useMemo(() => {
    const sources = Array.from(new Set(current.map((r) => r.ad_source)));
    const dateMap = new Map<string, any>();
    for (const r of current) {
      const ex = dateMap.get(r.date) ?? { date: r.date };
      ex[r.ad_source + "::cost"] = (ex[r.ad_source + "::cost"] || 0) + Number(r.cost);
      ex[r.ad_source + "::gl"] = (ex[r.ad_source + "::gl"] || 0) + r.good_leads;
      dateMap.set(r.date, ex);
    }
    const rows = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    for (const row of rows) for (const s of sources) row[s] = row[s + "::gl"] ? row[s + "::cost"] / row[s + "::gl"] : 0;
    const filled = fillDateRange(rows, range.from, range.to, Object.fromEntries(sources.map((s) => [s, 0])) as any);
    return { series: filled, sources };
  }, [current, range]);

  if (!activeProperty) return <div className="text-sm text-muted-foreground">Select a client to view calls.</div>;
  if (isLoading) return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>;

  return (
    <>
      <SectionDivider
        title="Call Performance"
        subtitle="Total volume and per-source breakdowns of calls, leads, and conversions"
      />
      <Row>
        <ChartCard title="Total Calls" subtitle="All sources, daily">
          <SingleLineChart data={series} dataKey="record_count" label="Calls" color="hsl(var(--chart-1))" fmt={fmtNumber} prevKey="record_count_prev" showCompare={showCompare} />
        </ChartCard>
        <ChartCard title="Calls by Source" subtitle="Breakdown by ad source">
          <MultiLineChart data={callsBySource.series} sources={callsBySource.sources} fmt={fmtNumber} showCompare={showCompare} />
        </ChartCard>
      </Row>

      <SectionDivider title="Lead Quality" subtitle="Cost-per-acquisition trends by source" />
      <Row>
        <ChartCard title="Total Good Leads" subtitle="All sources, daily">
          <SingleLineChart data={series} dataKey="good_leads" label="Good Leads" color="hsl(var(--chart-2))" fmt={fmtNumber} prevKey="good_leads_prev" showCompare={showCompare} />
        </ChartCard>
        <ChartCard title="Good Leads by Source">
          <MultiLineChart data={goodBySource.series} sources={goodBySource.sources} fmt={fmtNumber} showCompare={showCompare} />
        </ChartCard>
      </Row>

      {isInternal && !cfg.isHidden("spam") && (
        <>
          <SectionDivider title="Spam Monitoring" subtitle="Internal view only" />
          <Row>
            <ChartCard title={`Total ${cfg.label("spam").toUpperCase()}`} subtitle="All sources, daily">
              <SingleLineChart data={series} dataKey="spam" label={cfg.label("spam")} color="hsl(var(--chart-5))" fmt={fmtNumber} prevKey="spam_prev" showCompare={showCompare} />
            </ChartCard>
            <ChartCard title={`${cfg.label("spam").toUpperCase()} by Source`}>
              <MultiLineChart data={spamBySource.series} sources={spamBySource.sources} fmt={fmtNumber} showCompare={showCompare} />
            </ChartCard>
          </Row>
        </>
      )}

      <SectionDivider title="Source Performance" subtitle="Outcomes vs prior period" />
      <SourceOutcomeTable current={current} prior={prior} cfg={cfg} />

      <SectionDivider title="Campaign Breakdown" subtitle="Detail by source and campaign" />
      <CampaignTable current={current} prior={prior} cfg={cfg} />
    </>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>;
}

function CellOut({ colKey, row, prev }: { colKey: string; row: any; prev?: any }) {
  if (colKey === "verified_sale") {
    return (
      <TableCell className="text-right tabular-nums">
        <div>{fmtNumber(row?.[colKey] ?? 0)}</div>
      </TableCell>
    );
  }
  const invert = colKey === "bad_leads" || colKey === "no_entry" || colKey === "spam";
  return (
    <TableCell className="text-right tabular-nums">
      <div>{fmtNumber(row?.[colKey])}</div>
      {prev && <Delta value={pctChange(row?.[colKey], prev?.[colKey] ?? 0)} invert={invert} />}
    </TableCell>
  );
}

function SourceOutcomeTable({ current, prior, cfg }: any) {
  // Performance report scope: GHL Won is a sales-disposition feed, not a media
  // source — exclude it from the source/campaign breakdowns. Other surfaces
  // (Command, Lead Performance) still consume it untouched.
  const cur = useMemo(() => groupBySource(current).filter((r: any) => r.ad_source !== "GHL Won"), [current]);
  const pre = useMemo(() => groupBySource(prior).filter((r: any) => r.ad_source !== "GHL Won"), [prior]);
  const [sortKey, setSortKey] = useState<string>("good_leads");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Canonical totals via leadModel.ts. Quality column removed per the
  // performance-report scope.
  const withTotals = (rows: any[]) => rows.map((r: any) => ({
    ...r,
    total_leads: rowTotalLeads(r),
  }));
  const curT = withTotals(cur);
  const preT = withTotals(pre);
  const preMapT = new Map(preT.map((r: any) => [r.ad_source, r]));

  const sorted = [...curT].sort((a: any, b: any) => {
    const av = a[sortKey] ?? 0; const bv = b[sortKey] ?? 0;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const cols: { key: string; label: string }[] = [
    { key: "record_count", label: "Records" },
    { key: "no_entry", label: "No Entry" },
    ...(cfg?.isHidden("spam") ? [] : [{ key: "spam", label: cfg?.label("spam") ?? "Spam" }]),
    { key: "total_leads", label: "Total Leads" },
    ...(cfg?.isHidden("bad_leads") ? [] : [{ key: "bad_leads", label: cfg?.label("bad_leads") ?? "Bad Leads" }]),
    ...(cfg?.isHidden("good_leads") ? [] : [{ key: "good_leads", label: cfg?.label("good_leads") ?? "Good Leads" }]),
    ...(cfg?.isHidden("verified_sale") ? [] : [{ key: "verified_sale", label: cfg?.label("verified_sale") ?? "Verified Sale" }]),
  ];

  const totals: any = curT.reduce((acc: any, r: any) => { for (const c of cols) acc[c.key] = (acc[c.key] || 0) + (r[c.key] ?? 0); return acc; }, {});
  const ptotals: any = preT.reduce((acc: any, r: any) => { for (const c of cols) acc[c.key] = (acc[c.key] || 0) + (r[c.key] ?? 0); return acc; }, {});

  const sortBtn = (key: string, label: string) => (
    <button onClick={() => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("desc"); } }}
      className="inline-flex items-center gap-1 hover:text-foreground transition">
      {label} <ArrowUpDown className="size-3 opacity-50" />
    </button>
  );

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
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
                {cols.map((c) => <CellOut key={c.key} colKey={c.key} row={r} prev={p} />)}
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/30 font-semibold">
            <TableCell>Grand Total</TableCell>
            {cols.map((c) => <CellOut key={c.key} colKey={c.key} row={totals} prev={ptotals} />)}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function CampaignTable({ current, prior, cfg }: any) {
  // Canonical totals via leadModel.ts. Quality column removed; GHL Won filtered
  // out (it's a sales-disposition feed, not a media source).
  const withTotals = (rows: any[]) => rows.map((r: any) => ({
    ...r,
    total_leads: rowTotalLeads(r),
  }));
  const cur = useMemo(() => withTotals(groupByCampaign(current).filter((r: any) => r.ad_source !== "GHL Won")), [current]);
  const pre = useMemo(() => withTotals(groupByCampaign(prior).filter((r: any) => r.ad_source !== "GHL Won")), [prior]);
  const preMap = new Map(pre.map((r: any) => [`${r.ad_source}::${r.campaign}`, r]));
  const [page, setPage] = useState(0);
  const PAGE = 100;
  const [sortKey, setSortKey] = useState<string>("good_leads");
  const sorted = [...cur].sort((a: any, b: any) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  const slice = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));

  const cols = ["record_count", "no_entry", "spam", "total_leads", "bad_leads", "good_leads", "verified_sale"].filter((c) => {
    if (c === "spam" && cfg?.isHidden("spam")) return false;
    if (c === "bad_leads" && cfg?.isHidden("bad_leads")) return false;
    if (c === "good_leads" && cfg?.isHidden("good_leads")) return false;
    if (c === "verified_sale" && cfg?.isHidden("verified_sale")) return false;
    return true;
  });
  const labels: Record<string, string> = {
    record_count: "Records", no_entry: "No Entry",
    spam: cfg?.label("spam") ?? "Spam", total_leads: "Total Leads",
    bad_leads: cfg?.label("bad_leads") ?? "Bad Leads",
    good_leads: cfg?.label("good_leads") ?? "Good Leads",
    verified_sale: cfg?.label("verified_sale") ?? "Verified Sale",
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
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
                {cols.map((c) => <CellOut key={c} colKey={c} row={r} prev={p} />)}
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
