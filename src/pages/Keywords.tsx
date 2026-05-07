import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Search, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface RankingRow {
  id: string;
  keyword_id: number;
  keyword: string;
  position: number | null;
  previous_position: number | null;
  search_volume: number | null;
  ranking_url: string | null;
  search_engine: string | null;
  region: string | null;
  captured_at: string;
}

interface SoVRow {
  domain: string;
  is_own_domain: boolean;
  sov_score: number;
  captured_at: string;
}

const COLORS = ["hsl(var(--primary))", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function Keywords() {
  const { activeProperty, role } = useAuth();
  const [latest, setLatest] = useState<RankingRow[]>([]);
  const [history, setHistory] = useState<RankingRow[]>([]);
  const [sov, setSov] = useState<SoVRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = async () => {
    if (!activeProperty) return;
    setLoading(true);
    // Latest snapshot per keyword
    const { data: rows } = await supabase
      .from("keyword_rankings")
      .select("*")
      .eq("property_id", activeProperty.id)
      .order("captured_at", { ascending: false })
      .limit(5000);
    const latestMap = new Map<number, RankingRow>();
    const hist: RankingRow[] = [];
    for (const r of (rows ?? []) as RankingRow[]) {
      hist.push(r);
      if (!latestMap.has(r.keyword_id)) latestMap.set(r.keyword_id, r);
    }
    setLatest(Array.from(latestMap.values()));
    setHistory(hist);

    const { data: sovRows } = await supabase
      .from("keyword_share_of_voice")
      .select("*")
      .eq("property_id", activeProperty.id)
      .order("captured_at", { ascending: false })
      .limit(500);
    setSov((sovRows ?? []) as SoVRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeProperty?.id]);

  const handleSync = async () => {
    if (!activeProperty) return;
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("sync-keyword-com", {
      body: { property_id: activeProperty.id },
    });
    setSyncing(false);
    if (error || (data as any)?.error) {
      toast({ title: "Sync failed", description: String(error?.message ?? (data as any)?.error), variant: "destructive" });
    } else {
      toast({ title: "Sync complete", description: `${(data as any)?.written ?? 0} ranking rows updated` });
      load();
    }
  };

  // KPIs
  const kpis = useMemo(() => {
    const tracked = latest.length;
    const ranked = latest.filter((r) => r.position != null);
    const avg = ranked.length ? ranked.reduce((s, r) => s + (r.position ?? 0), 0) / ranked.length : 0;
    const top3 = latest.filter((r) => r.position != null && r.position <= 3).length;
    const top10 = latest.filter((r) => r.position != null && r.position <= 10).length;
    let improved = 0, declined = 0;
    for (const r of latest) {
      if (r.position != null && r.previous_position != null) {
        if (r.position < r.previous_position) improved++;
        else if (r.position > r.previous_position) declined++;
      }
    }
    return { tracked, avg, top3, top10, improved, declined };
  }, [latest]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const arr = q ? latest.filter((r) => r.keyword.toLowerCase().includes(q)) : latest;
    return [...arr].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  }, [latest, search]);

  const toggle = (id: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < 5) n.add(id);
      return n;
    });
  };

  // Chart data: dates × selected keywords
  const chartData = useMemo(() => {
    if (selected.size === 0) return [];
    const byDate = new Map<string, any>();
    for (const r of history) {
      if (!selected.has(r.keyword_id)) continue;
      const slot = byDate.get(r.captured_at) ?? { date: r.captured_at };
      slot[`kw_${r.keyword_id}`] = r.position;
      byDate.set(r.captured_at, slot);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [history, selected]);

  const selectedList = useMemo(
    () => latest.filter((r) => selected.has(r.keyword_id)),
    [latest, selected]
  );

  // SoV: latest snapshot grouped by domain
  const sovLatest = useMemo(() => {
    if (sov.length === 0) return [];
    const latestDate = sov[0].captured_at;
    return sov.filter((s) => s.captured_at === latestDate).sort((a, b) => b.sov_score - a.sov_score).slice(0, 8);
  }, [sov]);

  if (!activeProperty) {
    return <AppShell title="Keywords"><div className="text-muted-foreground">Select a client to see keyword rankings.</div></AppShell>;
  }

  return (
    <AppShell title="Keywords">
      <div className="flex items-center justify-between gap-2">
        <SectionDivider title="Keyword rankings" subtitle={`Tracked via Keyword.com${latest[0] ? ` · last updated ${latest[0].captured_at}` : ""}`} />
        {role === "internal" && (
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <RefreshCw className="size-4 mr-1.5" />}
            Sync now
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Tracked keywords" value={kpis.tracked} />
        <KpiCard label="Avg position" value={kpis.avg ? kpis.avg.toFixed(1) : "—"} />
        <KpiCard label="Top 3" value={kpis.top3} />
        <KpiCard label="Top 10" value={kpis.top10} />
        <KpiCard label="Improved / Declined" value={`${kpis.improved} / ${kpis.declined}`} />
      </div>

      <SectionDivider title="Keywords" subtitle="Select up to 5 keywords to chart their ranking trend." />
      <div className="card-surface p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="size-4 text-muted-foreground" />
          <Input placeholder="Search keywords…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        </div>
        {loading ? (
          <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground text-sm py-8 text-center">
            No keyword data yet. {role === "internal" && "Connect Keyword.com from Properties Admin and click Sync now."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead className="text-right">Rank</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead>Ranking URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((r) => {
                  const change = r.position != null && r.previous_position != null
                    ? r.previous_position - r.position
                    : null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.keyword_id)}
                          onCheckedChange={() => toggle(r.keyword_id)}
                          disabled={!selected.has(r.keyword_id) && selected.size >= 5}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{r.keyword}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.position ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {change == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : change > 0 ? (
                          <span className="inline-flex items-center text-green-600"><ArrowUp className="size-3 mr-0.5" />{change}</span>
                        ) : change < 0 ? (
                          <span className="inline-flex items-center text-red-600"><ArrowDown className="size-3 mr-0.5" />{Math.abs(change)}</span>
                        ) : (
                          <span className="inline-flex items-center text-muted-foreground"><Minus className="size-3" /></span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.search_volume ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {r.ranking_url ? (
                          <a href={r.ranking_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{r.ranking_url}</a>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <>
          <SectionDivider title="Ranking trend" subtitle="Lower position = better. Y-axis is inverted." />
          <div className="card-surface p-4">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis reversed domain={[1, "dataMax"]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {selectedList.map((kw, i) => (
                  <Line
                    key={kw.keyword_id}
                    type="monotone"
                    dataKey={`kw_${kw.keyword_id}`}
                    name={kw.keyword}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {sovLatest.length > 0 && (
        <>
          <SectionDivider title="Share of voice" subtitle={`Latest snapshot — ${sovLatest[0].captured_at}`} />
          <div className="card-surface p-4 space-y-2">
            {sovLatest.map((s) => (
              <div key={s.domain} className="flex items-center gap-3">
                <div className={`w-48 truncate text-sm ${s.is_own_domain ? "font-semibold text-primary" : ""}`}>{s.domain}</div>
                <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, s.sov_score)}%` }} />
                </div>
                <div className="w-16 text-right tabular-nums text-sm">{s.sov_score.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
