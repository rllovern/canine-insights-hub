import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { canSeeBadLead, canSeeSpam } from "@/lib/scoping";
import { AppRole } from "@/lib/types";
import { fmtNumber } from "@/lib/metrics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "./EmptyState";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface CTMCall {
  id: string;
  called_at: string;
  duration_seconds: number | null;
  tracking_source: string | null;
  channel: string | null;
  campaign_name: string | null;
  ad_group: string | null;
  call_score_label: string | null;
  call_score_bucket: string | null;
}

const CHANNEL_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
];

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function buildSeries(
  calls: CTMCall[],
  from: Date,
  to: Date,
  filter: (c: CTMCall) => boolean,
): { totals: { date: string; total: number }[]; byChannel: { date: string; [k: string]: number | string }[]; channels: string[] } {
  const days: string[] = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    days.push(ymd(d));
  }
  const channelSet = new Set<string>();
  const filtered = calls.filter(filter);
  filtered.forEach((c) => channelSet.add(c.channel ?? "Other"));
  const channels = Array.from(channelSet).sort();

  const totals = days.map((date) => ({ date, total: 0 }));
  const byChannel = days.map((date) => {
    const row: { date: string; [k: string]: number | string } = { date };
    channels.forEach((ch) => (row[ch] = 0));
    return row;
  });
  const idx = new Map(days.map((d, i) => [d, i]));

  filtered.forEach((c) => {
    const k = dayKey(c.called_at);
    const i = idx.get(k);
    if (i === undefined) return;
    totals[i].total += 1;
    const ch = c.channel ?? "Other";
    byChannel[i][ch] = ((byChannel[i][ch] as number) ?? 0) + 1;
  });

  return { totals, byChannel, channels };
}

function TimeSeriesRow({
  title,
  description,
  calls,
  from,
  to,
  filter,
}: {
  title: string;
  description?: string;
  calls: CTMCall[];
  from: Date;
  to: Date;
  filter: (c: CTMCall) => boolean;
}) {
  const { totals, byChannel, channels } = useMemo(
    () => buildSeries(calls, from, to, filter),
    [calls, from, to, filter],
  );
  const totalCount = totals.reduce((s, r) => s + r.total, 0);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
        </div>
        <div className="text-xs text-muted-foreground">
          Total <span className="font-semibold text-foreground">{fmtNumber(totalCount)}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">Total over time</div>
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart data={totals} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">By channel</div>
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart data={byChannel} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {channels.map((ch, i) => (
                  <Line key={ch} type="monotone" dataKey={ch} stroke={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} strokeWidth={1.5} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

interface RowAgg {
  record_count: number;
  no_entry: number;
  leads: number;
  bad_lead: number;
  good_lead: number;
  spam: number;
  admission: number;
}

function emptyAgg(): RowAgg {
  return { record_count: 0, no_entry: 0, leads: 0, bad_lead: 0, good_lead: 0, spam: 0, admission: 0 };
}

function aggregate(calls: CTMCall[], keyFn: (c: CTMCall) => string): Map<string, RowAgg> {
  const m = new Map<string, RowAgg>();
  calls.forEach((c) => {
    const k = keyFn(c);
    const a = m.get(k) ?? emptyAgg();
    a.record_count += 1;
    const b = c.call_score_bucket;
    if (!b) a.no_entry += 1;
    if (b === "good") { a.leads += 1; a.good_lead += 1; }
    if (b === "bad") a.bad_lead += 1;
    if (b === "spam") a.spam += 1;
    if (b === "admission") { a.leads += 1; a.admission += 1; }
    m.set(k, a);
  });
  return m;
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

function DeltaCell({ curr, prev }: { curr: number; prev: number }) {
  const d = pctDelta(curr, prev);
  return (
    <span className="inline-flex items-baseline gap-1">
      <span>{fmtNumber(curr)}</span>
      {d !== null && (
        <span className={`text-[10px] ${d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {d > 0 ? "+" : ""}{d.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

export function CallTracking({
  propertyId,
  publicToken,
  forceRole,
}: {
  propertyId: string;
  publicToken?: string;
  /** Override role (e.g. force "viewer" inside public report). */
  forceRole?: AppRole;
}) {
  const { range } = useDateRange();
  const { effectiveRole } = usePreviewMode();
  const role: AppRole | null = forceRole ?? effectiveRole;
  const showSpam = canSeeSpam(role);
  const showBadLead = canSeeBadLead(role);

  const [calls, setCalls] = useState<CTMCall[]>([]);
  const [prevCalls, setPrevCalls] = useState<CTMCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const fromIso = range.from.toISOString();
      const toIso = range.to.toISOString();
      const span = range.to.getTime() - range.from.getTime();
      const prevFrom = new Date(range.from.getTime() - span - 1).toISOString();
      const prevTo = new Date(range.from.getTime() - 1).toISOString();

      let curr: CTMCall[] = [];
      let prev: CTMCall[] = [];

      if (publicToken) {
        const [{ data: c }, { data: p }] = await Promise.all([
          supabase.rpc("get_ctm_calls_by_report_token", { _token: publicToken, _from: fromIso, _to: toIso }),
          supabase.rpc("get_ctm_calls_by_report_token", { _token: publicToken, _from: prevFrom, _to: prevTo }),
        ]);
        curr = (c ?? []) as CTMCall[];
        prev = (p ?? []) as CTMCall[];
      } else {
        const [{ data: c }, { data: p }] = await Promise.all([
          supabase.from("ctm_calls").select("*").eq("property_id", propertyId).gte("called_at", fromIso).lte("called_at", toIso).order("called_at", { ascending: true }).limit(5000),
          supabase.from("ctm_calls").select("*").eq("property_id", propertyId).gte("called_at", prevFrom).lte("called_at", prevTo).limit(5000),
        ]);
        curr = (c ?? []) as CTMCall[];
        prev = (p ?? []) as CTMCall[];
      }
      if (!cancelled) {
        setCalls(curr);
        setPrevCalls(prev);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, publicToken, range.from, range.to]);

  // Filtered series predicates
  const isLead = (c: CTMCall) => c.call_score_bucket === "good" || c.call_score_bucket === "admission";
  const isGood = (c: CTMCall) => c.call_score_bucket === "good";
  const isAdmission = (c: CTMCall) => c.call_score_bucket === "admission";
  const isSpam = (c: CTMCall) => c.call_score_bucket === "spam";

  // Source × Outcome aggregation
  const sourceAgg = useMemo(() => aggregate(calls, (c) => c.channel ?? "Other"), [calls]);
  const sourceAggPrev = useMemo(() => aggregate(prevCalls, (c) => c.channel ?? "Other"), [prevCalls]);
  const sourceRows = useMemo(() => Array.from(sourceAgg.entries()).sort((a, b) => b[1].record_count - a[1].record_count), [sourceAgg]);

  // Campaign breakdown
  const campaignAgg = useMemo(
    () => aggregate(calls, (c) => `${c.channel ?? "Other"}|${c.campaign_name ?? "(no campaign)"}`),
    [calls],
  );
  const campaignAggPrev = useMemo(
    () => aggregate(prevCalls, (c) => `${c.channel ?? "Other"}|${c.campaign_name ?? "(no campaign)"}`),
    [prevCalls],
  );
  const [sortKey, setSortKey] = useState<keyof RowAgg>("record_count");
  const campaignRows = useMemo(() => {
    const arr = Array.from(campaignAgg.entries()).map(([k, v]) => {
      const [channel, campaign] = k.split("|");
      return { key: k, channel, campaign, agg: v, prev: campaignAggPrev.get(k) ?? emptyAgg() };
    });
    arr.sort((a, b) => (b.agg[sortKey] as number) - (a.agg[sortKey] as number));
    return arr;
  }, [campaignAgg, campaignAggPrev, sortKey]);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />;
  }

  if (calls.length === 0) {
    return (
      <EmptyState
        title="No calls in this date range"
        description="Connect CallTrackingMetrics in Admin → Properties, run a sync, then come back."
      />
    );
  }

  return (
    <div className="space-y-8">
      <TimeSeriesRow title="Total Calls" calls={calls} from={range.from} to={range.to} filter={() => true} />
      <TimeSeriesRow title="Total Lead Calls" description="Good leads + admissions" calls={calls} from={range.from} to={range.to} filter={isLead} />
      <TimeSeriesRow title="Total Good Leads" calls={calls} from={range.from} to={range.to} filter={isGood} />
      <TimeSeriesRow title="Total Admissions" calls={calls} from={range.from} to={range.to} filter={isAdmission} />
      {showSpam && (
        <TimeSeriesRow title="Total SPAM" description="Internal only" calls={calls} from={range.from} to={range.to} filter={isSpam} />
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold">Source × Outcome</h3>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Record count</TableHead>
                <TableHead className="text-right">No entry</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                {showBadLead && <TableHead className="text-right">Bad lead</TableHead>}
                <TableHead className="text-right">Good lead</TableHead>
                {showSpam && <TableHead className="text-right">SPAM</TableHead>}
                <TableHead className="text-right">Admission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceRows.map(([channel, agg]) => {
                const prev = sourceAggPrev.get(channel) ?? emptyAgg();
                return (
                  <TableRow key={channel}>
                    <TableCell className="font-medium">{channel}</TableCell>
                    <TableCell className="text-right"><DeltaCell curr={agg.record_count} prev={prev.record_count} /></TableCell>
                    <TableCell className="text-right"><DeltaCell curr={agg.no_entry} prev={prev.no_entry} /></TableCell>
                    <TableCell className="text-right"><DeltaCell curr={agg.leads} prev={prev.leads} /></TableCell>
                    {showBadLead && <TableCell className="text-right"><DeltaCell curr={agg.bad_lead} prev={prev.bad_lead} /></TableCell>}
                    <TableCell className="text-right"><DeltaCell curr={agg.good_lead} prev={prev.good_lead} /></TableCell>
                    {showSpam && <TableCell className="text-right"><DeltaCell curr={agg.spam} prev={prev.spam} /></TableCell>}
                    <TableCell className="text-right"><DeltaCell curr={agg.admission} prev={prev.admission} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Campaign breakdown</h3>
          <div className="text-[11px] text-muted-foreground">
            Sort:{" "}
            <select
              className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as keyof RowAgg)}
            >
              <option value="record_count">Record count</option>
              <option value="leads">Leads</option>
              <option value="good_lead">Good lead</option>
              <option value="admission">Admission</option>
              {showBadLead && <option value="bad_lead">Bad lead</option>}
              {showSpam && <option value="spam">SPAM</option>}
            </select>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Record count</TableHead>
                <TableHead className="text-right">No entry</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                {showBadLead && <TableHead className="text-right">Bad lead</TableHead>}
                <TableHead className="text-right">Good lead</TableHead>
                {showSpam && <TableHead className="text-right">SPAM</TableHead>}
                <TableHead className="text-right">Admission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaignRows.map(({ key, channel, campaign, agg, prev }) => (
                <TableRow key={key}>
                  <TableCell className="text-xs text-muted-foreground">{channel}</TableCell>
                  <TableCell className="font-medium">{campaign}</TableCell>
                  <TableCell className="text-right"><DeltaCell curr={agg.record_count} prev={prev.record_count} /></TableCell>
                  <TableCell className="text-right"><DeltaCell curr={agg.no_entry} prev={prev.no_entry} /></TableCell>
                  <TableCell className="text-right"><DeltaCell curr={agg.leads} prev={prev.leads} /></TableCell>
                  {showBadLead && <TableCell className="text-right"><DeltaCell curr={agg.bad_lead} prev={prev.bad_lead} /></TableCell>}
                  <TableCell className="text-right"><DeltaCell curr={agg.good_lead} prev={prev.good_lead} /></TableCell>
                  {showSpam && <TableCell className="text-right"><DeltaCell curr={agg.spam} prev={prev.spam} /></TableCell>}
                  <TableCell className="text-right"><DeltaCell curr={agg.admission} prev={prev.admission} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
